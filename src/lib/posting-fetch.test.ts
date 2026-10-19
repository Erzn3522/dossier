import { lookup as dnsLookup } from "node:dns";
import { createServer, type Server } from "node:http";
import type { AddressInfo, LookupFunction } from "node:net";
import { gzipSync } from "node:zlib";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { FETCH_MESSAGES, fetchPosting, fetchPublicPage, guardedLookup, isPublicAddress, postingFromHtml } from "./posting-fetch";

const DESCRIPTION = "We're looking for a senior product designer to own our payout flows end to end. ".repeat(4);

const jobPage = (jsonLd: unknown) => `<!doctype html><html><head><title>Job</title>
<script type="application/ld+json">${JSON.stringify(jsonLd)}</script></head>
<body><div id="app"></div></body></html>`;

const posting = {
  "@context": "https://schema.org",
  "@type": "JobPosting",
  title: "Senior Product Designer, Payments",
  hiringOrganization: { "@type": "Organization", name: "Ledgerly" },
  jobLocation: { "@type": "Place", address: { addressLocality: "Amsterdam", addressCountry: { name: "Netherlands" } } },
  employmentType: "FULL_TIME",
  baseSalary: { currency: "EUR", value: { minValue: 75000, maxValue: 90000, unitText: "YEAR" } },
  validThrough: "2026-10-15T23:59:59Z",
  description: `&lt;p&gt;${DESCRIPTION}&lt;/p&gt;&lt;ul&gt;&lt;li&gt;5+ years of product design&lt;/li&gt;&lt;li&gt;Strong Figma skills&lt;/li&gt;&lt;/ul&gt;`,
};

describe("isPublicAddress (E7-8)", () => {
  it("allows the internet and refuses private, local and reserved networks", () => {
    for (const address of ["93.184.216.34", "8.8.8.8", "2606:4700::1111"]) expect(isPublicAddress(address), address).toBe(true);
    for (const address of ["127.0.0.1", "10.1.2.3", "172.20.0.5", "192.168.1.1", "169.254.169.254", "100.64.0.1", "0.0.0.0", "::1", "fd00::1", "fe80::1", "::ffff:10.0.0.1", "not an ip"]) {
      expect(isPublicAddress(address), address).toBe(false);
    }
  });
});

describe("postingFromHtml (E7-8)", () => {
  it("prefers the page's JobPosting data, escaped HTML and all", () => {
    const result = postingFromHtml(jobPage([{ "@type": "WebSite" }, { "@graph": [posting] }]));
    expect(result?.source).toBe("structured");
    expect(result?.text).toBe(
      [
        "Ledgerly: Senior Product Designer, Payments",
        "Amsterdam, Netherlands · full time · EUR 75000–90000 per year · Apply by 2026-10-15",
        `${DESCRIPTION.trim()}\n- 5+ years of product design\n- Strong Figma skills`,
      ].join("\n\n"),
    );
  });

  it("falls back to the page's main text, without menus and scripts", () => {
    const html = `<html><body><nav>Jobs · About</nav><main><h1>Product Designer</h1><p>${DESCRIPTION}</p>
      <ul><li>Figma</li><li>User research</li></ul><script>track()</script></main><footer>© Acme</footer></body></html>`;
    expect(postingFromHtml(html)).toEqual({ source: "page", text: `Product Designer\n${DESCRIPTION.trim()}\n- Figma\n- User research` });
  });

  it("gives up on a page with hardly any text", () => {
    expect(postingFromHtml("<html><body><div id=root></div><p>Loading…</p></body></html>")).toBeNull();
  });
});

describe("fetchPosting (E7-8)", () => {
  let server: Server;
  let base = "";
  // Tests serve pages on localhost, which the real lookup refuses.
  const lookup: LookupFunction = (hostname, options, callback) => dnsLookup(hostname, options, callback);

  beforeAll(async () => {
    server = createServer((request, response) => {
      const html = jobPage(posting);
      switch (request.url) {
        case "/job":
          return response.writeHead(200, { "content-type": "text/html; charset=utf-8" }).end(html);
        case "/gzip":
          return response.writeHead(200, { "content-type": "text/html", "content-encoding": "gzip" }).end(gzipSync(html));
        case "/moved":
          return response.writeHead(301, { location: "/job" }).end();
        case "/loop":
          return response.writeHead(302, { location: "/loop" }).end();
        case "/pdf":
          return response.writeHead(200, { "content-type": "application/pdf" }).end("%PDF-");
        case "/contact":
          return response.writeHead(200, { "content-type": "text/html" }).end('<html><body><main>Careers</main><footer><a href="mailto:jobs@example.com?subject=Application">Apply by email</a></footer></body></html>');
        case "/huge":
          response.writeHead(200, { "content-type": "text/html" });
          for (let i = 0; i < 300; i++) response.write("x".repeat(10_000));
          return response.end();
        case "/slow":
          return void setTimeout(() => response.writeHead(200, { "content-type": "text/html" }).end(html), 1500);
        default:
          return response.writeHead(404).end();
      }
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });
  afterAll(() => new Promise<void>((resolve) => server.close(() => resolve())));

  it("reads a posting, following redirects and unpacking gzip", async () => {
    for (const path of ["/job", "/gzip", "/moved"]) {
      const result = await fetchPosting(`${base}${path}`, { lookup });
      expect(result, path).toMatchObject({ ok: true, source: "structured", url: `${base}/job`.replace("/job", path === "/gzip" ? "/gzip" : "/job") });
      if (result.ok) expect(result.text).toContain("Ledgerly: Senior Product Designer, Payments");
    }
  });

  it("explains every way it can fail", async () => {
    expect(await fetchPosting(`${base}/missing`, { lookup })).toEqual({ ok: false, error: FETCH_MESSAGES.failed(404) });
    expect(await fetchPosting(`${base}/loop`, { lookup })).toEqual({ ok: false, error: FETCH_MESSAGES.unreachable });
    expect(await fetchPosting(`${base}/pdf`, { lookup })).toEqual({ ok: false, error: FETCH_MESSAGES.notPage });
    expect(await fetchPosting(`${base}/huge`, { lookup })).toEqual({ ok: false, error: FETCH_MESSAGES.tooBig });
    expect(await fetchPosting(`${base}/slow`, { lookup, timeoutMs: 300 })).toEqual({ ok: false, error: FETCH_MESSAGES.unreachable });
  });

  it("reads visible text and mailto addresses from a public contact page", async () => {
    const result = await fetchPublicPage(`${base}/contact`, { lookup });
    expect(result).toMatchObject({ ok: true, source: "page", url: `${base}/contact` });
    if (result.ok) expect(result.text).toContain("Email link: jobs@example.com");
  });

  it("never goes to the server's own network, however the address is written", async () => {
    for (const link of [base, "http://localhost:3000/", "http://[::1]/", "http://169.254.169.254/latest/meta-data", "http://localhost./"]) {
      expect(await fetchPosting(link), link).toEqual({ ok: false, error: FETCH_MESSAGES.privateAddress });
    }
    for (const link of ["ftp://example.com/job", "http://user:secret@example.com/", "not a link"]) {
      expect(await fetchPosting(link), link).toEqual({ ok: false, error: FETCH_MESSAGES.notWeb });
    }
  });

  it("refuses a name that resolves to a private address, when connecting", async () => {
    const error = await new Promise((resolve) => guardedLookup("localhost", {}, (failure) => resolve(failure)));
    expect(error).toMatchObject({ code: "EPRIVATE" });
  });
});
