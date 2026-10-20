import { describe, expect, it, vi } from "vitest";

import { EmailSearchUnavailable, searchWeb } from "./searxng";

describe("SearXNG email search", () => {
  it("asks the private JSON API and keeps only web results", async () => {
    const fetcher = vi.fn(async (_input: Parameters<typeof fetch>[0]) => new Response(JSON.stringify({
      results: [
        { url: "https://example.com/careers", title: "Careers", content: "Join us" },
        { url: "javascript:alert(1)", title: "Bad", content: "" },
      ],
    }), { headers: { "content-type": "application/json" } }));

    await expect(searchWeb("Example jobs", { baseUrl: "http://searxng:8080/private", fetcher })).resolves.toEqual([
      { url: "https://example.com/careers", title: "Careers", content: "Join us" },
    ]);
    const url = new URL(String(fetcher.mock.calls[0]![0]));
    expect(url.pathname).toBe("/private/search");
    expect(url.searchParams.get("q")).toBe("Example jobs");
    expect(url.searchParams.get("format")).toBe("json");
  });

  it("reports an unreadable or failed service without leaking its response", async () => {
    const failed = vi.fn(async () => new Response("secret upstream answer", { status: 503 }));
    await expect(searchWeb("Example", { baseUrl: "http://searxng:8080", fetcher: failed })).rejects.toEqual(
      expect.objectContaining({ name: "EmailSearchUnavailable", message: "The email search service answered with HTTP 503." }),
    );
    const invalid = vi.fn(async () => new Response("not json"));
    await expect(searchWeb("Example", { baseUrl: "http://searxng:8080", fetcher: invalid })).rejects.toBeInstanceOf(EmailSearchUnavailable);
  });
});
