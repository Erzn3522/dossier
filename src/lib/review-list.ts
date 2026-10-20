import type { DiscoveredEmail } from "@/lib/email-discovery-data";

export const REVIEW_PAGE_SIZE = 50;

export type ReviewEmailFilter = "all" | "not-found" | "found";
export type ReviewSort = "queue" | "lowest" | "highest";

export type ReviewListParams = {
  page: number;
  matchBelow: number | null;
  email: ReviewEmailFilter;
  sort: ReviewSort;
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

export function resolveReviewParams(input: Record<string, unknown>): ReviewListParams {
  const requestedPage = Number(first(input.page));
  const requestedMatch = Number(first(input.matchBelow));
  const email = first(input.email);
  const sort = first(input.sort);
  return {
    page: Number.isInteger(requestedPage) && requestedPage > 0 ? requestedPage : 1,
    matchBelow: Number.isInteger(requestedMatch) && requestedMatch >= 1 && requestedMatch <= 100 ? requestedMatch : null,
    email: email === "not-found" || email === "found" ? email : "all",
    sort: sort === "lowest" || sort === "highest" ? sort : "queue",
  };
}

export function reviewHref(params: ReviewListParams): string {
  const query = new URLSearchParams();
  if (params.page > 1) query.set("page", String(params.page));
  if (params.matchBelow !== null) query.set("matchBelow", String(params.matchBelow));
  if (params.email !== "all") query.set("email", params.email);
  if (params.sort !== "queue") query.set("sort", params.sort);
  const value = query.toString();
  return value ? `/review?${value}` : "/review";
}

