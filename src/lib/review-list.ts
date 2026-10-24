import type { DiscoveredEmail } from "@/lib/email-discovery-data";

export const REVIEW_PAGE_SIZE = 50;

export type ReviewEmailFilter = "all" | "not-found" | "found";
export type ReviewSort = "queue" | "oldest" | "lowest" | "highest" | "company";
/** "queued" is everything the AI has not finished yet. */
export type ReviewStatusFilter = "all" | "ready" | "filtered" | "queued" | "failed";
export type ReviewRemoteFilter = "all" | "remote" | "onsite";

export type ReviewListParams = {
  page: number;
  /** Match percentage upper / lower bounds (inclusive lower, exclusive upper). */
  matchBelow: number | null;
  matchAtLeast: number | null;
  email: ReviewEmailFilter;
  sort: ReviewSort;
  status: ReviewStatusFilter;
  remote: ReviewRemoteFilter;
  /** Posting source, e.g. "JSEARCH"; "" for every source. */
  source: string;
  /** Automation profile id; "" for every profile. */
  searchId: string;
  /** Text matched against company, role and place. */
  q: string;
};

export const DEFAULT_REVIEW_PARAMS: ReviewListParams = {
  page: 1, matchBelow: null, matchAtLeast: null, email: "all", sort: "queue",
  status: "all", remote: "all", source: "", searchId: "", q: "",
};

export type ReviewFilterOptions = {
  sources: { value: string; label: string }[];
  searches: { value: string; label: string }[];
  statusCounts: Record<Exclude<ReviewStatusFilter, "all">, number>;
};

/** How far the current automation batch has come. Null when nothing is running. */
export type ReviewProgress = {
  searching: boolean;
  profilesSearched: number;
  profilesTotal: number;
  /** Postings the sources returned, before duplicates and limits. */
  scanned: number;
  /** Distinct new postings handed to the AI. */
  candidates: number;
  analyzed: number;
  analyzing: number;
  etaMinutes: number | null;
};

export type ReviewQueueItem = {
  id: string;
  applicationId: string | null;
  status: string;
  score: number | null;
  issue: string | null;
  canProvideRecipient: boolean;
  recipientOverride: string;
  company: string;
  role: string;
  place: string;
  remote: boolean | null;
  postingUrl: string;
  source: string;
  delivery: string | null;
  discoveredEmails: DiscoveredEmail[];
  emailDiscoveryError: string | null;
  emailDiscoverySearched: boolean;
};

export type ReviewCandidateDetails = {
  postingText: string;
  mandatory: string[];
  email: { to: string; subject: string; body: string } | null;
};

const first = (value: unknown) => Array.isArray(value) ? value[0] : value;
const percent = (value: unknown) => {
  const parsed = Number(first(value));
  return Number.isInteger(parsed) && parsed >= 1 && parsed <= 100 ? parsed : null;
};
const SORTS: readonly ReviewSort[] = ["oldest", "lowest", "highest", "company"];
const STATUSES: readonly ReviewStatusFilter[] = ["ready", "filtered", "queued", "failed"];
const text = (value: unknown, max: number) => {
  const raw = first(value);
  return typeof raw === "string" ? raw.trim().slice(0, max) : "";
};

export function resolveReviewParams(input: Record<string, unknown>): ReviewListParams {
  const requestedPage = Number(first(input.page));
  const email = first(input.email);
  const sort = first(input.sort);
  const status = first(input.status);
  const remote = first(input.remote);
  return {
    page: Number.isInteger(requestedPage) && requestedPage > 0 ? requestedPage : 1,
    matchBelow: percent(input.matchBelow),
    matchAtLeast: percent(input.matchAtLeast),
    email: email === "not-found" || email === "found" ? email : "all",
    sort: SORTS.find((value) => value === sort) ?? "queue",
    status: STATUSES.find((value) => value === status) ?? "all",
    remote: remote === "remote" || remote === "onsite" ? remote : "all",
    source: /^[A-Z_]{1,40}$/.test(text(input.source, 40)) ? text(input.source, 40) : "",
    searchId: /^[\w-]{1,40}$/.test(text(input.searchId, 40)) ? text(input.searchId, 40) : "",
    q: text(input.q, 100),
  };
}

export function reviewHref(params: ReviewListParams): string {
  const query = new URLSearchParams();
  if (params.page > 1) query.set("page", String(params.page));
  if (params.status !== "all") query.set("status", params.status);
  if (params.q) query.set("q", params.q);
  if (params.matchBelow !== null) query.set("matchBelow", String(params.matchBelow));
  if (params.matchAtLeast !== null) query.set("matchAtLeast", String(params.matchAtLeast));
  if (params.email !== "all") query.set("email", params.email);
  if (params.remote !== "all") query.set("remote", params.remote);
  if (params.source) query.set("source", params.source);
  if (params.searchId) query.set("searchId", params.searchId);
  if (params.sort !== "queue") query.set("sort", params.sort);
  const value = query.toString();
  return value ? `/review?${value}` : "/review";
}
