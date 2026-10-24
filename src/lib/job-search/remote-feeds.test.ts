import { afterEach, describe, expect, it, vi } from "vitest";

import { json, stubFetch } from "@/lib/ai/test-http";

import { clearFeedSnapshots } from "./feed";
import { EMPTY_QUERY } from "./search";
import { remoteOk } from "./remote-ok";
import { remotive } from "./remotive";
import { weWorkRemotely } from "./we-work-remotely";

const query = { ...EMPTY_QUERY, keywords: "backend engineer", country: "de", remoteOnly: true };

afterEach(() => {
  clearFeedSnapshots();
  vi.unstubAllGlobals();
});

describe("keyless remote job feeds", () => {
  it("maps and locally filters Remote OK's JSON feed", async () => {
    const requests = stubFetch(() => json([
      { legal: "link back" },
      {
        id: "rok-1",
        epoch: 1_799_000_000,
        company: "Northwind",
        position: "Senior Backend Engineer",
        location: "Europe",
        description: "Build distributed services with TypeScript.",
        tags: ["typescript", "api"],
        salary_min: 80000,
        salary_max: 100000,
        url: "https://remoteok.com/remote-jobs/rok-1",
      },
      { id: "rok-2", position: "Product Designer", location: "Europe", url: "https://remoteok.com/remote-jobs/rok-2" },
    ]));
    const page = await remoteOk.search(query, {}, null);
    expect(requests[0].url.href).toBe("https://remoteok.com/api");
    expect(page.postings).toEqual([expect.objectContaining({
      source: "REMOTE_OK",
      externalId: "rok-1",
      title: "Senior Backend Engineer",
      company: "Northwind",
      place: "Europe",
      remote: true,
      salary: "USD 80,000–100,000 a year",
      via: "Remote OK",
      complete: true,
    })]);
  });

  it("downloads Remotive's common feed and rejects a mismatched location locally", async () => {
    const requests = stubFetch(() => json({ jobs: [
      {
        id: 42,
        url: "https://remotive.com/remote-jobs/software-dev/backend-engineer-42",
        title: "Backend Engineer",
        company_name: "Ledgerly",
        publication_date: "2026-10-20T09:00:00Z",
        candidate_required_location: "Worldwide",
        salary: "EUR 70k–90k",
        description: "<p>Backend engineer working with APIs.</p>",
        tags: ["Node.js"],
      },
      {
        id: 43,
        url: "https://remotive.com/remote-jobs/software-dev/backend-engineer-43",
        title: "Backend Engineer",
        company_name: "US Only",
        candidate_required_location: "USA only",
        description: "Backend engineer.",
      },
    ] }));
    const page = await remotive.search(query, {}, null);
    expect(requests[0].url.search).toBe("");
    expect(page.postings).toEqual([expect.objectContaining({ source: "REMOTIVE", externalId: "42", via: "Remotive" })]);
    await remotive.search({ ...query, keywords: "product designer" }, {}, null);
    expect(requests).toHaveLength(1);
  });

  it("reads We Work Remotely's public RSS and links to the source", async () => {
    const xml = `<?xml version="1.0"?><rss><channel><item>
      <title>Contoso: Backend Engineer</title>
      <region>Anywhere in the World</region>
      <description><![CDATA[<p>Backend engineer building APIs.</p>]]></description>
      <pubDate>Tue, 20 Oct 2026 09:00:00 GMT</pubDate>
      <guid>https://weworkremotely.com/remote-jobs/contoso-backend-engineer</guid>
      <link>https://weworkremotely.com/remote-jobs/contoso-backend-engineer</link>
    </item><item>
      <title>Fabrikam: Backend Engineer</title>
      <region>Anywhere in the World</region>
      <country>USA</country>
      <description>Backend engineer restricted to the United States.</description>
      <guid>https://weworkremotely.com/remote-jobs/fabrikam-backend-engineer</guid>
      <link>https://weworkremotely.com/remote-jobs/fabrikam-backend-engineer</link>
    </item></channel></rss>`;
    const requests = stubFetch(() => new Response(xml, { headers: { "content-type": "application/rss+xml" } }));
    const page = await weWorkRemotely.search(query, {}, null);
    expect(requests[0].url.href).toBe("https://weworkremotely.com/remote-jobs.rss");
    expect(page.postings).toEqual([expect.objectContaining({
      source: "WE_WORK_REMOTELY",
      title: "Backend Engineer",
      company: "Contoso",
      via: "We Work Remotely",
      complete: true,
    })]);
  });
});
