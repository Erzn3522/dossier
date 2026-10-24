import "server-only";

import { z } from "zod";
import type { JobSourceAdapter, RequestContext } from "./adapter";
import { jobSearchError } from "./errors";
import { feedSnapshot, filterRemoteFeed } from "./feed";
import { requestJson } from "./http";
import { safeLink, type FoundPosting, type SearchPage, type SearchQuery } from "./search";
import { plainText } from "./text";

const BASE = "https://www.arbeitnow.com/api/job-board-api";
const SNAPSHOT_TTL_MS = 60 * 60 * 1000;
const value = z.union([z.string(), z.number()]).nullish().catch(null);
const jobSchema = z.object({ slug: value, company_name: value, title: value, description: value, remote: z.boolean().nullish().catch(null),
  url: value, location: value, created_at: value, tags: z.array(z.string()).nullish().catch(null) });
const responseSchema = z.object({ data: z.array(z.unknown()), links: z.object({ next: z.string().nullish().catch(null) }).partial().optional() });

function posting(job: z.output<typeof jobSchema>): FoundPosting | null {
  if (!job.slug || !job.title) return null;
  const description = [plainText(String(job.description ?? "")), (job.tags ?? []).length ? `Tags: ${(job.tags ?? []).join(", ")}` : ""].filter(Boolean).join("\n\n");
  const timestamp = typeof job.created_at === "number" ? job.created_at * 1000 : Date.parse(String(job.created_at ?? ""));
  return { source: "ARBEITNOW", externalId: String(job.slug).slice(0, 500), title: plainText(String(job.title)).slice(0, 500),
    company: plainText(String(job.company_name ?? "")).slice(0, 300), place: plainText(String(job.location ?? "Europe")).slice(0, 300),
    remote: job.remote ?? null, salary: "", postedAt: Number.isNaN(timestamp) ? null : new Date(timestamp).toISOString(),
    url: safeLink(String(job.url ?? "")).slice(0, 2000), via: "Arbeitnow", description: description.slice(0, 100_000), complete: Boolean(description) };
}

async function search(query: SearchQuery, next: string | null, context: RequestContext = {}): Promise<SearchPage> {
  const url = next?.startsWith("url:") ? new URL(next.slice(4)) : new URL(context.baseUrl ?? BASE);
  if (!next && !url.searchParams.has("page")) url.searchParams.set("page", "1");
  const raw = await feedSnapshot(`arbeitnow:${url.href}`, () => requestJson("ARBEITNOW", url, { signal: context.signal }), SNAPSHOT_TTL_MS);
  const answer = responseSchema.safeParse(raw);
  if (!answer.success) throw jobSearchError("changed", "ARBEITNOW", { detail: `${url.pathname}: unexpected answer` });
  const postings = answer.data.data.flatMap((item) => { const parsed = jobSchema.safeParse(item); const result = parsed.success ? posting(parsed.data) : null; return result ? [result] : []; });
  const nextUrl = safeLink(answer.data.links?.next);
  return { postings: filterRemoteFeed(postings, query), next: nextUrl ? `url:${nextUrl}` : null };
}

export const arbeitnow: JobSourceAdapter<"ARBEITNOW"> = { source: "ARBEITNOW", search: (query, _credentials, next, context) => search(query, next, context),
  details: async (value) => value.description || null,
  test: async (_credentials, context) => { await search({ keywords: "developer", place: "Berlin", country: "de", radiusKm: 25, remoteOnly: false, postedWithin: "week" }, null, context); } };
