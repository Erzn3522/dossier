import { describe, expect, it, vi } from "vitest";

import { MockProvider } from "@/lib/ai/providers/mock";
import type { TaskOptions } from "@/lib/ai/tasks";

import { discoverApplicationEmails, discoveryQueries } from "./discover";
import { EmailSearchUnavailable } from "./searxng";

const options: TaskOptions = { creativity: "BALANCED", strict: true, language: null };
const input = { company: "Example GmbH", role: "Product Designer", postingUrl: "https://example.com/jobs/designer" };

describe("application email discovery", () => {
  it("extracts real page addresses and lets the model rank only those candidates", async () => {
    const provider = new MockProvider({ reply: () => ({
      rankings: [{ candidate: 0, confidence: "HIGH", reason: "The official careers page names it for applications." }],
    }) });
    const search = vi.fn(async () => [{ url: "https://example.com/careers", title: "Example careers", content: "" }]);
    const readPage = vi.fn(async () => ({
      ok: true as const,
      text: "Open roles\nSend your application to jobs@example.com. Privacy: privacy@example.com.",
      source: "page" as const,
      url: "https://example.com/careers",
    }));

    const result = await discoverApplicationEmails(provider, input, options, {
      search,
      readPage,
      now: new Date("2026-10-19T10:00:00.000Z"),
    });

    expect(result).toMatchObject({ searchedAt: "2026-10-19T10:00:00.000Z", pagesRead: 1, rankedWith: "rank-application-emails@1", error: null });
    expect(result.candidates).toEqual([expect.objectContaining({
      email: "jobs@example.com",
      sourceUrl: "https://example.com/careers",
      sourceTitle: "Example careers",
      confidence: "HIGH",
    })]);
    expect(result.candidates.map((candidate) => candidate.email)).not.toContain("privacy@example.com");
    expect(provider.calls[0].system).toMatch(/Never construct, correct, infer or suggest another address/);
  });

  it("keeps missing email as a reviewable result when search is unavailable", async () => {
    const provider = new MockProvider({ reply: () => ({ rankings: [] }) });
    const search = vi.fn(async () => { throw new EmailSearchUnavailable("The email search service could not be reached."); });
    const result = await discoverApplicationEmails(provider, input, options, { search });
    expect(result).toMatchObject({ pagesRead: 0, candidates: [], error: "The email search service could not be reached." });
    expect(provider.calls).toHaveLength(0);
  });

  it("does not let the model promote weak third-party evidence to high confidence", async () => {
    const provider = new MockProvider({ reply: () => ({
      rankings: [{ candidate: 0, confidence: "HIGH", reason: "It looks useful." }],
    }) });
    const search = vi.fn(async () => [{ url: "https://directory.test/example", title: "Company directory", content: "" }]);
    const readPage = vi.fn(async () => ({
      ok: true as const,
      text: "Example GmbH contact: hello@example.com",
      source: "page" as const,
      url: "https://directory.test/example",
    }));

    const result = await discoverApplicationEmails(provider, input, options, { search, readPage });

    expect(result.candidates[0]).toMatchObject({ email: "hello@example.com", confidence: "LOW" });
  });

  it("uses an official site query when the posting is on the employer's site, not a job board", () => {
    expect(discoveryQueries(input)[0]).toBe("site:example.com (careers OR jobs OR recruiting) email");
    expect(discoveryQueries({ ...input, postingUrl: "https://www.linkedin.com/jobs/123" }).some((query) => query.startsWith("site:"))).toBe(false);
  });
});
