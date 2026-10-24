import { describe, expect, it } from "vitest";

import { DEFAULT_REVIEW_PARAMS, resolveReviewParams, reviewHref } from "./review-list";

describe("review list params", () => {
  it("normalizes invalid URL values to stable defaults", () => {
    expect(resolveReviewParams({ page: "0", matchBelow: "101", email: "unknown", sort: "newest" })).toEqual(DEFAULT_REVIEW_PARAMS);
  });

  it("uses the first value and builds a compact persistent URL", () => {
    const params = resolveReviewParams({ page: ["3", "8"], matchBelow: "70", email: "not-found", sort: "lowest" });
    expect(params).toEqual({ ...DEFAULT_REVIEW_PARAMS, page: 3, matchBelow: 70, email: "not-found", sort: "lowest" });
    expect(reviewHref(params)).toBe("/review?page=3&matchBelow=70&email=not-found&sort=lowest");
    expect(reviewHref(DEFAULT_REVIEW_PARAMS)).toBe("/review");
  });

  it("round-trips the richer filters and rejects malformed ones", () => {
    const params = resolveReviewParams({ status: "ready", q: " vision ", matchAtLeast: "60", remote: "remote", source: "HIMALAYAS", searchId: "abc123", sort: "company" });
    expect(params).toEqual({ ...DEFAULT_REVIEW_PARAMS, status: "ready", q: "vision", matchAtLeast: 60, remote: "remote", source: "HIMALAYAS", searchId: "abc123", sort: "company" });
    expect(resolveReviewParams(Object.fromEntries(new URL(`http://x${reviewHref(params)}`).searchParams))).toEqual(params);
    expect(resolveReviewParams({ status: "nope", remote: "maybe", source: "x; drop", searchId: "a b", matchAtLeast: "0" })).toEqual(DEFAULT_REVIEW_PARAMS);
  });
});

