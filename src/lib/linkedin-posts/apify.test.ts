import { afterEach, describe, expect, it, vi } from "vitest";
import { actorInput, apifyRequest, parsePosts, parseRun } from "./apify";

// No real session, database or credentials are needed for these provider contract tests.
vi.mock("@/lib/action", () => ({ ActionError: class ActionError extends Error {} }));
afterEach(() => vi.unstubAllGlobals());
const row = { id: "123", url: "https://www.linkedin.com/posts/example?tracking=x", text: "We are hiring", postedAt: "2026-10-30T10:00:00Z", author: { name: "Acme", url: "https://www.linkedin.com/company/acme/", type: "company" }, likes: 5, commentsCount: 2 };

describe("Apify post search adapter", () => {
  it("uses the documented actor fields", () => {
    expect(actorInput({ keywords: ["hiring engineer"], authors: ["acme"], postedWithin: "week", since: "2026-10-01", maxPosts: 20 })).toEqual({
      searchQueries: ["hiring engineer"], authorFilter: ["acme"], postedLimit: "week", postedLimitDate: "2026-10-01", maxPosts: 20, includeComments: false,
    });
  });
  it("deduplicates and normalizes posts, dropping unsafe links and unknown fields", () => {
    const posts = parsePosts([row, { ...row, likes: 6 }, { ...row, id: "bad", url: "javascript:alert(1)" }]);
    expect(posts).toHaveLength(1);
    expect(posts[0]).toMatchObject({ id: "123", likes: 6, url: "https://www.linkedin.com/posts/example", author: { type: "company" } });
    expect(parsePosts([{ ...row, postedAt: "not a date", author: { name: "Person", url: "https://evil.test", type: "other" } }])[0]).toMatchObject({ postedAt: null, author: { url: null, type: "unknown" } });
  });
  it("allows empty results but reports a provider format change", () => {
    expect(parsePosts([])).toEqual([]);
    expect(() => parsePosts([{ changedField: "value" }])).toThrow("expected post format");
    expect(() => parsePosts({ data: [] })).toThrow("not a list");
    expect(() => parseRun({ data: {} })).toThrow("response changed");
  });
  it("sends the token in the Authorization header and never in the URL", async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify({ data: { id: "run", status: "READY" } })));
    vi.stubGlobal("fetch", fetcher);
    const result = await apifyRequest("test-token", "/actors/example/runs", { searchQueries: ["hiring"] });
    expect(parseRun(result)).toEqual({ id: "run", status: "READY" });
    expect(fetcher).toHaveBeenCalledWith("https://api.apify.com/v2/actors/example/runs", expect.objectContaining({ method: "POST", headers: expect.objectContaining({ Authorization: "Bearer test-token" }) }));
  });
  it.each([401, 403, 402, 429, 500])("returns a safe message for HTTP %s", async (status) => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("sensitive-provider-error", { status })));
    await expect(apifyRequest("secret", "/users/me")).rejects.not.toThrow("sensitive-provider-error");
  });
  it("never retries a paid request after an uncertain network error", async () => {
    const fetcher = vi.fn().mockRejectedValue(new Error("network")); vi.stubGlobal("fetch", fetcher);
    await expect(apifyRequest("token", "/actors/example/runs", {})).rejects.toThrow("a run may have started");
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
});
