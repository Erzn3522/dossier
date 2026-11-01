"use client";

import { useCallback, useEffect, useRef, useState, useTransition } from "react";
import { toastResult } from "@/components/toast";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { DEFAULT_CAMPAIGN_FILTERS, type CampaignFilters, type CampaignSummary, type CampaignView } from "@/lib/linkedin-posts/campaign-data";
import { cancelLinkedInCampaign, deleteLinkedInCampaign, listLinkedInCampaigns, loadLinkedInCampaign, resumeLinkedInCampaign } from "./campaign-actions";
import { useDismissals } from "./dismissal-context";
import { linkedInPostKey } from "@/lib/linkedin-posts/post-key";
import { PostCard } from "./post-card";
import { ProfileFitControls, ProfileFitDetails } from "./profile-fit-controls";
import type { ProfileFitState } from "@/lib/linkedin-posts/profile-fit-data";

export function CampaignPanel({ initial = [], selectedId, onActiveChange, onReuse, timeZone = "UTC" }: {
  initial?: CampaignSummary[]; timeZone?: string; selectedId: string | null; onActiveChange: (active: boolean) => void; onReuse: (campaign: CampaignSummary) => void;
}) {
  const dismissals = useDismissals();
  const dismissalRevision = dismissals?.revision ?? 0;
  const [history, setHistory] = useState(initial);
  const [id, setId] = useState<string | null>(selectedId ?? initial[0]?.id ?? null);
  const [view, setView] = useState<CampaignView | null>(null);
  const [filters, setFilters] = useState<CampaignFilters>(DEFAULT_CAMPAIGN_FILTERS);
  const [fitState, setFitState] = useState<ProfileFitState | null>(null);
  const [page, setPage] = useState(1);
  const [error, setError] = useState("");
  const [pending, startTransition] = useTransition();
  const request = useRef({ version: 0 });
  const refresh = useCallback(async () => {
    const version = ++request.current.version;
    const [list, detail] = await Promise.all([listLinkedInCampaigns({}), id ? loadLinkedInCampaign({ id, filters, page }) : Promise.resolve(null)]);
    if (version !== request.current.version) return;
    if (list.ok) { setHistory(list.data); onActiveChange(list.data.some((row) => ["RUNNING", "CANCELLING"].includes(row.status))); }
    if (detail?.ok) { setView(detail.data); setError(""); } else if (detail && !detail.ok) setError(detail.error);
    if (!list.ok) setError(list.error);
  }, [id, filters, page, onActiveChange, request]);
  useEffect(() => {
    if (!selectedId) return;
    const timer = setTimeout(() => { setId(selectedId); setFilters(DEFAULT_CAMPAIGN_FILTERS); setPage(1); }, 0);
    return () => clearTimeout(timer);
  }, [selectedId]);
  useEffect(() => {
    const currentRequest = request.current;
    let stopped = false;
    let timer: ReturnType<typeof setTimeout>;
    const tick = async () => { try { await refresh(); } catch { if (!stopped) setError("Could not refresh the AI search. Try again."); } if (!stopped) timer = setTimeout(() => void tick(), 5000); };
    timer = setTimeout(() => void tick(), 250);
    return () => { stopped = true; ++currentRequest.version; clearTimeout(timer); };
  }, [refresh, request, dismissalRevision, fitState?.profileHash, fitState?.run?.processed, fitState?.run?.status]);
  function change<K extends keyof CampaignFilters>(key: K, value: CampaignFilters[K]) { setFilters((f) => ({ ...f, [key]: value })); setPage(1); }
  const current = view?.id === id ? view : null;
  if (!history.length && !id && !error) return <Card><h2 className="font-serif text-section">No AI searches yet</h2><p className="mt-2 text-sm text-muted">Choose New search to explore posts across your target countries.</p></Card>;
  const activeRound = current?.attempts.find((attempt) => !["COMPLETE", "CANCELLED", "IMPORTED"].includes(attempt.status));
  const labels: Record<string, string> = { RUNNING: "Searching", CANCELLING: "Stopping", COMPLETE: "Complete", PAUSED: "Paused", FAILED: "Needs attention", CANCELLED: "Cancelled", IMPORTED: "Imported", PENDING: "Waiting", PLANNING: "Preparing queries", PLANNED: "Ready to search", STARTING: "Starting search", SEARCHING: "Fetching posts", ANALYZING: "Assessing posts", UNKNOWN: "Check run status" };
  return <section aria-label="AI searches" className="flex flex-col gap-5">
    <div className="flex flex-wrap items-end justify-between gap-4">
      <div><h2 className="font-serif text-section">AI search results</h2><p className="mt-1 text-sm text-muted">Review opportunities while your search continues.</p></div>
      <Select label="Campaign history" value={id ?? ""} onChange={(e) => { setId(e.target.value); setPage(1); setFilters(DEFAULT_CAMPAIGN_FILTERS); }} className="w-full sm:max-w-[420px]">
        <option value="" disabled>Select an AI search</option>{history.map((row) => <option key={row.id} value={row.id}>{row.input.countries.join(", ")} · {row.completed}/{row.total} rounds · {labels[row.status] ?? row.status}</option>)}
      </Select>
    </div>
    {error && <p role="alert" className="text-sm text-error">{error}</p>}
    {current && <>
      <Card className="flex flex-col gap-5 p-5!">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0 max-w-[640px]"><h3 className="line-clamp-2 text-sm font-medium">{current.input.keywords.join(" · ")}</h3><p className="mt-2 text-sm text-muted">{current.input.countries.join(" / ")}</p></div>
          <span role="status" className="rounded-control bg-selected px-3 py-1.5 text-xs font-medium">{labels[current.status] ?? current.status}</span>
        </div>
        <div className="grid grid-cols-2 gap-4 border-y border-line py-4 sm:grid-cols-4">
          <div><p className="font-serif text-2xl">{current.found}</p><p className="text-xs text-muted">Unique posts</p></div>
          <div><p className="font-serif text-2xl">{current.completed}<span className="text-base text-muted"> / {current.total}</span></p><p className="text-xs text-muted">Rounds completed</p></div>
          <div><p className="font-serif text-2xl">{current.input.countries.length}</p><p className="text-xs text-muted">Target countries</p></div>
          <div><p className="font-serif text-2xl">${current.input.budgetUsd.toFixed(2)}</p><p className="text-xs text-muted">Apify budget cap</p></div>
        </div>
        <div><progress className="h-1.5 w-full accent-ink" value={current.completed} max={Math.max(1, current.total)} aria-label="AI search progress" />
          {current.status === "RUNNING" && activeRound && <p className="mt-2 text-xs text-muted">{activeRound.country} · round {activeRound.round} · {labels[activeRound.status] ?? activeRound.status}</p>}
        </div>
        <div className="flex flex-wrap items-center gap-4">
          {["PAUSED", "FAILED"].includes(current.status) && <Button disabled={pending} onClick={() => startTransition(async () => { const r = toastResult(await resumeLinkedInCampaign({ id: current.id })); if (r.ok) await refresh(); })}>Resume</Button>}
          <Button variant="secondary" size="sm" onClick={() => onReuse(current)}>Reuse topics and countries</Button>
          {["RUNNING", "PAUSED", "FAILED"].includes(current.status) && <Button variant="text" disabled={pending} onClick={() => startTransition(async () => { const r = toastResult(await cancelLinkedInCampaign({ id: current.id })); if (r.ok) await refresh(); })}>Cancel AI search</Button>}
        </div>
        {current.error && <p role="alert" className="text-sm text-error">{current.error}</p>}
        <details className="text-xs text-muted"><summary className="cursor-pointer">Search settings & costs</summary><div className="mt-3 flex flex-col gap-3">
          <p>{current.provider} · {current.model} · ${current.reservedUsd.toFixed(6)} allocated to submitted/unconfirmed runs. Allocated caps are not actual charges.</p>
          <p>Starts with your manual queries, then broadens to short topic searches and AI variants. Good results do not stop later rounds.</p>
          {["COMPLETE", "CANCELLED", "IMPORTED"].includes(current.status) && <Button variant="danger-text" className="self-start" disabled={pending} onClick={() => startTransition(async () => { const r = toastResult(await deleteLinkedInCampaign({ id: current.id })); if (r.ok) { ++request.current.version; setHistory((rows) => rows.filter((row) => row.id !== current.id)); setId(null); setView(null); setError(""); } })}>Delete AI search</Button>}
        </div></details>
      </Card>
      <ProfileFitControls key={current.id} scope={{ kind: "campaign", id: current.id }} mode={filters.profileFit} onModeChange={(mode) => change("profileFit", mode)} onChange={setFitState} />
      <div className="flex flex-wrap items-end gap-4">
        <Input label="AI results contain" className="min-w-[180px] flex-1" value={filters.text} onChange={(e) => change("text", e.target.value)} placeholder="Search posts or authors…" />
        <Select label="AI result order" className="w-full sm:w-[180px]" value={filters.sort} onChange={(e) => change("sort", e.target.value as CampaignFilters["sort"])}><option value="newest">Newest first</option><option value="relevance">Relevant first</option><option value="likes">Most liked</option></Select>
        <Button variant="text" size="sm" onClick={() => { setFilters(DEFAULT_CAMPAIGN_FILTERS); setPage(1); }}>Reset AI filters</Button>
      </div>
      <details className="rounded-panel border border-line-card bg-card p-5"><summary className="cursor-pointer text-sm font-medium">More filters</summary><div className="mt-4 flex flex-col gap-4">
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <Input label="Location in AI results" value={filters.location} onChange={(e) => change("location", e.target.value)} />
          <Input label="Exclude from AI results" value={filters.exclude} onChange={(e) => change("exclude", e.target.value)} placeholder="intern, unpaid" />
          <Select label="Country confidence" value={filters.confidence} onChange={(e) => change("confidence", e.target.value as CampaignFilters["confidence"])}><option value="all">All, including uncertain</option><option value="confirmed">Confirmed evidence</option><option value="likely">Likely</option><option value="uncertain">Uncertain</option></Select>
          <Select label="AI result authors" value={filters.authorType} onChange={(e) => change("authorType", e.target.value as CampaignFilters["authorType"])}><option value="all">All authors</option><option value="company">Companies</option><option value="person">People</option></Select>
        </div>
        <div className="flex flex-wrap gap-5 text-sm"><label><input type="checkbox" checked={filters.relevantOnly} onChange={(e) => change("relevantOnly", e.target.checked)} /> Relevant hiring opportunities</label><label><input type="checkbox" checked={filters.hiringOnly} onChange={(e) => change("hiringOnly", e.target.checked)} /> Hiring signal</label><label><input type="checkbox" checked={filters.remoteOnly} onChange={(e) => change("remoteOnly", e.target.checked)} /> Mentions remote work</label></div>
        <p className="text-xs text-muted">AI estimates may be uncertain. Country confidence uses the strongest assessment across your target countries. Dismissed posts stay hidden; display filters never start new searches.</p>
      </div></details>
      <div role="status" className="flex flex-wrap items-center justify-between gap-4 text-sm text-muted"><span>{current.filtered} matching / {current.found} unique posts · page {current.page} of {current.pages}</span>
        <div className="flex gap-4"><Button variant="secondary" size="sm" disabled={current.page <= 1} onClick={() => setPage(current.page - 1)}>Previous</Button><Button variant="secondary" size="sm" disabled={current.page >= current.pages} onClick={() => setPage(current.page + 1)}>Next</Button></div></div>
      <div className="grid items-start gap-5 2xl:grid-cols-2">{current.posts.filter((entry) => !dismissals?.keys.has(linkedInPostKey(entry.post))).map((entry) => <PostCard key={entry.id} post={entry.post} timeZone={timeZone}>
        <ProfileFitDetails fit={entry.profileFit} />
        <div className="flex flex-wrap gap-2">{entry.assessments.map((a) => <span key={a.country} className="rounded-control bg-selected px-2 py-1 text-xs">{a.country} · {a.status === "unavailable" ? "Unassessed" : a.confidence}</span>)}</div>
        <details className="text-xs"><summary className="cursor-pointer text-muted">AI notes & sources</summary><div className="mt-3 flex flex-col gap-3">
          {entry.assessments.length ? entry.assessments.map((a) => <div key={a.country}><p className="font-medium">AI estimate · {a.country} · {a.confidence} · {a.status === "unavailable" ? "assessment unavailable" : a.relevant && a.hiring ? "relevant hiring" : "other / no hiring"}</p><p className="mt-1 text-muted">{a.reason}</p>{a.evidence && <blockquote className="mt-2 border-l border-line pl-3">{a.evidence}</blockquote>}</div>) : <p className="text-muted">Awaiting AI assessment; location is unverified.</p>}
          <div><p className="font-medium">Found in {entry.occurrences.length} rounds</p><ul className="mt-1 list-inside list-disc text-muted">{entry.occurrences.map((o) => <li key={`${o.country}-${o.round}`}>{o.country} · round {o.round}: {o.queries.join(" · ")}</li>)}</ul></div>
        </div></details>
      </PostCard>)}</div>
      {!current.posts.length && <Card><p className="text-sm text-muted">{current.found > 0 ? "No visible posts match these filters. Reset filters or check Dismissed to restore a post." : current.status === "COMPLETE" ? "No public posts matched the selected dates and authors. Try a wider date range." : "Your search is running. Posts appear here as they are fetched."}</p></Card>}
      <details className="rounded-panel border border-line-card bg-card p-5"><summary className="cursor-pointer text-sm font-medium">Round details · {current.completed} / {current.total} complete</summary>
        <div className="mt-4 overflow-x-auto"><table className="w-full text-left text-sm"><caption className="mb-3 text-left text-xs text-muted">Queries sent to Apify and the results from each round.</caption>
          <thead><tr className="border-b border-line">{["Country / round", "Stage", "Fetched", "New", "Repeats", "Relevant", "Cap"].map((name) => <th key={name} className="p-2 font-medium">{name}</th>)}</tr></thead>
          <tbody>{current.attempts.map((attempt) => <tr key={attempt.id} className="border-b border-line align-top">
            <td className="p-2">{attempt.country} · {attempt.round}</td><td className="min-w-[240px] p-2"><span>{labels[attempt.status] ?? attempt.status}</span>
              {!!attempt.queries.length && <details className="mt-2"><summary className="cursor-pointer text-muted">Queries and strategy</summary><p className="mt-2 text-xs text-muted">{attempt.strategy}</p><ul className="mt-2 list-inside list-disc text-xs">{attempt.queries.map((q) => <li key={q} className="wrap-anywhere">{q}</li>)}</ul></details>}
              {attempt.error && <p className="mt-2 text-xs text-error">{attempt.error}</p>}
              {attempt.runId && <a href={`https://console.apify.com/actors/runs/${encodeURIComponent(attempt.runId)}`} target="_blank" rel="noopener noreferrer" className="mt-2 block text-xs underline">View Apify run ↗</a>}
            </td><td className="p-2">{attempt.fetched}</td><td className="p-2">{attempt.fresh}</td><td className="p-2">{attempt.duplicates}</td><td className="p-2">{attempt.relevant}</td><td className="p-2">${attempt.capUsd.toFixed(6)}</td>
          </tr>)}</tbody>
        </table></div>
      </details>
    </>}
  </section>;
}
