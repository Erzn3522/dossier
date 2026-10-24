"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { toastResult } from "@/components/toast";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { useJob } from "@/hooks/use-job";
import { retry } from "@/lib/jobs/actions";
import { QUICK_APPLY_STEPS } from "@/lib/quick-apply";

import { JobProgress, jobStep } from "../new/job-progress";
import { fetchPostingText } from "../new/actions";

import { startQuickApply } from "./actions";

type Result = { applicationId: string };

export function QuickApplyForm({ aiReady, jobId }: { aiReady: boolean; jobId: string | null }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [postingUrl, setPostingUrl] = useState("");
  const [posting, setPosting] = useState("");
  const [recipient, setRecipient] = useState("");
  const [note, setNote] = useState("");
  const [fetching, setFetching] = useState(false);
  const [running, setRunning] = useState<string | null>(jobId);
  const [revision, setRevision] = useState(0);

  const job = useJob<Result>(running, revision, (update) => {
    if (update.status === "DONE" && update.result) router.push(`/apply/${update.result.applicationId}`);
  });

  const fetchLink = async () => {
    setFetching(true);
    const result = toastResult(await fetchPostingText({ link: postingUrl }));
    setFetching(false);
    if (result.ok) {
      setPosting(result.data.text);
      setPostingUrl(result.data.url);
    }
  };

  const prepare = () => start(async () => {
    const result = toastResult(await startQuickApply({ posting, postingUrl, recipient, note }));
    if (!result.ok) return;
    setRunning(result.data);
    router.replace(`/apply?job=${result.data}`, { scroll: false });
  });

  // The same job again, with the posting it was given, even after a reload emptied the form.
  const retryRunning = () => start(async () => {
    if (!running) return;
    const result = toastResult(await retry({ id: running }));
    if (result.ok) setRevision((current) => current + 1);
  });

  const back = () => {
    setRunning(null);
    router.replace("/apply", { scroll: false });
  };

  if (running) {
    const failed = job?.status === "FAILED";
    return (
      <div className="mx-14 mb-16 grid max-w-[760px] gap-4">
        <JobProgress
          title={job?.status === "QUEUED" ? "Waiting for the AI to finish its current task…" : "Preparing your application"}
          steps={QUICK_APPLY_STEPS}
          current={jobStep(QUICK_APPLY_STEPS, job)}
          error={failed ? job.error ?? "Preparing the application failed." : null}
          onRetry={retryRunning}
          onBack={back}
          backLabel="← Back to the form"
        />
        {job?.status === "QUEUED" && (
          <p className="text-sm text-muted">This goes ahead of the automatic job search, so it starts as soon as the current posting is done.</p>
        )}
      </div>
    );
  }

  return (
    <div className="mx-14 mb-16 grid max-w-[760px] gap-4">
      {!aiReady && (
        <p role="alert" className="rounded-control bg-danger-soft p-3 text-sm text-error-strong">
          Set up an AI model in <Link className="underline" href="/settings">Settings</Link> first.
        </p>
      )}
      <Card className="grid gap-5">
        <h2 className="font-serif text-section">The posting</h2>
        <div className="flex flex-wrap items-end gap-3">
          <Input
            className="min-w-[280px] flex-1"
            label="Link to the posting"
            type="url"
            placeholder="https://company.com/careers/vision-engineer"
            value={postingUrl}
            onChange={(event) => setPostingUrl(event.target.value)}
          />
          <Button variant="secondary" disabled={!postingUrl.trim() || fetching} onClick={() => void fetchLink()}>
            {fetching ? "Fetching…" : "Fetch the posting"}
          </Button>
        </div>
        <Textarea
          label="Posting text"
          hint="Fetched from the link, or paste it here. Check it reads like the posting before you go on."
          rows={14}
          value={posting}
          onChange={(event) => setPosting(event.target.value)}
        />
      </Card>
      <Card className="grid gap-5">
        <h2 className="font-serif text-section">Sending it</h2>
        <Input
          label="Application email (optional)"
          type="email"
          hint="Where to send the application. Leave it empty to use the address in the posting, if it gives one."
          placeholder="jobs@company.com"
          value={recipient}
          onChange={(event) => setRecipient(event.target.value)}
        />
        <Textarea
          label="Anything I should know? (optional)"
          hint="e.g. a referral, why this company, or what to stress. It goes into the letter and the email."
          rows={3}
          value={note}
          onChange={(event) => setNote(event.target.value)}
        />
      </Card>
      <div>
        <Button disabled={!aiReady || !posting.trim() || pending} onClick={prepare}>
          {pending ? "Starting…" : "Prepare application →"}
        </Button>
      </div>
    </div>
  );
}
