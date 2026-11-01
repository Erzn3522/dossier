"use client";

import Link from "next/link";
import { formatTimestamp } from "@/lib/dates";
import { useCallback, useEffect, useRef, useState, useTransition } from "react";
import { toastResult } from "@/components/toast";
import { Button, buttonClassName } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { DismissalProvider, useDismissals } from "./dismissal-context";
import { DismissedPanel } from "./dismissed-panel";
import { linkedInPostKey } from "@/lib/linkedin-posts/post-key";
import { matchesFitFilter, type FitFilter, type ProfileFitState } from "@/lib/linkedin-posts/profile-fit-data";
import { ProfileFitControls, ProfileFitDetails } from "./profile-fit-controls";
import { DEFAULT_FILTERS, filterPosts, isSearching,
  type PostFilters, type PostSearchQuery, type PostSearchView } from "@/lib/linkedin-posts/data";
import type { SecretState } from "@/lib/secrets";
import { SearchComposer, type ComposerSubmission } from "./search-composer";
import { PostCard } from "./post-card";
import { CampaignPanel } from "./campaign-panel";
import { startLinkedInCampaign } from "./campaign-actions";
import type { CampaignSummary } from "@/lib/linkedin-posts/campaign-data";
import { cancelLinkedInSearch, deleteLinkedInSearch, loadLinkedInSearch, refreshLinkedInSearch, runLinkedInSearch } from "./actions";

type HistoryEntry = PostSearchView & { count: number };

type ScreenProps = { keyState: SecretState; initialSearches: HistoryEntry[]; initialCampaigns?: CampaignSummary[]; initialDismissedKeys?: string[]; timeZone?: string };
export function LinkedInPostsScreen(props: ScreenProps) {
  return <DismissalProvider initialKeys={props.initialDismissedKeys ?? []}><LinkedInWorkspace {...props} /></DismissalProvider>;
}
function LinkedInWorkspace({ keyState, initialSearches, initialCampaigns = [], timeZone = "UTC" }: ScreenProps) {
  const dismissals = useDismissals();
  const [tab, setTab] = useState(() => initialCampaigns.some((c) => ["RUNNING", "CANCELLING"].includes(c.status)) ? "ai"
    : initialSearches.some((s) => isSearching(s.status)) ? "manual"
      : (initialCampaigns[0]?.createdAt ?? "") > (initialSearches[0]?.createdAt ?? "") ? "ai" : "manual");
  const [showComposer, setShowComposer] = useState(!initialSearches.length && !initialCampaigns.length);
  const [history, setHistory] = useState(initialSearches);
  const [selected, setSelected] = useState<PostSearchView | null>(null);
  const [composer, setComposer] = useState<{ key: number; query?: PostSearchQuery; ai?: boolean }>({ key: 0 });
  const [campaignId, setCampaignId] = useState<string | null>(null);
  const [campaignActive, setCampaignActive] = useState(initialCampaigns.some((c) => ["RUNNING", "CANCELLING"].includes(c.status)));
  const [filters, setFilters] = useState<PostFilters>(DEFAULT_FILTERS);
  const [fitMode, setFitMode] = useState<FitFilter>("all");
  const [fitState, setFitState] = useState<ProfileFitState | null>(null);
  const [error, setError] = useState("");
  const [pollError, setPollError] = useState("");
  const [pending, startTransition] = useTransition();
  const selectedId = useRef<string | null>(null);
  const requestVersion = useRef(0);
  const active = history.some((s) => isSearching(s.status));

  const update = useCallback((search: PostSearchView) => {
    setSelected(search);
    selectedId.current = search.id;
    setHistory((items) => [{ ...search, posts: [], count: search.posts.length }, ...items.filter((s) => s.id !== search.id)]
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt)));
  }, []);

  const open = useCallback(async (id: string) => {
    const version = ++requestVersion.current;
    selectedId.current = id;
    setSelected(null); setPollError(""); setError("");
    const result = await loadLinkedInSearch({ id });
    if (version !== requestVersion.current) return;
    if (result.ok) { update(result.data); setFilters(DEFAULT_FILTERS); setFitMode("all"); }
    else setError(result.error);
  }, [update]);

  useEffect(() => {
    const timer = setTimeout(() => { if (initialSearches[0]) void open(initialSearches[0].id); }, 0);
    return () => clearTimeout(timer);
  }, [initialSearches, open]);

  const refresh = useCallback(async (id: string) => {
    const result = await refreshLinkedInSearch({ id });
    if (selectedId.current !== id) return;
    if (result.ok) { update(result.data); setPollError(""); }
    else setPollError(result.error);
  }, [update]);

  useEffect(() => {
    if (!selected || !isSearching(selected.status)) return;
    let stopped = false;
    let timer: ReturnType<typeof setTimeout>;
    const tick = async () => {
      await refresh(selected.id);
      if (!stopped) timer = setTimeout(() => void tick(), 5000);
    };
    timer = setTimeout(() => void tick(), 1500);
    return () => { stopped = true; clearTimeout(timer); };
  }, [selected?.id, selected?.status, refresh]); // eslint-disable-line react-hooks/exhaustive-deps

  function search(input: ComposerSubmission) {
    setError(""); setPollError("");
    startTransition(async () => {
      if (input.mode === "ai") {
        const result = await startLinkedInCampaign(input.query);
        if (result.ok) { setCampaignId(result.data.id); setCampaignActive(true); setTab("ai"); setShowComposer(false); }
        else setError(result.error);
      } else {
        const result = await runLinkedInSearch(input.query);
        if (result.ok) { ++requestVersion.current; update(result.data); setFilters(DEFAULT_FILTERS); setFitMode("all"); setTab("manual"); setShowComposer(false); }
        else setError(result.error);
      }
    });
  }
  function reuse(search: PostSearchView) { setComposer((c) => ({ key: c.key + 1, query: search.query, ai: false })); setShowComposer(true); }
  function filter<K extends keyof PostFilters>(key: K, value: PostFilters[K]) { setFilters((f) => ({ ...f, [key]: value })); }
  const keptPosts = (selected?.posts ?? []).filter((post) => !dismissals?.keys.has(linkedInPostKey(post)));
  const fits = fitState?.scope === `manual:${selected?.id}` ? fitState.results : {};
  const posts = filterPosts(keptPosts, filters).filter((post) => matchesFitFilter(fits[linkedInPostKey(post)], fitMode));

  return <div className="flex flex-col gap-6 px-6 pb-14 lg:px-14">
    {keyState !== "set" && <Card className="flex flex-wrap items-center justify-between gap-4">
      <p>{keyState === "unreadable" ? "Your Apify token could not be read. Enter it again to search." : "Connect Apify to start searching LinkedIn posts."}</p>
      <Link href="/settings?section=linkedin" className={buttonClassName("secondary")}>Set up Apify →</Link>
    </Card>}
    <Tabs value={tab} onValueChange={setTab} className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <TabsList aria-label="LinkedIn search views"><TabsTrigger value="ai">AI searches</TabsTrigger><TabsTrigger value="manual">Manual searches</TabsTrigger><TabsTrigger value="dismissed">Dismissed{dismissals?.keys.size ? ` (${dismissals.keys.size})` : ""}</TabsTrigger></TabsList>
        <Button variant={showComposer ? "secondary" : "primary"} aria-expanded={showComposer} aria-controls="linkedin-new-search" onClick={() => setShowComposer(!showComposer)}>{showComposer ? "Close search form" : "+ New search"}</Button>
      </div>
      <Card id="linkedin-new-search" hidden={!showComposer} className="mx-auto w-full max-w-[880px]">
        <SearchComposer key={composer.key} initial={composer.query} initialAi={composer.ai} pending={pending} disabled={keyState !== "set" || active || campaignActive} onSubmit={search} />
        {(active || campaignActive) && <p className="mt-4 text-sm text-muted">A search is running. You can review results while it continues; finish or cancel it before starting another.</p>}
        {error && <p role="alert" className="mt-4 text-sm text-error">{error}</p>}
      </Card>
      <TabsContent value="ai" forceMount hidden={tab !== "ai"} className="data-[state=inactive]:hidden">
        <CampaignPanel timeZone={timeZone} initial={initialCampaigns} selectedId={campaignId} onActiveChange={setCampaignActive} onReuse={(campaign) => { setComposer((c) => ({ key: c.key + 1, query: campaign.input, ai: true })); setShowComposer(true); }} />
      </TabsContent>
      <TabsContent value="manual" forceMount hidden={tab !== "manual"} className="flex flex-col gap-5 data-[state=inactive]:hidden">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div><h2 className="font-serif text-section">Manual search results</h2><p className="mt-1 text-sm text-muted">Reopen any search without spending Apify credits.</p></div>
          <Select label="Search history" className="w-full sm:max-w-[420px]" value={selected?.id ?? ""} onChange={(e) => void open(e.target.value)}>
            <option value="" disabled>Select a saved search</option>{history.map((entry) => <option key={entry.id} value={entry.id}>{entry.query.keywords.join(" · ")} · {formatTimestamp(new Date(entry.createdAt), timeZone)} · {entry.count} posts</option>)}
          </Select>
        </div>
    {selected ? <>
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="min-w-0 max-w-[640px]"><h3 className="line-clamp-2 text-sm font-medium">{selected.query.keywords.join(" · ")}</h3><p className="mt-1 text-xs text-muted">{formatTimestamp(new Date(selected.createdAt), timeZone)} · {selected.posts.length} posts fetched</p></div>
        <div className="flex flex-wrap gap-4">
          <Button variant="text" onClick={() => reuse(selected)}>Use these search filters</Button>
          {isSearching(selected.status) ? <Button variant="secondary" disabled={pending} onClick={() => startTransition(async () => {
            const result = toastResult(await cancelLinkedInSearch({ id: selected.id })); if (result.ok && selectedId.current === selected.id) update(result.data);
          })}>Cancel search</Button> : <Button variant="danger-text" disabled={pending} onClick={() => startTransition(async () => {
            const result = toastResult(await deleteLinkedInSearch({ id: selected.id }));
            if (result.ok) {
              setHistory((items) => items.filter((s) => s.id !== selected.id));
              if (selectedId.current === selected.id) { ++requestVersion.current; selectedId.current = null; setSelected(null); }
            }
          })}>Delete search</Button>}
        </div>
      </div>
      {isSearching(selected.status) && <Card role="status"><p>Searching public LinkedIn posts… You can leave this page and return to check the run.</p></Card>}
      {(selected.error || pollError) && <Card><p role="alert" className="text-sm text-error">{pollError || selected.error}</p>
        {pollError && <Button className="mt-3" variant="secondary" disabled={pending} onClick={() => startTransition(() => refresh(selected.id))}>Refresh status</Button>}</Card>}
      <ProfileFitControls key={selected.id} scope={{ kind: "manual", id: selected.id }} mode={fitMode} onModeChange={setFitMode} onChange={setFitState} />
      <div className="flex flex-wrap items-end gap-4">
        <Input label="Contains text" className="min-w-[180px] flex-1" value={filters.text} onChange={(e) => filter("text", e.target.value)} placeholder="Search posts or authors…" />
        <Select label="Sort by" className="w-full sm:w-[180px]" value={filters.sort} onChange={(e) => filter("sort", e.target.value as PostFilters["sort"])}><option value="newest">Newest first</option><option value="relevance">Search relevance</option><option value="likes">Most liked</option></Select>
        <Button variant="text" size="sm" onClick={() => { setFilters(DEFAULT_FILTERS); setFitMode("all"); }}>Reset filters</Button>
      </div>
      <details className="rounded-panel border border-line-card bg-card p-5"><summary className="cursor-pointer text-sm font-medium">Filter results</summary><div className="mt-4 flex flex-col gap-4">
        <div className="grid gap-4 sm:grid-cols-3">
          <Input label="Location mentioned" value={filters.location} onChange={(e) => filter("location", e.target.value)} placeholder="Ljubljana" />
          <Input label="Exclude words" value={filters.exclude} onChange={(e) => filter("exclude", e.target.value)} placeholder="intern, unpaid" />
          <Select label="Author type" value={filters.authorType} onChange={(e) => filter("authorType", e.target.value as PostFilters["authorType"])}>
            <option value="all">All authors</option><option value="company">Companies</option><option value="person">People</option>
          </Select>
        </div>
        <div className="flex flex-wrap gap-6 text-sm">
          <label className="flex items-center gap-2"><input type="checkbox" checked={filters.hiringOnly} onChange={(e) => filter("hiringOnly", e.target.checked)} />Mentions hiring</label>
          <label className="flex items-center gap-2"><input type="checkbox" checked={filters.remoteOnly} onChange={(e) => filter("remoteOnly", e.target.checked)} />Mentions remote work</label>
        </div>
        <p className="text-xs text-muted">Filters apply to fetched text and do not make API calls. Hiring, location and remote matches are text clues; check the original post for details.</p>
      </div></details>
      <p role="status" className="text-sm text-muted">Showing {posts.length} of {keptPosts.length} posts{selected.posts.length > keptPosts.length ? ` · ${selected.posts.length - keptPosts.length} dismissed` : ""}</p>
      {!posts.length && !isSearching(selected.status) && <Card><p>{selected.posts.length && !keptPosts.length ? "All posts from this search are dismissed. Open Dismissed to restore them." : selected.posts.length ? "No posts match these filters. Try resetting them." : "No posts available. Try a wider date range, fewer keywords or different hiring phrases."}</p></Card>}
      <div className="grid items-start gap-5 2xl:grid-cols-2">{posts.map((post) => <PostCard key={post.id} post={post} timeZone={timeZone}><ProfileFitDetails fit={fits[linkedInPostKey(post)]} /></PostCard>)}</div>
    </> : <Card><p className="text-sm text-muted">Start a manual search or select one from Search history.</p></Card>}
      </TabsContent>
      <TabsContent value="dismissed"><DismissedPanel timeZone={timeZone} /></TabsContent>
    </Tabs>
  </div>;
}
