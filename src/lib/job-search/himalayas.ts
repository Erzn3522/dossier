import "server-only";

import { z } from "zod";

import type { JobSourceAdapter, RequestContext } from "./adapter";
import { jobSearchError } from "./errors";
import { feedSnapshot, filterRemoteFeed } from "./feed";
import { requestJson } from "./http";
import { safeLink, type FoundPosting, type SearchPage, type SearchQuery } from "./search";
import { plainText } from "./text";

const BASE = "https://himalayas.app/jobs/api/search";
const SNAPSHOT_TTL_MS = 24 * 60 * 60 * 1000;
const maybeText = z.union([z.string(), z.number()]).nullish().catch(null);
const jobSchema = z.object({
  guid: maybeText, title: maybeText, companyName: maybeText,
  locationRestrictions: z.array(z.string()).nullish().catch(null),
  minSalary: z.coerce.number().nullish().catch(null), maxSalary: z.coerce.number().nullish().catch(null),
  currency: maybeText, salaryPeriod: maybeText, description: maybeText, excerpt: maybeText,
  pubDate: z.coerce.number().nullish().catch(null), applicationLink: maybeText,
});
const responseSchema = z.object({ jobs: z.array(z.unknown()).catch([]) });

function salary(job: z.output<typeof jobSchema>): string {
  if (job.minSalary == null && job.maxSalary == null) return "";
  const range = job.minSalary != null && job.maxSalary != null && job.minSalary !== job.maxSalary
    ? `${job.minSalary.toLocaleString("en-US")}–${job.maxSalary.toLocaleString("en-US")}`
    : (job.minSalary ?? job.maxSalary)!.toLocaleString("en-US");
  return [job.currency, range, job.salaryPeriod].filter(Boolean).join(" ").slice(0, 200);
}

function posting(job: z.output<typeof jobSchema>): FoundPosting | null {
  if (!job.guid || !job.title) return null;
  const description = plainText(String(job.description ?? job.excerpt ?? ""));
  return {
    source: "HIMALAYAS", externalId: String(job.guid).slice(0, 500), title: plainText(String(job.title)).slice(0, 500),
    company: plainText(String(job.companyName ?? "")).slice(0, 300),
    place: plainText((job.locationRestrictions ?? []).join(", ") || "Worldwide").slice(0, 300),
    remote: true, salary: salary(job), postedAt: job.pubDate ? new Date(job.pubDate * 1000).toISOString() : null,
    // Himalayas requires its applicationLink to be preserved unchanged.
    url: safeLink(String(job.applicationLink ?? "")).slice(0, 2000), via: "Himalayas",
    description: description.slice(0, 100_000), complete: Boolean(description),
  };
}

async function search(query: SearchQuery, next: string | null, context: RequestContext = {}): Promise<SearchPage> {
  const url = new URL(context.baseUrl ?? BASE);
  url.searchParams.set("q", query.keywords);
  url.searchParams.set("country", query.country.toUpperCase());
  url.searchParams.set("sort", "recent");
  url.searchParams.set("page", next?.startsWith("page:") ? next.slice(5) : "1");
  const raw = await feedSnapshot(`himalayas:${url.href}`, () => requestJson("HIMALAYAS", url, { signal: context.signal }), SNAPSHOT_TTL_MS);
  const answer = responseSchema.safeParse(raw);
  if (!answer.success) throw jobSearchError("changed", "HIMALAYAS", { detail: `${url.pathname}: unexpected answer` });
  const postings = answer.data.jobs.flatMap((item) => {
    const parsed = jobSchema.safeParse(item); const value = parsed.success ? posting(parsed.data) : null; return value ? [value] : [];
  });
  const page = Number(url.searchParams.get("page"));
  return { postings: filterRemoteFeed(postings, query), next: postings.length ? `page:${page + 1}` : null };
}

export const himalayas: JobSourceAdapter<"HIMALAYAS"> = {
  source: "HIMALAYAS", search: (query, _credentials, next, context) => search(query, next, context),
  details: async (value) => value.description || null,
  test: async (_credentials, context) => { await search({ keywords: "developer", place: "", country: "us", radiusKm: 25, remoteOnly: true, postedWithin: "week" }, null, context); },
};
