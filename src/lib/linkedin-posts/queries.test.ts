import { describe, expect, it } from "vitest";
import { buildQueries, queryAlternatives } from "./queries";
import { campaignInputSchema, roundCap, roundOrder } from "./campaign-data";
import { postSearchSchema } from "./data";

describe("query composition and campaign limits", () => {
  it("appends every country to every OR branch, preserving quoted OR", () => {
    expect(buildQueries(['"Computer Vision" hiring OR recruiting', '"Research OR Development" hiring'], ["Türkiye", "Slovenia"])).toEqual([
      '"Computer Vision" hiring Türkiye OR recruiting Türkiye', '"Computer Vision" hiring Slovenia OR recruiting Slovenia',
      '"Research OR Development" hiring Türkiye', '"Research OR Development" hiring Slovenia',
    ]);
    expect(() => queryAlternatives('"unclosed')).toThrow("quotation");
    expect(() => queryAlternatives("hiring OR ")).toThrow("both sides");
  });
  it("keeps old searches unchanged and deduplicates normalized queries", () => {
    expect(buildQueries(["hiring engineer"])).toEqual(["hiring engineer"]);
    expect(buildQueries(["hiring engineer", "HIRING   engineer"], ["Slovenia"])).toHaveLength(1);
    expect(postSearchSchema.safeParse({ keywords: ["hiring engineer"], postedWithin: "month", since: "", authors: [], maxPosts: 20 }).success).toBe(true);
  });
  it("counts expanded queries against manual limits", () => {
    const q = { keywords: ["one", "two", "three", "four", "five"], countries: ["Turkey", "Slovenia"], postedWithin: "month", since: "", authors: [], maxPosts: 20 };
    expect(postSearchSchema.safeParse(q).success).toBe(true);
    expect(postSearchSchema.safeParse({ ...q, maxPosts: 21 }).success).toBe(false);
  });
  it("allocates caps without exceeding total budget and alternates countries", () => {
    const input = campaignInputSchema.parse({ keywords: ["computer vision"], countries: ["Türkiye", "Slovenia"], authors: [], maxPosts: 20, postedWithin: "month", since: "" });
    expect(roundOrder(input)).toEqual([{ country: "Türkiye", round: 1 }, { country: "Slovenia", round: 1 }, { country: "Türkiye", round: 2 }, { country: "Slovenia", round: 2 }, { country: "Türkiye", round: 3 }, { country: "Slovenia", round: 3 }]);
    expect(roundCap(input) * 6).toBeLessThanOrEqual(1);
    expect(roundCap({ ...input, budgetUsd: 100 })).toBe(1);
    expect(campaignInputSchema.safeParse({ ...input, rounds: 21 }).success).toBe(false);
    expect(campaignInputSchema.safeParse({ ...input, countries: [] }).success).toBe(false);
  });
});
