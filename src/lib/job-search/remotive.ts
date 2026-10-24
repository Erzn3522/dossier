import "server-only";

import { z } from "zod";

import type { JobSourceAdapter, RequestContext } from "./adapter";
import { jobSearchError } from "./errors";
import { feedSnapshot, filterRemoteFeed } from "./feed";
import { requestJson } from "./http";
import { safeLink, type FoundPosting, type SearchPage, type SearchQuery } from "./search";
import { plainText } from "./text";

const BASE = "https://remotive.com/api/remote-jobs";
const PAGE_SIZE = 50;
// Remotive advises at most four public-feed requests a day.
const SNAPSHOT_TTL_MS = 6 * 60 * 60 * 1000;
const maybeText = z.union([z.string(), z.number()]).nullish().catch(null);
const jobSchema = z.object({
  id: maybeText,
  url: maybeText,
  title: maybeText,
  company_name: maybeText,
  publication_date: maybeText,
  candidate_required_location: maybeText,
  salary: maybeText,
  description: maybeText,
  tags: z.array(z.string()).nullish().catch(null),
});
const responseSchema = z.object({ jobs: z.array(z.unknown()) });

function postingFromJob(job: z.output<typeof jobSchema>): FoundPosting | null {
  if (!job.id || !job.title) return null;
  const parsed = job.publication_date ? Date.parse(String(job.publication_date)) : NaN;
  const description = plainText(String(job.description ?? ""));
  return {
    source: "REMOTIVE",
    externalId: String(job.id).slice(0, 500),
    title: plainText(String(job.title)).slice(0, 500),
    company: plainText(String(job.company_name ?? "")).slice(0, 300),
    place: plainText(String(job.candidate_required_location ?? "Worldwide")).slice(0, 300),
    remote: true,
    salary: plainText(String(job.salary ?? "")).slice(0, 200),
    postedAt: Number.isNaN(parsed) ? null : new Date(parsed).toISOString(),
    url: safeLink(String(job.url ?? "")).slice(0, 2000),
    via: "Remotive",
    description: [description, ...((job.tags ?? []).length ? [`Tags: ${(job.tags ?? []).join(", ")}`] : [])].filter(Boolean).join("\n\n").slice(0, 100_000),
    complete: Boolean(description),
  };
}

async function search(query: SearchQuery, context: RequestContext = {}): Promise<SearchPage> {
  const url = new URL(context.baseUrl ?? BASE);
  // Download the common snapshot sparingly, then filter every automation profile locally.
  const raw = await feedSnapshot(`remotive:${url.href}`, () => requestJson("REMOTIVE", url, { signal: context.signal }), SNAPSHOT_TTL_MS);
  const answer = responseSchema.safeParse(raw);
  if (!answer.success) throw jobSearchError("changed", "REMOTIVE", { detail: `${url.pathname}: unexpected answer` });
  const postings = answer.data.jobs.flatMap((item) => {
    const job = jobSchema.safeParse(item);
    if (!job.success) return [];
    const posting = postingFromJob(job.data);
    return posting ? [posting] : [];
  });
  return { postings: filterRemoteFeed(postings, query).slice(0, PAGE_SIZE), next: null };
}

export const remotive: JobSourceAdapter<"REMOTIVE"> = {
  source: "REMOTIVE",
  search: (query, _credentials, _next, context) => search(query, context),
  details: async (posting) => posting.description || null,
  test: async (_credentials, context) => {
    await search({ keywords: "developer", place: "", country: "us", radiusKm: 25, remoteOnly: true, postedWithin: "any" }, context);
  },
};
