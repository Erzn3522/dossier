"use client";

import Link from "next/link";
import { useState, useTransition } from "react";

import { DownloadPdfButton } from "@/components/documents/download-pdf-button";
import { toast, toastResult } from "@/components/toast";
import { Button, buttonClassName } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { emailAddresses, type EmailParts } from "@/lib/application-email";
import { copyText } from "@/lib/copy-text";
import type { ResumeAdvice } from "@/lib/resume-advice";

import { saveQuickApplyEmail, sendQuickApply } from "../actions";

type Delivery = { status: string; recipient: string; sentAt: string | null; error: string | null } | null;

type Props = {
  applicationId: string;
  postingUrl: string;
  score: { hit: number; total: number; percent: number } | null;
  gaps: number;
  advice: ResumeAdvice;
  letter: string[];
  email: EmailParts;
  delivery: Delivery;
  gmail: { configured: boolean; email: string | null };
};

export function QuickApplyResult({ applicationId, postingUrl, score, gaps, advice, letter, email, delivery, gmail }: Props) {
  const [pending, start] = useTransition();
  const [saved, setSaved] = useState(email);
  const [draft, setDraft] = useState(email);
  const [confirming, setConfirming] = useState(false);
  const dirty = draft.to !== saved.to || draft.subject !== saved.subject || draft.body !== saved.body;
  const recipients = emailAddresses(draft.to);
  const sendable = recipients.length === 1 && draft.subject.trim() !== "" && draft.body.trim() !== "";
  const sent = delivery?.status === "SENT";
  const unknown = delivery?.status === "UNKNOWN";
  const application = (tab: string) => `/applications/${applicationId}?tab=${tab}`;

  const save = (then?: () => void) => start(async () => {
    const result = toastResult(await saveQuickApplyEmail({ id: applicationId, ...draft }));
    if (!result.ok) return;
    setSaved(draft);
    then?.();
  });
  const send = () => start(async () => {
    setConfirming(false);
    toastResult(await sendQuickApply({ id: applicationId, retryUnknown: unknown }));
  });
  const copyLetter = async () => toast((await copyText(letter.join("\n\n"))) ? "Copied the cover letter." : "That didn't copy. Select the text and copy it yourself.");

  return (
    <div className="mx-14 mb-16 grid max-w-[860px] gap-5">
      <div className="flex flex-wrap items-center gap-3 text-sm">
        {score && (
          <span className="rounded-full bg-selected px-3 py-1 font-medium">
            {score.percent}% match · {score.hit} of {score.total} requirements{gaps > 0 ? ` · ${gaps} missing` : ""}
          </span>
        )}
        {postingUrl && (
          <a href={postingUrl} target="_blank" rel="noopener noreferrer" className={buttonClassName("text", "sm")}>
            Original posting<span aria-hidden> ↗</span><span className="sr-only"> (opens in a new tab)</span>
          </a>
        )}
        <Link href={`/applications/${applicationId}`} className={buttonClassName("text", "sm")}>Open the full application</Link>
        <Link href="/apply" className={buttonClassName("text", "sm")}>Another posting</Link>
      </div>

      <Card className="grid gap-4" aria-labelledby="advice-heading">
        <div className="flex flex-wrap items-baseline justify-between gap-3">
          <h2 id="advice-heading" className="font-serif text-section">What to fix in your CV</h2>
          <span className="text-sm text-muted">{advice.length} {advice.length === 1 ? "suggestion" : "suggestions"}</span>
        </div>
        {advice.length === 0 ? (
          <p className="text-sm text-muted">Nothing stood out: your CV already fits this posting well.</p>
        ) : (
          <ol className="grid gap-3">
            {advice.map((item, index) => (
              <li key={index} className="rounded-control border border-line-field p-4">
                <span className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${item.from === "match" ? "bg-danger-soft text-error-strong" : "bg-selected"}`}>{item.area}</span>
                <p className="mt-2 text-sm font-medium">{item.suggestion}</p>
                {item.reason && <p className="mt-1 text-sm text-muted">{item.reason}</p>}
              </li>
            ))}
          </ol>
        )}
        <div className="flex flex-wrap gap-2 border-t border-line pt-4">
          <Link href="/profile" className={buttonClassName("secondary", "sm")}>Update your profile</Link>
          <Link href={application("resume")} className={buttonClassName("secondary", "sm")}>See the tailored CV</Link>
          <DownloadPdfButton href={`/api/pdf?doc=resume&application=${applicationId}`} variant="secondary" size="sm" progress="Rendering your resume as a PDF…">
            Download CV PDF
          </DownloadPdfButton>
        </div>
        <p className="text-xs text-muted">Changes to your profile apply to your next applications. To fix only this one, edit the tailored CV.</p>
      </Card>

      <Card className="grid gap-4" aria-labelledby="letter-heading">
        <h2 id="letter-heading" className="font-serif text-section">Cover letter</h2>
        {letter.length === 0 ? (
          <p className="text-sm text-muted">The cover letter isn&apos;t written.</p>
        ) : (
          <div className="grid gap-3 rounded-control border border-line-field bg-input p-5 text-sm leading-relaxed text-document">
            {letter.map((paragraph, index) => <p key={index}>{paragraph}</p>)}
          </div>
        )}
        <div className="flex flex-wrap gap-2">
          <Button variant="secondary" size="sm" disabled={letter.length === 0} onClick={() => void copyLetter()}>Copy text</Button>
          <Link href={application("letter")} className={buttonClassName("secondary", "sm")}>Edit the letter</Link>
          <DownloadPdfButton href={`/api/pdf?doc=letter&application=${applicationId}`} variant="secondary" size="sm" progress="Rendering your cover letter as a PDF…">
            Download PDF
          </DownloadPdfButton>
        </div>
      </Card>

      <Card className="grid gap-4" aria-labelledby="email-heading">
        <h2 id="email-heading" className="font-serif text-section">Email</h2>
        {sent ? (
          <p role="status" className="rounded-control bg-selected p-3 text-sm">
            Sent to {delivery.recipient}{delivery.sentAt ? ` on ${new Date(delivery.sentAt).toLocaleString()}` : ""}, with your CV and cover letter attached.
          </p>
        ) : (
          <>
            {delivery?.status === "FAILED" && delivery.error && <p role="alert" className="rounded-control bg-danger-soft p-3 text-sm text-error-strong">The last attempt failed: {delivery.error}</p>}
            {unknown && <p role="alert" className="rounded-control bg-danger-soft p-3 text-sm text-error-strong">Gmail didn&apos;t confirm the last attempt. Check your Sent folder before you send it again.</p>}
            <Input
              label="To"
              type="email"
              placeholder="jobs@company.com"
              hint={draft.to.trim() ? undefined : "The posting didn't give an address. Add the one you found."}
              value={draft.to}
              onChange={(event) => setDraft({ ...draft, to: event.target.value })}
            />
            <Input label="Subject" value={draft.subject} onChange={(event) => setDraft({ ...draft, subject: event.target.value })} />
            <Textarea label="Message" rows={10} value={draft.body} onChange={(event) => setDraft({ ...draft, body: event.target.value })} />
            <p className="text-xs text-muted">Attached: your tailored CV and the cover letter, as PDFs.</p>
            <div className="flex flex-wrap items-center gap-3">
              {gmail.email ? (
                <Button disabled={pending || !sendable} onClick={() => (dirty ? save(() => setConfirming(true)) : setConfirming(true))}>
                  {unknown ? "Retry send" : "Send with Gmail"}
                </Button>
              ) : (
                <Link href="/settings?section=automation" className={buttonClassName("primary", "md")}>Connect Gmail to send</Link>
              )}
              <Button variant="secondary" disabled={pending || !dirty} onClick={() => save()}>Save email</Button>
              {gmail.email && <span className="text-sm text-muted">From {gmail.email}</span>}
            </div>
          </>
        )}
      </Card>

      <ConfirmDialog
        open={confirming}
        onOpenChange={setConfirming}
        title={unknown ? "Retry this unconfirmed email?" : "Send this application?"}
        description={`To ${recipients[0] ?? draft.to}. Subject: ${draft.subject}. Gmail will send your CV and cover letter as two PDF attachments.`}
        confirmLabel={unknown ? "Retry send" : "Send email"}
        onConfirm={send}
      />
    </div>
  );
}
