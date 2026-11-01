import { z } from "zod";
import { buildQueries } from "./queries";

export const POSTED_WITHIN = [
  ["24h", "Past 24 hours"], ["week", "Past week"], ["month", "Past month"],
  ["3months", "Past 3 months"], ["6months", "Past 6 months"], ["year", "Past year"], ["any", "Any time"],
] as const;

export const postSearchFields = z.object({
  keywords: z.array(z.string().trim().min(2).max(200)).min(1).max(5),
  postedWithin: z.enum(["24h", "week", "month", "3months", "6months", "year", "any"]),
  since: z.union([z.literal(""), z.iso.date()]),
  authors: z.array(z.string().trim().min(1).max(250)).max(5),
  maxPosts: z.number().int().min(1).max(100),
  countries: z.array(z.string().trim().min(1).max(80)).max(5).optional(),
});
export const postSearchSchema = postSearchFields.superRefine((q, context) => {
  try {
    const queries = buildQueries(q.keywords, q.countries);
    if (queries.some((query) => query.length > 200)) context.addIssue({ code: "custom", message: "Each generated query must be at most 200 characters." });
    if (queries.length * Math.max(1, q.authors.length) * q.maxPosts > 200) context.addIssue({ code: "custom", message: "Limit each search to 200 posts: reduce keywords, authors, countries, or posts per query." });
  } catch (error) { context.addIssue({ code: "custom", message: (error as Error).message }); }
});
export type PostSearchQuery = z.infer<typeof postSearchSchema>;

// Only allow public LinkedIn links in results; never render arbitrary provider URLs.
export const linkedInUrl = z.string().url().refine((value) => {
  const url = new URL(value);
  return url.protocol === "https:" && (url.hostname === "linkedin.com" || url.hostname.endsWith(".linkedin.com")) && !url.username && !url.password;
});
export const linkedInPostSchema = z.object({
  id: z.string(), url: linkedInUrl, text: z.string(), postedAt: z.iso.datetime().nullable(),
  author: z.object({ name: z.string(), url: linkedInUrl.nullable(), type: z.enum(["person", "company", "unknown"]) }),
  likes: z.number().nonnegative(), commentsCount: z.number().nonnegative(), query: z.string(),
  queries: z.array(z.string()).optional(),
});
export type LinkedInPost = z.infer<typeof linkedInPostSchema>;
export type PostSearchView = {
  id: string; query: PostSearchQuery; posts: LinkedInPost[]; status: string; error: string | null; createdAt: string;
};
export const isSearching = (status: string) => status === "STARTING" || status === "RUNNING";

export type PostFilters = {
  text: string; exclude: string; location: string; hiringOnly: boolean; remoteOnly: boolean;
  authorType: "all" | "person" | "company"; sort: "relevance" | "newest" | "likes";
};
export const DEFAULT_FILTERS: PostFilters = {
  text: "", exclude: "", location: "", hiringOnly: false, remoteOnly: false, authorType: "all", sort: "newest",
};
export function hasHiringSignal(text: string): boolean {
  return /\b(hiring|we['’]?re hiring|join (our|the) team|job opening|open position|vacanc(?:y|ies)|looking for (?:a|an)|işe al[ıi]m|işe al[ıi]yoruz|eleman aranıyor|ekibimize|çalışma arkadaşı|stellenangebot|wir suchen|zaposlimo|zaposlujemo)\b/iu.test(text);
}
export function filterPosts(posts: LinkedInPost[], filters: PostFilters): LinkedInPost[] {
  const lower = (text: string) => text.normalize("NFKC").toLocaleLowerCase();
  const excludes = filters.exclude.split(",").map((s) => lower(s.trim())).filter(Boolean);
  const filtered = posts.filter((post) => {
    const text = lower(`${post.text} ${post.author.name}`);
    return text.includes(lower(filters.text.trim())) && text.includes(lower(filters.location.trim()))
      && !excludes.some((word) => text.includes(word))
      && (!filters.hiringOnly || hasHiringSignal(post.text))
      && (!filters.remoteOnly || /\b(remote|uzaktan|home office|work from home|delo na daljavo)\b/iu.test(post.text))
      && (filters.authorType === "all" || filters.authorType === post.author.type);
  });
  if (filters.sort === "newest") filtered.sort((a, b) => (Date.parse(b.postedAt ?? "") || 0) - (Date.parse(a.postedAt ?? "") || 0));
  if (filters.sort === "likes") filtered.sort((a, b) => b.likes - a.likes);
  return filtered;
}
