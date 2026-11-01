"use client";
import { useState, type ReactNode } from "react";
import { formatTimestamp } from "@/lib/dates";
import { Button, buttonClassName } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { hasHiringSignal, type LinkedInPost } from "@/lib/linkedin-posts/data";
import { linkedInPostKey } from "@/lib/linkedin-posts/post-key";
import { useDismissals } from "./dismissal-context";

export function PostCard({ post, timeZone = "UTC", children, showDismissed = false }: { post: LinkedInPost; timeZone?: string; children?: ReactNode; showDismissed?: boolean }) {
  const [expanded, setExpanded] = useState(false);
  const dismissals = useDismissals();
  const key = linkedInPostKey(post);
  const dismissed = dismissals?.keys.has(key) ?? false;
  const pending = dismissals?.pending.has(key) ?? false;
  const long = post.text.length > 420;
  if (dismissed && !showDismissed) return null;
  return <Card className="flex min-w-0 flex-col gap-4 p-5!" role="article" aria-label={`Post by ${post.author.name}`}>
    <div className="flex items-start justify-between gap-4">
      <div className="flex min-w-0 items-center gap-3"><span aria-hidden="true" className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-selected font-serif text-lg">{post.author.name.slice(0, 1).toUpperCase()}</span><div className="min-w-0"><h3 className="truncate font-medium">{post.author.url ? <a href={post.author.url} target="_blank" rel="noopener noreferrer" className="hover:underline">{post.author.name}</a> : post.author.name}</h3>
        <p className="mt-1 text-xs text-muted">{post.author.type === "unknown" ? "LinkedIn author" : post.author.type === "company" ? "Company" : "Person"}{post.postedAt ? ` · ${formatTimestamp(new Date(post.postedAt), timeZone)}` : " · Date unavailable"}</p></div>
      </div>{hasHiringSignal(post.text) && <span className="shrink-0 rounded-control bg-selected px-2 py-1 text-xs">Hiring</span>}
    </div>
    <p className="whitespace-pre-wrap text-sm leading-relaxed wrap-anywhere">{long && !expanded ? `${post.text.slice(0, 420)}…` : post.text}</p>
    {long && <Button variant="text" className="self-start" onClick={() => setExpanded(!expanded)}>{expanded ? "Show less" : "Read full post"}</Button>}
    {children}
    <div className="mt-auto flex flex-wrap items-center justify-between gap-3 border-t border-line pt-4">
      <div className="flex flex-col gap-2"><span className="text-xs text-muted">{post.likes} likes · {post.commentsCount} comments</span>
        {dismissals && <Button variant="text" size="sm" className="self-start" disabled={pending} aria-label={`${dismissed ? "Restore" : "Dismiss"} post by ${post.author.name}`}
          onClick={() => { if (dismissed) void dismissals.restore(key); else void dismissals.dismiss(post); }}>{pending ? "Saving…" : dismissed ? "Restore post" : "Dismiss"}</Button>}
      </div>
      <a href={post.url} target="_blank" rel="noopener noreferrer" className={buttonClassName("secondary", "sm")}>Open on LinkedIn ↗</a>
    </div>
  </Card>;
}
