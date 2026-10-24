"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";

import type { ReviewProgress } from "@/lib/review-list";

const REFRESH_MS = 5_000;

/** Shows how far the running automation has come, and keeps the page fresh until it finishes. */
export function ReviewProgressPanel({ progress }: { progress: ReviewProgress | null }) {
  const router = useRouter();
  const active = progress !== null;
  useEffect(() => {
    if (!active) return;
    const timer = setInterval(() => {
      if (document.visibilityState === "visible") router.refresh();
    }, REFRESH_MS);
    return () => clearInterval(timer);
  }, [active, router]);
  if (!progress) return null;

  const { searching, profilesSearched, profilesTotal, scanned, candidates, analyzed, analyzing, etaMinutes } = progress;
  const percent = searching || candidates === 0 ? null : Math.round((analyzed / candidates) * 100);
  return (
    <section aria-label="Automation progress" className="mx-14 mb-4 rounded-panel border border-line-card bg-card p-5">
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <p className="font-medium">{searching ? "Searching for job postings…" : "AI is reviewing the postings it found"}</p>
        {etaMinutes !== null && !searching && <p className="text-sm text-muted">About {etaMinutes} min left</p>}
      </div>
      <div
        role="progressbar"
        aria-label="Postings reviewed by the AI"
        aria-valuemin={0}
        aria-valuemax={candidates}
        aria-valuenow={analyzed}
        aria-valuetext={`${analyzed} of ${candidates} postings reviewed`}
        className="mt-3 h-2 overflow-hidden rounded-full bg-selected"
      >
        <div className={`h-full rounded-full bg-primary transition-[width] ${percent === null ? "w-1/3 animate-pulse" : ""}`} style={percent === null ? undefined : { width: `${percent}%` }} />
      </div>
      <dl className="mt-3 grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
        <div><dt className="text-muted">Profiles searched</dt><dd className="font-medium">{profilesSearched} / {profilesTotal}</dd></div>
        <div><dt className="text-muted">Postings scanned</dt><dd className="font-medium">{scanned}</dd></div>
        <div><dt className="text-muted">Sent to the AI</dt><dd className="font-medium">{candidates}</dd></div>
        <div><dt className="text-muted">AI finished</dt><dd className="font-medium">{analyzed} / {candidates}{analyzing > 0 ? ` · ${analyzing} in progress` : ""}</dd></div>
      </dl>
    </section>
  );
}
