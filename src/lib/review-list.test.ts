import { describe, expect, it } from "vitest";

import { resolveReviewParams, reviewHref } from "./review-list";

describe("review list params", () => {
  it("normalizes invalid URL values to stable defaults", () => {
    expect(resolveReviewParams({ page: "0", matchBelow: "101", email: "unknown", sort: "newest" })).toEqual({
      page: 1,
      matchBelow: null,
      email: "all",
      sort: "queue",
    });
  });

  it("uses the first value and builds a compact persistent URL", () => {
    const params = resolveReviewParams({ page: ["3", "8"], matchBelow: "70", email: "not-found", sort: "lowest" });
    expect(params).toEqual({ page: 3, matchBelow: 70, email: "not-found", sort: "lowest" });
    expect(reviewHref(params)).toBe("/review?page=3&matchBelow=70&email=not-found&sort=lowest");
    expect(reviewHref({ page: 1, matchBelow: null, email: "all", sort: "queue" })).toBe("/review");
  });
});

