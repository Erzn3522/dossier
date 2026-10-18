"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { toast } from "@/components/toast";
import { Button, buttonClassName } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Input } from "@/components/ui/input";

import {
  approveAndSend,
  dismissAutomationCandidate,
  dismissAutomationDraft,
  keepAutomationDraft,
  markAutomationSent,
  provideAutomationRecipient,
  retryAutomationCandidate,
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
};

export function ReviewQueue({ items, gmail }: { items: Item[]; gmail: { configured: boolean; email: string | null } }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [sending, setSending] = useState<Item | null>(null);
  const [recipients, setRecipients] = useState<Record<string, string>>({});
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const run = (work: () => Promise<{ ok: boolean; error?: string; toast?: string }>) =>
    start(async () => {
      const result = await work();
      if (!result.ok) toast(result.error ?? "Something went wrong.");
      else if (result.toast) toast(result.toast);
      setSending(null);
      router.refresh();
    });

  if (items.length === 0) return <p className="mx-14 rounded-panel border border-line-card bg-card p-7 text-sm text-muted">The review queue is empty.</p>;
  return (
    <div className="mx-14 mb-16 grid gap-4">
      {items.map((item) => (
        <article key={item.id} className="rounded-panel border border-line-card bg-card p-6">
          <button
            type="button"
            aria-expanded={expanded[item.id] ?? false}
            aria-controls={`posting-${item.id}`}
            onClick={() => setExpanded((current) => ({ ...current, [item.id]: !current[item.id] }))}
            className="flex w-full flex-wrap items-start justify-between gap-4 rounded-control text-left focus-visible:outline-2 focus-visible:outline-offset-4"
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
              <p className="mb-3 text-sm text-muted">Found a verified application address yourself? Add it here and Dossier will prepare this application for review.</p>
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
