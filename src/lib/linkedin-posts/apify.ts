import "server-only";

import { z } from "zod";
import { ActionError } from "@/lib/action";
import { linkedInPostSchema, linkedInUrl, type LinkedInPost, type PostSearchQuery } from "./data";
import { buildQueries } from "./queries";

export const ACTOR = "automly~linkedin-post-search-scraper";
const BASE = "https://api.apify.com/v2";

// Fixed upstream host; credentials travel only in headers. Never retry a paid POST.
export async function apifyRequest(key: string, path: string, body?: unknown): Promise<unknown> {
  let response: Response;
  try {
    response = await fetch(`${BASE}${path}`, {
      method: body === undefined ? "GET" : "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      cache: "no-store", signal: AbortSignal.timeout(20_000),
    });
  } catch {
    throw new ActionError(body === undefined
      ? "Apify could not be reached. Try refreshing the search status."
      : "Apify did not confirm the request. Check your Apify Console before starting another search; a run may have started.");
  }
  if (response.status === 401 || response.status === 403) throw new ActionError("Apify refused the API token. Check it and its permissions in Settings → LinkedIn posts.");
  if (response.status === 402 || response.status === 429) throw new ActionError("Apify's credit or usage limit was reached. Check your plan in Apify Console.");
  if (!response.ok) throw new ActionError(`Apify returned an error (${response.status}). Check the run in Apify Console.`);
  // Bound upstream data, including bodies without Content-Length.
  const reader = response.body?.getReader();
  if (!reader) throw new ActionError("Apify returned an empty response.");
  const chunks: Uint8Array[] = [];
  let bytes = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    bytes += value.byteLength;
    if (bytes > 5 * 1024 * 1024) { await reader.cancel(); throw new ActionError("Apify's response was too large. Check the run in Apify Console."); }
    chunks.push(value);
  }
  try { return JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown; }
  catch { throw new ActionError("Apify returned an unreadable response. Check the run in Apify Console."); }
}

const runSchema = z.object({ data: z.object({
  id: z.string().min(1), status: z.string(), defaultDatasetId: z.string().nullable().optional(),
}) });
export function parseRun(value: unknown) {
  const result = runSchema.safeParse(value);
  if (!result.success) throw new ActionError("Apify's run response changed. Check the run in Apify Console.");
  return result.data.data;
}
export function actorInput(query: PostSearchQuery) {
  return {
    searchQueries: buildQueries(query.keywords, query.countries), maxPosts: query.maxPosts, postedLimit: query.postedWithin,
    ...(query.since ? { postedLimitDate: query.since } : {}),
    ...(query.authors.length ? { authorFilter: query.authors } : {}),
    includeComments: false,
  };
}

const upstreamPost = z.object({
  id: z.string().optional(), url: linkedInUrl, text: z.string().min(1).max(100_000),
  postedAt: z.string().nullish(), query: z.string().optional(),
  author: z.object({ name: z.string().optional(), url: z.string().nullish(), type: z.string().optional() }).nullish(),
  likes: z.number().nonnegative().nullish(), commentsCount: z.number().nonnegative().nullish(),
});
export function parsePosts(value: unknown): LinkedInPost[] {
  if (!Array.isArray(value)) throw new ActionError("Apify's results were not a list of posts.");
  const posts = new Map<string, LinkedInPost>();
  for (const item of value) {
    const parsed = upstreamPost.safeParse(item);
    if (!parsed.success) continue;
    const row = parsed.data;
    const canonical = new URL(row.url); canonical.search = ""; canonical.hash = "";
    const authorUrl = linkedInUrl.safeParse(row.author?.url);
    const post = linkedInPostSchema.parse({
      id: row.id || canonical.href, url: canonical.href, text: row.text,
      postedAt: row.postedAt && Number.isFinite(Date.parse(row.postedAt)) ? new Date(row.postedAt).toISOString() : null,
      author: { name: row.author?.name || "Unknown author", url: authorUrl.success ? authorUrl.data : null,
        type: row.author?.type === "company" ? "company" : row.author?.type === "person" ? "person" : "unknown" },
      likes: row.likes ?? 0, commentsCount: row.commentsCount ?? 0, query: row.query ?? "",
    });
    const queries = [...new Set([...(posts.get(post.id)?.queries ?? []), ...(row.query ? [row.query] : [])])];
    posts.set(post.id, queries.length ? { ...post, queries } : post);
  }
  if (value.length && !posts.size) throw new ActionError("Apify returned rows, but none matched the expected post format.");
  return [...posts.values()];
}
