"use client";

import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { loadDismissedPosts } from "./dismissal-actions";
import { useDismissals } from "./dismissal-context";
import { PostCard } from "./post-card";

type Page = Extract<Awaited<ReturnType<typeof loadDismissedPosts>>, { ok: true }>["data"];
export function DismissedPanel({ timeZone }: { timeZone: string }) {
  const dismissals = useDismissals();
  const [page, setPage] = useState(1);
  const [data, setData] = useState<Page | null>(null);
  const [error, setError] = useState("");
  const request = useRef({ version: 0 });
  const revision = dismissals?.revision ?? 0;
  useEffect(() => {
    const gate = request.current;
    const version = ++gate.version;
    void loadDismissedPosts({ page }).then((result) => {
      if (gate.version !== version) return;
      if (result.ok) { setData(result.data); setError(""); }
      else setError(result.error);
    }).catch(() => { if (gate.version === version) setError("Could not load dismissed posts. Try again."); });
    return () => { gate.version++; };
  }, [page, revision]);
  return <section aria-label="Dismissed posts" className="flex flex-col gap-5">
    <div><h2 className="font-serif text-section">Dismissed posts</h2><p className="mt-1 text-sm text-muted">Hidden from manual and AI searches, including future searches. Restore a post to see it again.</p></div>
    {error && <p role="alert" className="text-sm text-error">{error}</p>}
    {!data && !error && <p role="status" className="text-sm text-muted">Loading dismissed posts…</p>}
    {data && <>
      <div className="flex flex-wrap items-center justify-between gap-3 text-sm text-muted"><span>{dismissals?.keys.size ?? data.total} dismissed posts</span>
        <div className="flex items-center gap-3"><Button variant="secondary" size="sm" disabled={data.page <= 1} onClick={() => setPage(data.page - 1)}>Previous</Button><span>Page {data.page} of {data.pages}</span><Button variant="secondary" size="sm" disabled={data.page >= data.pages} onClick={() => setPage(data.page + 1)}>Next</Button></div>
      </div>
      {!data.total && <Card><h3 className="font-medium">Nothing dismissed</h3><p className="mt-2 text-sm text-muted">Use Dismiss on a result to remove posts you do not want to review.</p></Card>}
      <div className="grid items-start gap-5 2xl:grid-cols-2">{data.posts.filter((entry) => !dismissals || dismissals.keys.has(entry.key)).map((entry) => <PostCard key={entry.key} post={entry.post} timeZone={timeZone} showDismissed />)}</div>
    </>}
  </section>;
}
