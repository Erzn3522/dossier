import "server-only";

import { z } from "zod";

import type { JobSourceAdapter, RequestContext } from "./adapter";
import { jobSearchError } from "./errors";
import { feedSnapshot, filterRemoteFeed } from "./feed";
import { requestJson } from "./http";
import { safeLink, type FoundPosting, type SearchPage, type SearchQuery } from "./search";
import { plainText } from "./text";

const BASE = "https://remoteok.com/api";
const PAGE_SIZE = 50;
const SNAPSHOT_TTL_MS = 60 * 60 * 1000;
const maybeText = z.union([z.string(), z.number()]).nullish().catch(null);
const rowSchema = z.object({
  id: maybeText,
  epoch: z.coerce.number().nullish().catch(null),
  date: maybeText,
  company: maybeText,
  position: maybeText,
  location: maybeText,
  description: maybeText,
  salary_min: z.coerce.number().nullish().catch(null),
  salary_max: z.coerce.number().nullish().catch(null),
  url: maybeText,
  apply_url: maybeText,
  tags: z.array(z.string()).nullish().catch(null),
});

function salaryOf(min: number | null | undefined, max: number | null | undefined): string {
  if (!min && !max) return "";
  const amount = (value: number) => Math.round(value).toLocaleString("en-US");
  return `USD ${min && max && min !== max ? `${amount(min)}–${amount(max)}` : amount((min || max)!)} a year`;
}

function postingFromRow(row: z.output<typeof rowSchema>): FoundPosting | null {
  if (!row.id || !row.position) return null;
  const parsed = row.date ? Date.parse(String(row.date)) : NaN;
  const postedAt = row.epoch ? new Date(row.epoch * 1000).toISOString() : Number.isNaN(parsed) ? null : new Date(parsed).toISOString();
  const description = plainText(String(row.description ?? ""));
  return {
    source: "REMOTE_OK",
    externalId: String(row.id).slice(0, 500),
    title: plainText(String(row.position)).slice(0, 500),
    company: plainText(String(row.company ?? "")).slice(0, 300),
    place: plainText(String(row.location ?? "Worldwide")).slice(0, 300),
    remote: true,
    salary: salaryOf(row.salary_min, row.salary_max).slice(0, 200),
    postedAt,
    // Remote OK requires attribution and a link back to its own listing.
    url: safeLink(String(row.url ?? row.apply_url ?? "")).slice(0, 2000),
    via: "Remote OK",
    description: [description, ...((row.tags ?? []).length ? [`Tags: ${(row.tags ?? []).join(", ")}`] : [])].filter(Boolean).join("\n\n").slice(0, 100_000),
    complete: Boolean(description),
  };
}

async function search(query: SearchQuery, context: RequestContext = {}): Promise<SearchPage> {
  const url = new URL(context.baseUrl ?? BASE);
  const answer = await feedSnapshot(`remote-ok:${url.href}`, () => requestJson("REMOTE_OK", url, { signal: context.signal }), SNAPSHOT_TTL_MS);
  if (!Array.isArray(answer)) throw jobSearchError("changed", "REMOTE_OK", { detail: `${url.pathname}: unexpected answer` });
  const postings = answer.flatMap((item) => {
    const row = rowSchema.safeParse(item);
    if (!row.success) return [];
    const posting = postingFromRow(row.data);
    return posting ? [posting] : [];
  });
  return { postings: filterRemoteFeed(postings, query).slice(0, PAGE_SIZE), next: null };
}

export const remoteOk: JobSourceAdapter<"REMOTE_OK"> = {
  source: "REMOTE_OK",
  search: (query, _credentials, _next, context) => search(query, context),
  details: async (posting) => posting.description || null,
  test: async (_credentials, context) => {
    await search({ keywords: "developer", place: "", country: "us", radiusKm: 25, remoteOnly: true, postedWithin: "any" }, context);
  },
};
