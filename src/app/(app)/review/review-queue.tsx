"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useOptimistic, useRef, useState, useTransition } from "react";

import { toast } from "@/components/toast";
import { Button, buttonClassName } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import type { ActionResult } from "@/lib/action";
import type { DiscoveredEmail } from "@/lib/email-discovery-data";
import { reviewHref, type ReviewCandidateDetails, type ReviewListParams, type ReviewQueueItem } from "@/lib/review-list";

import {
  approveAndSend,
  dismissAutomationCandidate,
  markAutomationAppliedManually,
  dismissAutomationCandidates,
  dismissAutomationDraft,
  keepAutomationDraft,
  loadAutomationCandidateDetails,
  markAutomationSent,
  provideAutomationRecipient,
  retryAutomationCandidate,
  searchForAutomationRecipient,
  searchForAutomationRecipients,
} from "./actions";

type Props = {
  items: ReviewQueueItem[];
  params: ReviewListParams;
  total: number;
  filtered: number;
  page: number;
  pages: number;
  pageSize: number;
  gmail: { configured: boolean; email: string | null };
  emailSearchConfigured?: boolean;
};

type Sending = { item: ReviewQueueItem; email: NonNullable<ReviewCandidateDetails["email"]> };

export function ReviewQueue({ items, params, total, filtered, page, pages, pageSize, gmail, emailSearchConfigured = false }: Props) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [shownItems, hideOptimistically] = useOptimistic(items, (current, ids: string[]) => current.filter((item) => !ids.includes(item.id)));
  const [sending, setSending] = useState<Sending | null>(null);
  const [confirmingDismiss, setConfirmingDismiss] = useState(false);
  const [recipients, setRecipients] = useState<Record<string, string>>({});
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [selected, setSelected] = useState<Set<string>>(() => new Set());
  const [matchInput, setMatchInput] = useState(params.matchBelow?.toString() ?? "");
  const [details, setDetails] = useState<Record<string, ReviewCandidateDetails>>({});
  const [detailErrors, setDetailErrors] = useState<Record<string, string>>({});
  const [loadingDetails, setLoadingDetails] = useState<Set<string>>(() => new Set());
  const detailCache = useRef<Record<string, ReviewCandidateDetails>>({});
  const detailRequests = useRef<Partial<Record<string, Promise<ReviewCandidateDetails | null>>>>({});

  useEffect(() => setMatchInput(params.matchBelow?.toString() ?? ""), [params.matchBelow]);
  useEffect(() => setSelected(new Set()), [params.page, params.matchBelow, params.email, params.sort]);
  useEffect(() => {
    const value = matchInput.trim();
    const parsed = value === "" ? null : Number(value);
    if (parsed !== null && (!Number.isInteger(parsed) || parsed < 1 || parsed > 100)) return;
    if (parsed === params.matchBelow) return;
    const timer = setTimeout(() => {
      start(() => router.replace(reviewHref({ ...params, page: 1, matchBelow: parsed }), { scroll: false }));
    }, 300);
    return () => clearTimeout(timer);
  }, [matchInput, params, router]);

  const run = <T,>(work: () => Promise<ActionResult<T>>, onSuccess?: (data: T) => void) =>
    start(async () => {
      const result = await work();
      if (!result.ok) toast(result.error ?? "Something went wrong.");
      else {
        if (result.toast) toast(result.toast);
        onSuccess?.(result.data);
      }
      setSending(null);
    });

  const dismiss = (ids: string[], work: () => Promise<ActionResult<unknown>>) =>
    start(async () => {
      hideOptimistically(ids);
      setConfirmingDismiss(false);
      const result = await work();
      if (!result.ok) {
        toast(result.error ?? "Something went wrong.");
        return;
      }
      if (result.toast) toast(result.toast);
      setSelected((current) => new Set([...current].filter((id) => !ids.includes(id))));
      if (items.length <= ids.length && page > 1) router.replace(reviewHref({ ...params, page: page - 1 }), { scroll: false });
    });

  const getDetails = (candidateId: string): Promise<ReviewCandidateDetails | null> => {
    if (detailCache.current[candidateId]) return Promise.resolve(detailCache.current[candidateId]);
    const pendingRequest = detailRequests.current[candidateId];
    if (pendingRequest) return pendingRequest;
    setLoadingDetails((current) => new Set(current).add(candidateId));
    const request = loadAutomationCandidateDetails({ candidateId }).then((result) => {
      if (!result.ok) {
        setDetailErrors((current) => ({ ...current, [candidateId]: result.error }));
        return null;
      }
      detailCache.current[candidateId] = result.data;
      setDetails((current) => ({ ...current, [candidateId]: result.data }));
      return result.data;
    }).finally(() => {
      delete detailRequests.current[candidateId];
      setLoadingDetails((current) => {
        const next = new Set(current);
        next.delete(candidateId);
        return next;
      });
    });
    detailRequests.current[candidateId] = request;
    return request;
  };

  const toggleExpanded = (item: ReviewQueueItem) => {
    const open = !(expanded[item.id] ?? false);
    setExpanded((current) => ({ ...current, [item.id]: open }));
    if (open) void getDetails(item.id);
  };

  const openSend = async (item: ReviewQueueItem) => {
    const loaded = await getDetails(item.id);
    if (!loaded?.email) {
      toast(detailErrors[item.id] ?? "The prepared email could not be loaded.");
      return;
    }
    setSending({ item, email: loaded.email });
  };

  const navigate = (next: Partial<ReviewListParams>) => {
    setSelected(new Set());
    start(() => router.replace(reviewHref({ ...params, ...next, page: 1 }), { scroll: false }));
  };
  const toggleSelected = (id: string, checked: boolean) => setSelected((current) => {
    const next = new Set(current);
    if (checked) next.add(id);
    else next.delete(id);
    return next;
  });
  const canDismiss = (item: ReviewQueueItem) => item.status === "FAILED" || item.status === "FILTERED" || item.applicationId !== null;
  const canSearchEmail = (item: ReviewQueueItem) => item.canProvideRecipient && item.discoveredEmails.length === 0;
  const selectableVisible = shownItems.filter(canDismiss);
  const selectedForEmailSearch = shownItems.filter((item) => selected.has(item.id) && canSearchEmail(item));
  const allVisibleSelected = selectableVisible.length > 0 && selectableVisible.every((item) => selected.has(item.id));
  const toggleVisible = (checked: boolean) => setSelected((current) => {
    const next = new Set(current);
    for (const item of selectableVisible) {
      if (checked) next.add(item.id);
      else next.delete(item.id);
    }
    return next;
  });
  const optimisticRemoved = items.length - shownItems.length;
  const shownTotal = Math.max(0, total - optimisticRemoved);
  const shownFiltered = Math.max(0, filtered - optimisticRemoved);

  if (total === 0) return (
    <div className="mx-14 mb-16 grid gap-4">
      <p className="text-sm font-medium">0 reviews waiting</p>
      <p className="rounded-panel border border-line-card bg-card p-7 text-sm text-muted">The review queue is empty.</p>
    </div>
  );
  return (
    <div className="mx-14 mb-16 grid gap-4">
      <section aria-label="Review controls" className="rounded-panel border border-line-card bg-card p-5">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="font-medium" aria-live="polite">{shownTotal} {shownTotal === 1 ? "review" : "reviews"} waiting</p>
            <p className="mt-1 text-sm text-muted">
              {shownFiltered === shownTotal ? `Page ${page} of ${pages}` : `${shownFiltered} matching reviews · Page ${page} of ${pages}`}
            </p>
          </div>
          <div className="flex flex-wrap items-end gap-3">
            <Input
              className="w-40"
              label="Match below (%)"
              type="number"
              min="1"
              max="100"
              inputMode="numeric"
              placeholder="All"
              value={matchInput}
              onChange={(event) => setMatchInput(event.target.value)}
            />
            <Select className="w-48" label="Email status" value={params.email} onChange={(event) => navigate({ email: event.target.value as ReviewListParams["email"] })}>
              <option value="all">All email states</option>
              <option value="not-found">No email found</option>
              <option value="found">Email found</option>
            </Select>
            <Select className="w-48" label="Sort by" value={params.sort} onChange={(event) => navigate({ sort: event.target.value as ReviewListParams["sort"] })}>
              <option value="queue">Queue order</option>
              <option value="lowest">Lowest match first</option>
              <option value="highest">Highest match first</option>
            </Select>
          </div>
        </div>
        <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-line pt-4">
          <Checkbox
            label={`Select all shown (${selectableVisible.length})`}
            checked={allVisibleSelected}
            disabled={selectableVisible.length === 0 || pending}
            onChange={(event) => toggleVisible(event.target.checked)}
          />
          <div className="flex flex-wrap items-center justify-end gap-3">
            {selected.size > 0 && <Button variant="text" size="sm" disabled={pending} onClick={() => setSelected(new Set())}>Clear selection</Button>}
            {emailSearchConfigured && (
              <Button
                variant="secondary"
                size="sm"
                disabled={selectedForEmailSearch.length === 0 || pending}
                onClick={() => run(
                  () => searchForAutomationRecipients({ candidateIds: selectedForEmailSearch.map((item) => item.id) }),
                  () => setSelected(new Set()),
                )}
              >
                Search emails{selectedForEmailSearch.length > 0 ? ` (${selectedForEmailSearch.length})` : ""}
              </Button>
            )}
            <Button variant="danger-outline" size="sm" disabled={selected.size === 0 || pending} onClick={() => setConfirmingDismiss(true)}>
              Dismiss selected{selected.size > 0 ? ` (${selected.size})` : ""}
            </Button>
          </div>
        </div>
      </section>
      {shownItems.length === 0 && (
        <p className="rounded-panel border border-line-card bg-card p-7 text-sm text-muted">No reviews match the current filters.</p>
      )}
      {shownItems.map((item) => {
        const detail = details[item.id];
        return (
          <article key={item.id} className="rounded-panel border border-line-card bg-card p-6">
            <div className="flex items-start gap-4">
              {canDismiss(item) && (
                <Checkbox
                  className="mt-1"
                  label={<span className="sr-only">Select {item.role || "untitled role"} at {item.company || "unknown company"}</span>}
                  checked={selected.has(item.id)}
                  disabled={pending}
                  onChange={(event) => toggleSelected(item.id, event.target.checked)}
                />
              )}
              <button
                type="button"
                aria-expanded={expanded[item.id] ?? false}
                aria-controls={`posting-${item.id}`}
                onClick={() => toggleExpanded(item)}
                className="flex min-w-0 flex-1 flex-wrap items-start justify-between gap-4 rounded-control text-left focus-visible:outline-2 focus-visible:outline-offset-4"
              >
                <span>
                  <span className="block font-serif text-section">{item.role || "Untitled role"}</span>
                  <span className="mt-1 block text-sm text-muted">{item.company || "Unknown company"} · {item.source}{item.score === null ? "" : ` · ${item.score}% match`}</span>
                </span>
                <span className="flex items-center gap-3">
                  <span className="rounded-full bg-selected px-3 py-1 text-xs font-medium">{item.status.replaceAll("_", " ")}</span>
                  <span aria-hidden className="text-sm text-muted">{expanded[item.id] ? "▲" : "▼"}</span>
                </span>
              </button>
            </div>
            {item.issue && <p role="alert" className="mt-4 rounded-control bg-danger-soft p-3 text-sm text-error-strong">{item.issue}</p>}
            {expanded[item.id] && (
              <section id={`posting-${item.id}`} aria-label="Review details" className="mt-4 rounded-control border border-line-field p-4">
                {loadingDetails.has(item.id) && <p className="text-sm text-muted">Loading review details…</p>}
                {detailErrors[item.id] && <p role="alert" className="rounded-control bg-danger-soft p-3 text-sm text-error-strong">{detailErrors[item.id]}</p>}
                {detail && (
                  <>
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <p className="text-sm text-muted">{[item.place, item.remote ? "Remote" : ""].filter(Boolean).join(" · ") || "Location not provided"}</p>
                      {item.postingUrl && <a href={item.postingUrl} target="_blank" rel="noopener noreferrer" className={buttonClassName("text", "sm")}>Open original posting<span aria-hidden> ↗</span><span className="sr-only"> (opens in a new tab)</span></a>}
                    </div>
                    <div className="mt-3 max-h-80 overflow-y-auto border-t border-line pt-3 text-sm leading-relaxed whitespace-pre-line text-document">
                      {detail.postingText || "The source did not provide the posting text."}
                    </div>
                    {detail.mandatory.length > 0 && (
                      <div className="mt-4 border-t border-line pt-3 text-sm">
                        <span className="font-medium">Mandatory requirements</span>
                        <ul className="mt-1 list-disc pl-5 text-muted">{detail.mandatory.map((requirement) => <li key={requirement}>{requirement}</li>)}</ul>
                      </div>
                    )}
                    {detail.email && (
                      <div className="mt-4 border-t border-line pt-3 text-sm">
                        <div><span className="text-muted">To:</span> {detail.email.to || "Missing"}</div>
                        <div className="mt-1"><span className="text-muted">Subject:</span> {detail.email.subject || "Missing"}</div>
                        <p className="mt-3 whitespace-pre-line text-muted">{detail.email.body}</p>
                      </div>
                    )}
                  </>
                )}
              </section>
            )}
            {item.applicationId && (
              <div className="mt-4 flex flex-wrap gap-2 rounded-control border border-line-field p-4 text-sm">
                <Link className={buttonClassName("secondary", "sm")} href={`/applications/${item.applicationId}?tab=resume`}>Review CV</Link>
                <Link className={buttonClassName("secondary", "sm")} href={`/applications/${item.applicationId}?tab=letter`}>Review cover letter</Link>
                <Link className={buttonClassName("secondary", "sm")} href={`/applications/${item.applicationId}?tab=email`}>Edit email</Link>
              </div>
            )}
            {item.canProvideRecipient && (
              <div className="mt-4 rounded-control border border-line-field p-4">
                {item.discoveredEmails.length > 0 && (
                  <div className="mb-5">
                    <p className="font-medium">Public application emails found</p>
                    <p className="mt-1 text-sm text-muted">Check the source before choosing one. Dossier found these addresses on public pages; it did not generate them.</p>
                    <ul className="mt-3 grid gap-3">
                      {item.discoveredEmails.map((candidate) => (
                        <li key={candidate.email} className="rounded-control border border-line-field bg-input p-3">
                          <div className="flex flex-wrap items-start justify-between gap-3">
                            <div className="min-w-0">
                              <p className="break-all font-medium">{candidate.email}</p>
                              <p className="mt-1 text-xs font-medium text-muted">{confidenceLabel(candidate.confidence)}</p>
                              <p className="mt-2 text-sm text-muted">{candidate.reason}</p>
                              <a href={candidate.sourceUrl} target="_blank" rel="noopener noreferrer" className="mt-2 inline-block text-sm underline">{candidate.sourceTitle || "Open source"}<span aria-hidden> ↗</span><span className="sr-only"> (opens in a new tab)</span></a>
                            </div>
                            <Button size="sm" disabled={pending} aria-label={`Use ${candidate.email} and prepare`} onClick={() => run(() => provideAutomationRecipient({ candidateId: item.id, recipient: candidate.email }))}>Use this email</Button>
                          </div>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
                {item.emailDiscoveryError && <p role="alert" className="mb-4 rounded-control bg-danger-soft p-3 text-sm text-error-strong">Email search: {item.emailDiscoveryError}</p>}
                {item.emailDiscoverySearched && item.discoveredEmails.length === 0 && !item.emailDiscoveryError && <p className="mb-4 rounded-control bg-selected p-3 text-sm text-muted">No public application email was found in the pages Dossier checked.</p>}
                {emailSearchConfigured && <Button variant="secondary" size="sm" className="mb-4" disabled={pending} onClick={() => run(() => searchForAutomationRecipient({ candidateId: item.id }))}>{item.emailDiscoverySearched ? "Search public pages again" : "Search public pages"}</Button>}
                <p className="mb-3 text-sm text-muted">{item.discoveredEmails.length > 0 ? "Or enter another verified application address." : "Found a verified application address yourself? Add it here and Dossier will prepare this application for review."}</p>
                <div className="flex flex-wrap items-end gap-3">
                  <Input className="min-w-[260px] flex-1" label="Application email" type="email" placeholder="jobs@example.com" value={recipients[item.id] ?? item.recipientOverride} onChange={(event) => setRecipients((current) => ({ ...current, [item.id]: event.target.value }))} />
                  <Button size="sm" disabled={pending || !(recipients[item.id] ?? item.recipientOverride).trim()} onClick={() => run(() => provideAutomationRecipient({ candidateId: item.id, recipient: recipients[item.id] ?? item.recipientOverride }))}>Use email and prepare</Button>
                </div>
              </div>
            )}
            <div className="mt-4 flex flex-wrap gap-3">
              {item.status === "FAILED" ? (
                <>
                  <Button size="sm" disabled={pending} onClick={() => run(() => retryAutomationCandidate({ candidateId: item.id }))}>Retry</Button>
                  <Button variant="secondary" size="sm" disabled={pending} onClick={() => run(() => markAutomationAppliedManually({ candidateId: item.id }))}>I applied manually</Button>
                  <Button variant="danger-text" size="sm" disabled={pending} onClick={() => dismiss([item.id], () => dismissAutomationCandidate({ candidateId: item.id }))}>Dismiss</Button>
                </>
              ) : item.status === "FILTERED" ? (
                <>
                  <Button variant="secondary" size="sm" disabled={pending} onClick={() => run(() => markAutomationAppliedManually({ candidateId: item.id }))}>I applied manually</Button>
                  <Button variant="danger-text" size="sm" disabled={pending} onClick={() => dismiss([item.id], () => dismissAutomationCandidate({ candidateId: item.id }))}>Dismiss</Button>
                </>
              ) : item.applicationId ? (
                <>
                  {item.delivery === "UNKNOWN" ? (
                    <>
                      <Button size="sm" onClick={() => run(() => markAutomationSent({ applicationId: item.applicationId! }))}>Mark sent</Button>
                      <Button variant="danger-outline" size="sm" onClick={() => void openSend(item)}>Retry send</Button>
                    </>
                  ) : <Button size="sm" disabled={pending || !gmail.email || loadingDetails.has(item.id)} onClick={() => void openSend(item)}>Approve and send</Button>}
                  {!item.delivery && <Button variant="secondary" size="sm" disabled={pending} onClick={() => run(() => markAutomationAppliedManually({ candidateId: item.id }))}>I applied manually</Button>}
                  <Button variant="secondary" size="sm" disabled={pending} onClick={() => run(() => keepAutomationDraft({ applicationId: item.applicationId! }))}>Keep as draft</Button>
                  <Button variant="danger-text" size="sm" disabled={pending} onClick={() => dismiss([item.id], () => dismissAutomationDraft({ applicationId: item.applicationId! }))}>Dismiss</Button>
                  {!gmail.email && <Link href="/settings?section=automation" className="self-center text-sm underline">Connect Gmail to send</Link>}
                </>
              ) : <span className="text-sm text-muted">Preparation is running in the background.</span>}
            </div>
          </article>
        );
      })}
      {pages > 1 && (
        <nav aria-label="Review pages" className="flex items-center justify-between rounded-panel border border-line-card bg-card p-4">
          {page > 1 ? <Link className={buttonClassName("secondary", "sm")} href={reviewHref({ ...params, page: page - 1 })}>Previous</Link> : <span />}
          <span className="text-sm text-muted">Page {page} of {pages} · up to {pageSize} reviews per page</span>
          {page < pages ? <Link className={buttonClassName("secondary", "sm")} href={reviewHref({ ...params, page: page + 1 })}>Next</Link> : <span />}
        </nav>
      )}
      <ConfirmDialog
        open={confirmingDismiss}
        onOpenChange={setConfirmingDismiss}
        title={`Dismiss ${selected.size} selected ${selected.size === 1 ? "review" : "reviews"}?`}
        description="Prepared application drafts will be deleted, and these postings will not be prepared again. This cannot be undone."
        confirmLabel="Dismiss selected"
        onConfirm={() => {
          const ids = [...selected];
          dismiss(ids, () => dismissAutomationCandidates({ candidateIds: ids }));
        }}
      />
      <ConfirmDialog
        open={sending !== null}
        onOpenChange={(open) => !open && setSending(null)}
        title={sending?.item.delivery === "UNKNOWN" ? "Retry this unconfirmed email?" : "Send this application?"}
        description={sending ? `To ${sending.email.to}. Subject: ${sending.email.subject}. Gmail will send the CV and cover letter as two PDF attachments.` : ""}
        confirmLabel={sending?.item.delivery === "UNKNOWN" ? "Retry send" : "Send email"}
        onConfirm={() => sending?.item.applicationId && run(() => approveAndSend({ applicationId: sending.item.applicationId!, retryUnknown: sending.item.delivery === "UNKNOWN" }))}
      />
    </div>
  );
}
function confidenceLabel(confidence: DiscoveredEmail["confidence"]): string {
  if (confidence === "HIGH") return "High confidence";
  if (confidence === "MEDIUM") return "Medium confidence";
  return "Low confidence";
}
