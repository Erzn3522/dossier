import "server-only";

import { z } from "zod";
import type { JobSourceAdapter, RequestContext } from "./adapter";
import { jobSearchError } from "./errors";
import { feedSnapshot, filterRemoteFeed } from "./feed";
import { requestJson } from "./http";
import { safeLink, type FoundPosting, type SearchPage, type SearchQuery } from "./search";
import { plainText } from "./text";

const BASE = "https://jobicy.com/api/jobs";
const SNAPSHOT_TTL_MS = 60 * 60 * 1000;
const value = z.union([z.string(), z.number()]).nullish().catch(null);
const jobSchema = z.object({ id: value, url: value, jobTitle: value, companyName: value, jobGeo: value, jobDescription: value,
  jobExcerpt: value, pubDate: value, salaryMin: z.coerce.number().nullish().catch(null), salaryMax: z.coerce.number().nullish().catch(null),
  salaryCurrency: value, salaryPeriod: value });
const responseSchema = z.object({ jobs: z.array(z.unknown()), nextCursor: z.string().nullish().catch(null), success: z.boolean().optional() });

function posting(job: z.output<typeof jobSchema>): FoundPosting | null {
  if (!job.id || !job.jobTitle) return null;
  const description = plainText(String(job.jobDescription ?? job.jobExcerpt ?? ""));
  const amounts = job.salaryMin == null && job.salaryMax == null ? "" : job.salaryMin != null && job.salaryMax != null && job.salaryMin !== job.salaryMax
    ? `${job.salaryMin.toLocaleString("en-US")}–${job.salaryMax.toLocaleString("en-US")}` : String(job.salaryMin ?? job.salaryMax);
  const parsedDate = Date.parse(String(job.pubDate ?? ""));
  return { source: "JOBICY", externalId: String(job.id).slice(0, 500), title: plainText(String(job.jobTitle)).slice(0, 500),
    company: plainText(String(job.companyName ?? "")).slice(0, 300), place: plainText(String(job.jobGeo ?? "Anywhere")).slice(0, 300), remote: true,
    salary: [job.salaryCurrency, amounts, job.salaryPeriod].filter(Boolean).join(" ").slice(0, 200),
    postedAt: Number.isNaN(parsedDate) ? null : new Date(parsedDate).toISOString(), url: safeLink(String(job.url ?? "")).slice(0, 2000),
    via: "Jobicy", description: description.slice(0, 100_000), complete: Boolean(description) };
}

async function search(query: SearchQuery, next: string | null, context: RequestContext = {}): Promise<SearchPage> {
  const url = new URL(context.baseUrl ?? BASE); url.searchParams.set("count", "200");
  if (next?.startsWith("cursor:")) url.searchParams.set("cursor", next.slice(7));
  const raw = await feedSnapshot(`jobicy:${url.href}`, () => requestJson("JOBICY", url, { signal: context.signal }), SNAPSHOT_TTL_MS);
  const answer = responseSchema.safeParse(raw);
  if (!answer.success || answer.data.success === false) throw jobSearchError("changed", "JOBICY", { detail: `${url.pathname}: unexpected answer` });
  const postings = answer.data.jobs.flatMap((item) => { const parsed = jobSchema.safeParse(item); const result = parsed.success ? posting(parsed.data) : null; return result ? [result] : []; });
  return { postings: filterRemoteFeed(postings, query), next: answer.data.nextCursor ? `cursor:${answer.data.nextCursor}` : null };
}

export const jobicy: JobSourceAdapter<"JOBICY"> = { source: "JOBICY", search: (query, _credentials, next, context) => search(query, next, context),
  details: async (value) => value.description || null,
  test: async (_credentials, context) => { await search({ keywords: "developer", place: "", country: "us", radiusKm: 25, remoteOnly: true, postedWithin: "week" }, null, context); } };
