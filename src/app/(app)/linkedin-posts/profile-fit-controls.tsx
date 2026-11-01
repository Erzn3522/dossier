"use client";

import Link from "next/link";
import { useEffect, useState, useTransition } from "react";
import { toastResult } from "@/components/toast";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/select";
import { FIT_FILTERS, type FitFilter, type FitScope, type ProfileFitState, type ProfileFitView } from "@/lib/linkedin-posts/profile-fit-data";
import { loadProfileMatch, startProfileMatch, stopProfileMatch } from "./profile-fit-actions";

export function ProfileFitControls({ scope, mode, onModeChange, onChange }: {
  scope: FitScope; mode: FitFilter; onModeChange: (mode: FitFilter) => void; onChange: (state: ProfileFitState) => void;
}) {
  const [state, setState] = useState<ProfileFitState | null>(null);
  const [error, setError] = useState("");
  const [pending, startTransition] = useTransition();
  useEffect(() => {
    let stopped = false;
    let timer: ReturnType<typeof setTimeout>;
    const tick = async () => {
      try {
        const result = await loadProfileMatch({ kind: scope.kind, id: scope.id });
        if (stopped) return;
        if (result.ok) { setState(result.data); onChange(result.data); setError(""); }
        else setError(result.error);
      } catch { if (!stopped) setError("Could not refresh profile matching. Try again."); }
      if (!stopped) timer = setTimeout(() => void tick(), 4000);
    };
    timer = setTimeout(() => void tick(), 100);
    return () => { stopped = true; clearTimeout(timer); };
  }, [scope.kind, scope.id, onChange]);
  const running = state?.run?.active ?? state?.run?.status === "RUNNING";
  return <div className="rounded-panel border border-line-card bg-card p-5">
    <div className="flex flex-wrap items-end justify-between gap-4">
      <div className="max-w-[520px]"><h3 className="text-sm font-medium">AI profile matching</h3><p className="mt-1 text-xs text-muted">Compare posts with your skills, experience, languages and education using your selected AI. Uncertain matches stay visible; posts are never automatically dismissed.</p></div>
      <div className="flex flex-wrap items-end gap-3">
        <Select label="Profile fit" aria-label={`Profile fit in ${scope.kind} search`} className="min-w-[180px]" value={mode} onChange={(e) => onModeChange(e.target.value as FitFilter)}>{FIT_FILTERS.map((filter) => <option key={filter.value} value={filter.value}>{filter.label}</option>)}</Select>
        {running ? <Button variant="secondary" size="sm" disabled={pending} onClick={() => startTransition(async () => {
          const result = toastResult(await stopProfileMatch(scope)); if (result.ok) { setState(result.data); onChange(result.data); }
        })}>Stop matching</Button> : <Button variant="secondary" size="sm" disabled={pending || !state?.available || !state.profileReady} onClick={() => startTransition(async () => {
          const result = toastResult(await startProfileMatch(scope)); if (result.ok) { setState(result.data); onChange(result.data); onModeChange("hide_unsuitable"); setError(""); } else setError(result.error);
        })}>{pending ? "Starting…" : state?.run && ["PAUSED", "FAILED"].includes(state.run.status) ? "Resume matching" : state?.run ? "Match again" : "Match my profile"}</Button>}
      </div>
    </div>
    {state && !state.profileReady && <p className="mt-3 text-xs text-muted"><Link href="/profile" className="underline">Add your skills and experience in Profile</Link> to match these posts.</p>}
    {state && !state.available && <p className="mt-3 text-xs text-muted">Restart Dossier to enable the profile-matching database update.</p>}
    {state?.run && <p role="status" className="mt-3 text-xs text-muted">{state.run.status === "STALE" ? "Your profile or AI settings changed. Match again to refresh old results." : `${state.run.processed} / ${state.run.total} posts reviewed or skipped · ${state.run.status.toLowerCase()}`}{state.run.status === "COMPLETE" ? ". Match again to include newly fetched posts; unchanged results are reused." : ""}</p>}
    {(error || state?.run?.error) && <p role="alert" className="mt-3 text-xs text-error">{error || state?.run?.error}</p>}
    <p className="mt-3 text-xs text-muted">No new Apify search. Hosted AI usage may cost extra. Only documented mandatory conflicts or clearly unrelated posts are hidden by “Hide unsuitable”; use All posts to review them.</p>
  </div>;
}
export function ProfileFitDetails({ fit }: { fit?: ProfileFitView | null }) {
  if (!fit) return <span className="text-xs text-muted">Profile fit: not assessed</span>;
  const label = { suitable: "Suitable", review: "Needs review", not_suitable: "Not suitable", unavailable: "Not assessed" }[fit.verdict];
  return <div className="flex flex-col gap-2">
    <span className={`self-start rounded-control bg-selected px-2 py-1 text-xs font-medium ${fit.verdict === "suitable" ? "text-success" : fit.verdict === "not_suitable" ? "text-error" : "text-muted"}`}>Profile fit: {label}</span>
    <details className="text-xs"><summary className="cursor-pointer text-muted">Why this match?</summary><div className="mt-3 flex flex-col gap-3">
      <p>{fit.summary}</p>
      {fit.requirements.map((r, i) => <div key={i} className="border-l border-line pl-3"><p className="font-medium">{r.required ? "Required" : "Preferred / context"}: {r.requirement} · {r.result === "covered" ? "Supported" : r.result === "gap" ? "Documented gap" : "Unknown"}</p><blockquote className="mt-1 text-muted">Post: “{r.quote}”</blockquote><p className="mt-1 text-muted">Profile: {r.profileEvidence || "No verified profile evidence; manual review needed."}</p></div>)}
      <p className="text-muted">AI estimate from {fit.provider} · {fit.model}. Check the original post before deciding.</p>
    </div></details>
  </div>;
}
