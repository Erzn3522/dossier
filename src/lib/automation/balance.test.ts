import { describe, expect, it } from "vitest";

import type { FoundPosting, JobSource } from "@/lib/job-search/search";

import { balancedPostings } from "./balance";

const posting = (source: JobSource, id: string, url = `https://jobs.example/${id}`): FoundPosting => ({
  source,
  externalId: id,
  title: `Backend Engineer ${id}`,
  company: "Example",
  place: "Worldwide",
  remote: true,
  salary: "",
  postedAt: null,
  url,
  via: "",
  description: "Backend engineering.",
  complete: true,
});

describe("balancedPostings", () => {
  it("round-robins sources and gives unused capacity to sources with more matches", () => {
    const result = balancedPostings([
      [posting("JSEARCH", "j1"), posting("JSEARCH", "j2"), posting("JSEARCH", "j3")],
      [posting("REMOTE_OK", "r1")],
      [],
      [posting("WE_WORK_REMOTELY", "w1"), posting("WE_WORK_REMOTELY", "w2")],
    ], 5);
    expect(result.map((item) => item.externalId)).toEqual(["j1", "r1", "w1", "j2", "w2"]);
  });

  it("deduplicates the same listing URL across sources before applying the limit", () => {
    const result = balancedPostings([
      [posting("JSEARCH", "j1", "https://jobs.example/one?utm_source=jsearch")],
      [posting("REMOTIVE", "r1", "https://jobs.example/one"), posting("REMOTIVE", "r2")],
    ], 3);
    expect(result.map((item) => item.externalId)).toEqual(["j1", "r2"]);
  });

  it("deduplicates the same company and role when aggregators use different URLs", () => {
    const result = balancedPostings([
      [{ ...posting("JSEARCH", "j1", "https://aggregator.example/one"), title: "Vision Engineer" }],
      [{ ...posting("REMOTE_OK", "r1", "https://remoteok.com/one"), title: "Vision  Engineer" }],
    ], 2);
    expect(result.map((item) => item.externalId)).toEqual(["j1"]);
  });
});
