"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState, useTransition } from "react";

import { toast } from "@/components/toast";
import { Button, buttonClassName } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import type { DiscoveredEmail } from "@/lib/email-discovery-data";

import {
  approveAndSend,
  dismissAutomationCandidate,
  dismissAutomationCandidates,
  dismissAutomationDraft,
  keepAutomationDraft,
  markAutomationSent,
  provideAutomationRecipient,
  retryAutomationCandidate,
  searchForAutomationRecipient,
  searchForAutomationRecipients,
} from "./actions";

type Item = {
  id: string;
  applicationId: string | null;
  status: string;
  score: number | null;
  issue: string | null;
  canProvideRecipient: boolean;
  recipientOverride: string;
  company: string;
  role: string;
  place: string;
  remote: boolean | null;
  postingUrl: string;
  postingText: string;
  source: string;
  mandatory: string[];
  to: string;
  subject: string;
  body: string;
  delivery: string | null;
  discoveredEmails: DiscoveredEmail[];
  emailDiscoveryError: string | null;
  emailDiscoverySearched: boolean;
};

export function ReviewQueue({ items, gmail, emailSearchConfigured = false }: { items: Item[]; gmail: { configured: boolean; email: string | null }; emailSearchConfigured?: boolean }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [sending, setSending] = useState<Item | null>(null);
  const [confirmingDismiss, setConfirmingDismiss] = useState(false);
  const [recipients, setRecipients] = useState<Record<string, string>>({});
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [matchBelow, setMatchBelow] = useState("");
  const [emailFilter, setEmailFilter] = useState<"all" | "not-found" | "found">("all");
  const [sort, setSort] = useState<"queue" | "lowest" | "highest">("queue");
  const [selected, setSelected] = useState<Set<string>>(() => new Set());
  const visibleItems = useMemo(() => {
    const threshold = matchBelow === "" ? null : Number(matchBelow);
    const byScore = threshold === null || Number.isNaN(threshold)
      ? items
      : items.filter((item) => item.score !== null && item.score < threshold);
    const filtered = byScore.filter((item) => {
      if (emailFilter === "not-found") return item.canProvideRecipient && item.discoveredEmails.length === 0;
      if (emailFilter === "found") return item.canProvideRecipient && item.discoveredEmails.length > 0;
      return true;
    });
    if (sort === "queue") return filtered;
    return [...filtered].sort((left, right) => {
      if (left.score === null) return right.score === null ? 0 : 1;
      if (right.score === null) return -1;
      return sort === "lowest" ? left.score - right.score : right.score - left.score;
    });
  }, [items, matchBelow, emailFilter, sort]);
  const canDismiss = (item: Item) => item.status === "FAILED" || item.status === "FILTERED" || item.applicationId !== null;
  const canSearchEmail = (item: Item) => item.canProvideRecipient && item.discoveredEmails.length === 0;
  const selectableVisible = visibleItems.filter(canDismiss);
  const selectedForEmailSearch = items.filter((item) => selected.has(item.id) && canSearchEmail(item));
  const allVisibleSelected = selectableVisible.length > 0 && selectableVisible.every((item) => selected.has(item.id));
  const run = (work: () => Promise<{ ok: boolean; error?: string; toast?: string }>, onSuccess?: () => void) =>
    start(async () => {
      const result = await work();
      if (!result.ok) toast(result.error ?? "Something went wrong.");
      else {
        if (result.toast) toast(result.toast);
        onSuccess?.();
      }
      setSending(null);
      router.refresh();
    });
  const toggleSelected = (id: string, checked: boolean) => setSelected((current) => {
    const next = new Set(current);
    if (checked) next.add(id);
    else next.delete(id);
    return next;
  });
  const toggleVisible = (checked: boolean) => setSelected((current) => {
    const next = new Set(current);
    for (const item of selectableVisible) {
      if (checked) next.add(item.id);
      else next.delete(item.id);
    }
    return next;
  });

  if (items.length === 0) return (
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
            <p className="font-medium" aria-live="polite">
              {items.length} {items.length === 1 ? "review" : "reviews"} waiting
            </p>
            <p className="mt-1 text-sm text-muted">
              {visibleItems.length === items.length ? "Showing all reviews" : `Showing ${visibleItems.length} of ${items.length}`}
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
              value={matchBelow}
              onChange={(event) => setMatchBelow(event.target.value)}
            />
            <Select className="w-48" label="Application email" value={emailFilter} onChange={(event) => setEmailFilter(event.target.value as typeof emailFilter)}>
              <option value="all">All email states</option>
              <option value="not-found">No email found</option>
              <option value="found">Email found</option>
            </Select>
            <Select className="w-48" label="Sort by" value={sort} onChange={(event) => setSort(event.target.value as typeof sort)}>
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
      {visibleItems.length === 0 && (
        <p className="rounded-panel border border-line-card bg-card p-7 text-sm text-muted">No reviews match the current filters.</p>
      )}
      {visibleItems.map((item) => (
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
              onClick={() => setExpanded((current) => ({ ...current, [item.id]: !current[item.id] }))}
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
            <section id={`posting-${item.id}`} aria-label="Original posting" className="mt-4 rounded-control border border-line-field p-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <p className="text-sm text-muted">{[item.place, item.remote ? "Remote" : ""].filter(Boolean).join(" · ") || "Location not provided"}</p>
                {item.postingUrl && (
                  <a href={item.postingUrl} target="_blank" rel="noopener noreferrer" className={buttonClassName("text", "sm")}>
                    Open original posting<span aria-hidden> ↗</span><span className="sr-only"> (opens in a new tab)</span>
                  </a>
                )}
              </div>
              <div className="mt-3 max-h-80 overflow-y-auto border-t border-line pt-3 text-sm leading-relaxed whitespace-pre-line text-document">
                {item.postingText || "The source did not provide the posting text."}
              </div>
            </section>
          )}
          {item.mandatory.length > 0 && (
            <div className="mt-4 text-sm">
              <span className="font-medium">Mandatory requirements</span>
              <ul className="mt-1 list-disc pl-5 text-muted">{item.mandatory.map((requirement) => <li key={requirement}>{requirement}</li>)}</ul>
            </div>
          )}
          {item.applicationId && (
            <div className="mt-4 rounded-control border border-line-field p-4 text-sm">
              <div><span className="text-muted">To:</span> {item.to || "Missing"}</div>
              <div className="mt-1"><span className="text-muted">Subject:</span> {item.subject || "Missing"}</div>
              <p className="mt-3 line-clamp-3 whitespace-pre-line text-muted">{item.body}</p>
              <div className="mt-3 flex flex-wrap gap-2">
                <Link className={buttonClassName("secondary", "sm")} href={`/applications/${item.applicationId}?tab=resume`}>Review CV</Link>
                <Link className={buttonClassName("secondary", "sm")} href={`/applications/${item.applicationId}?tab=letter`}>Review cover letter</Link>
                <Link className={buttonClassName("secondary", "sm")} href={`/applications/${item.applicationId}?tab=email`}>Edit email</Link>
              </div>
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
                            <a href={candidate.sourceUrl} target="_blank" rel="noopener noreferrer" className="mt-2 inline-block text-sm underline">
                              {candidate.sourceTitle || "Open source"}<span aria-hidden> ↗</span><span className="sr-only"> (opens in a new tab)</span>
                            </a>
                          </div>
                          <Button
                            size="sm"
                            disabled={pending}
                            aria-label={`Use ${candidate.email} and prepare`}
                            onClick={() => run(() => provideAutomationRecipient({ candidateId: item.id, recipient: candidate.email }))}
                          >
                            Use this email
                          </Button>
                        </div>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              {item.emailDiscoveryError && <p role="alert" className="mb-4 rounded-control bg-danger-soft p-3 text-sm text-error-strong">Email search: {item.emailDiscoveryError}</p>}
              {item.emailDiscoverySearched && item.discoveredEmails.length === 0 && !item.emailDiscoveryError && (
                <p className="mb-4 rounded-control bg-selected p-3 text-sm text-muted">No public application email was found in the pages Dossier checked.</p>
              )}
              {emailSearchConfigured && (
                <Button
                  variant="secondary"
                  size="sm"
                  className="mb-4"
                  disabled={pending}
                  onClick={() => run(() => searchForAutomationRecipient({ candidateId: item.id }))}
                >
                  {item.emailDiscoverySearched ? "Search public pages again" : "Search public pages"}
                </Button>
              )}
              <p className="mb-3 text-sm text-muted">
                {item.discoveredEmails.length > 0 ? "Or enter another verified application address." : "Found a verified application address yourself? Add it here and Dossier will prepare this application for review."}
              </p>
              <div className="flex flex-wrap items-end gap-3">
                <Input
                  className="min-w-[260px] flex-1"
                  label="Application email"
                  type="email"
                  placeholder="jobs@example.com"
                  value={recipients[item.id] ?? item.recipientOverride}
                  onChange={(event) => setRecipients((current) => ({ ...current, [item.id]: event.target.value }))}
                />
                <Button
                  size="sm"
                  disabled={pending || !(recipients[item.id] ?? item.recipientOverride).trim()}
                  onClick={() => run(() => provideAutomationRecipient({
                    candidateId: item.id,
                    recipient: recipients[item.id] ?? item.recipientOverride,
                  }))}
                >
                  Use email and prepare
                </Button>
              </div>
            </div>
          )}
          <div className="mt-4 flex flex-wrap gap-3">
            {item.status === "FAILED" ? (
              <>
                <Button size="sm" disabled={pending} onClick={() => run(() => retryAutomationCandidate({ candidateId: item.id }))}>Retry</Button>
                <Button variant="danger-text" size="sm" disabled={pending} onClick={() => run(() => dismissAutomationCandidate({ candidateId: item.id }))}>Dismiss</Button>
              </>
            ) : item.status === "FILTERED" ? (
              <Button variant="danger-text" size="sm" disabled={pending} onClick={() => run(() => dismissAutomationCandidate({ candidateId: item.id }))}>Dismiss</Button>
            ) : item.applicationId ? (
              <>
                {item.delivery === "UNKNOWN" ? (
                  <>
                    <Button size="sm" onClick={() => run(() => markAutomationSent({ applicationId: item.applicationId! }))}>Mark sent</Button>
                    <Button variant="danger-outline" size="sm" onClick={() => setSending(item)}>Retry send</Button>
                  </>
                ) : (
                  <Button size="sm" disabled={pending || !gmail.email} onClick={() => setSending(item)}>Approve and send</Button>
                )}
                <Button variant="secondary" size="sm" disabled={pending} onClick={() => run(() => keepAutomationDraft({ applicationId: item.applicationId! }))}>Keep as draft</Button>
                <Button variant="danger-text" size="sm" disabled={pending} onClick={() => run(() => dismissAutomationDraft({ applicationId: item.applicationId! }))}>Dismiss</Button>
                {!gmail.email && <Link href="/settings?section=automation" className="self-center text-sm underline">Connect Gmail to send</Link>}
              </>
            ) : <span className="text-sm text-muted">Preparation is running in the background.</span>}
          </div>
        </article>
      ))}
      <ConfirmDialog
        open={confirmingDismiss}
        onOpenChange={setConfirmingDismiss}
        title={`Dismiss ${selected.size} selected ${selected.size === 1 ? "review" : "reviews"}?`}
        description="Prepared application drafts will be deleted, and these postings will not be prepared again. This cannot be undone."
        confirmLabel="Dismiss selected"
        onConfirm={() => run(
          () => dismissAutomationCandidates({ candidateIds: [...selected] }),
          () => {
            setSelected(new Set());
            setConfirmingDismiss(false);
          },
        )}
      />
      <ConfirmDialog
        open={sending !== null}
        onOpenChange={(open) => !open && setSending(null)}
        title={sending?.delivery === "UNKNOWN" ? "Retry this unconfirmed email?" : "Send this application?"}
        description={sending ? `To ${sending.to}. Subject: ${sending.subject}. Gmail will send the CV and cover letter as two PDF attachments.` : ""}
        confirmLabel={sending?.delivery === "UNKNOWN" ? "Retry send" : "Send email"}
        onConfirm={() => sending?.applicationId && run(() => approveAndSend({ applicationId: sending.applicationId!, retryUnknown: sending.delivery === "UNKNOWN" }))}
      />
    </div>
  );
}

function confidenceLabel(confidence: DiscoveredEmail["confidence"]): string {
  if (confidence === "HIGH") return "High confidence";
  if (confidence === "MEDIUM") return "Medium confidence";
  return "Low confidence";
}
