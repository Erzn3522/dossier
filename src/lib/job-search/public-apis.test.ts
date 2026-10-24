import { afterEach, describe, expect, it, vi } from "vitest";
import { json, stubFetch } from "@/lib/ai/test-http";
import { arbeitnow } from "./arbeitnow";
import { clearFeedSnapshots } from "./feed";
import { himalayas } from "./himalayas";
import { jobicy } from "./jobicy";
import { EMPTY_QUERY } from "./search";

const query = { ...EMPTY_QUERY, keywords: '"computer vision" OR "robotics engineer"', place: "Berlin", country: "de", remoteOnly: true, postedWithin: "week" as const };
const recent = new Date().toISOString();

afterEach(() => { clearFeedSnapshots(); vi.unstubAllGlobals(); });

describe("new public job APIs", () => {
  it("maps Himalayas, preserves applicationLink, paginates, and caches a page daily", async () => {
    const requests = stubFetch(() => json({ jobs: [{ guid: "h-1", title: "Computer Vision Engineer", companyName: "Vision", locationRestrictions: ["Germany"],
      description: "Build perception systems", pubDate: Math.floor(Date.now() / 1000), applicationLink: "https://apply.example/h-1" }] }));
    const first = await himalayas.search(query, {}, null);
    const cached = await himalayas.search(query, {}, null);
    expect(requests).toHaveLength(1); expect(cached).toEqual(first);
    expect(first).toEqual({ postings: [expect.objectContaining({ source: "HIMALAYAS", url: "https://apply.example/h-1", via: "Himalayas" })], next: "page:2" });
  });

  it("maps Jobicy's canonical URL and opaque cursor", async () => {
    stubFetch(() => json({ success: true, nextCursor: "opaque-token", jobs: [{ id: 7, url: "https://jobicy.com/jobs/cv-7", jobTitle: "Computer Vision Engineer",
      companyName: "Optics", jobGeo: "Europe", jobDescription: "Computer vision systems", pubDate: recent }] }));
    const page = await jobicy.search(query, {}, null);
    expect(page.next).toBe("cursor:opaque-token");
    expect(page.postings[0]).toEqual(expect.objectContaining({ source: "JOBICY", url: "https://jobicy.com/jobs/cv-7", via: "Jobicy" }));
  });

  it("filters Arbeitnow non-remote jobs when remote is required and follows its canonical next link", async () => {
    stubFetch(() => json({ data: [
      { slug: "a-1", title: "Robotics Engineer", company_name: "Robotics", location: "Berlin, Germany", remote: true, description: "Robotics engineer", url: "https://www.arbeitnow.com/jobs/a-1", created_at: Math.floor(Date.now() / 1000) },
      { slug: "a-2", title: "Robotics Engineer", company_name: "Factory", location: "Berlin, Germany", remote: false, description: "Robotics engineer", url: "https://www.arbeitnow.com/jobs/a-2", created_at: Math.floor(Date.now() / 1000) },
    ], links: { next: "https://www.arbeitnow.com/api/job-board-api?page=2" } }));
    const page = await arbeitnow.search(query, {}, null);
    expect(page.postings.map((item) => item.externalId)).toEqual(["a-1"]);
    expect(page.next).toBe("url:https://www.arbeitnow.com/api/job-board-api?page=2");
  });
});
