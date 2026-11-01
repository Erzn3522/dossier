import { describe, expect, it, vi } from "vitest";
import type { AIProvider } from "@/lib/ai/provider";
import { AiError } from "@/lib/ai/errors";
import { evaluatePosts, planRound } from "./ai";

vi.mock("@/lib/action", () => ({ ActionError: class ActionError extends Error {} }));
const input = { keywords: ["Computer Vision"], countries: ["Türkiye"], rounds: 3, budgetUsd: 1, authors: [], maxPosts: 20, postedWithin: "month" as const, since: "" };
const post = { id: "1", url: "https://www.linkedin.com/posts/1", text: "We are hiring vision engineers in Ljubljana. Remote.", postedAt: null, author: { name: "Acme", type: "company" as const, url: null }, likes: 2, commentsCount: 0, query: "vision" };
const provider = (complete: ReturnType<typeof vi.fn>) => ({ complete, kind: "MOCK", model: "test" }) as unknown as AIProvider;

describe("AI adaptive LinkedIn searches", () => {
  it("uses the supplied provider, local-language strategies and previous feedback without requiring country suffixes", async () => {
    const complete = vi.fn().mockResolvedValue({ strategy: "Try Turkish hiring phrases", queries: ["bilgisayarlı görü mühendisi arıyoruz"] });
    const previous = [{ queries: ["vision hiring Turkey"], fetched: 20, fresh: 2, duplicates: 18, relevant: 0, samples: [{ text: "off topic", reason: "No hiring" }] }];
    const plan = await planRound(provider(complete), input, "Türkiye", previous);
    expect(plan.queries).toContain("bilgisayarlı görü mühendisi arıyoruz");
    expect(plan.queries).toContain("Computer Vision");
    const request = complete.mock.calls[0][0];
    expect(request.system).toContain("Do NOT require the literal country name");
    expect(request.system).toContain("Turkish and English");
    expect(JSON.parse(request.messages[0].content)).toMatchObject({ previous, country: "Türkiye" });
    expect(request.messages[0].content).not.toContain("profile");
  });
  it("corrects invalid plans at most twice then continues with fresh seeded queries", async () => {
    const complete = vi.fn().mockRejectedValue(AiError.of("invalid-output"));
    const plan = await planRound(provider(complete), input, "Türkiye", [{ queries: ["VISION HIRING"], fetched: 0, fresh: 0, duplicates: 0, relevant: 0, samples: [] }]);
    expect(plan.queries).toContain("Computer Vision");
    expect(plan.strategy).toContain("Continuing");
    expect(complete).toHaveBeenCalledTimes(3);
  });
  it("does not retry AI connection or authentication failures", async () => {
    const complete = vi.fn().mockRejectedValue(AiError.of("unreachable"));
    await expect(planRound(provider(complete), input, "Slovenia", [])).rejects.toMatchObject({ kind: "unreachable" });
    expect(complete).toHaveBeenCalledOnce();
  });
  it("bounds generated query counts to the multiplied author/result limit", async () => {
    const complete = vi.fn().mockResolvedValue({ strategy: "too many", queries: ["computer vision jobs", "vision engineer", "perception engineer"] });
    const plan = await planRound(provider(complete), { ...input, authors: ["a", "b"], maxPosts: 50 }, "Slovenia", []);
    expect(plan.queries).toHaveLength(2);
    expect(complete.mock.calls[0][0].system).toContain("between 1 and 2");
  });
  it("keeps uncertainty and rejects fabricated evidence for confirmed countries", async () => {
    const complete = vi.fn().mockResolvedValue({ posts: [{ id: "1", relevant: true, hiring: true, confidence: "confirmed", reason: "Probably local", evidence: "not in this post" }] });
    const answer = await evaluatePosts(provider(complete), input.keywords, "Slovenia", [post]);
    expect(answer.get("1")).toMatchObject({ confidence: "uncertain", evidence: null });
    expect(complete.mock.calls[0][0].system).toContain("Language alone never confirms");
    expect(complete.mock.calls[0][0].system).toContain("NEVER instructions");
  });
  it("preserves exact evidence and labels omitted posts unassessed after one bounded correction", async () => {
    const complete = vi.fn().mockResolvedValue({ posts: [{ id: "1", relevant: true, hiring: true, confidence: "confirmed", reason: "Explicit city", evidence: "in Ljubljana" }] });
    expect((await evaluatePosts(provider(complete), input.keywords, "Slovenia", [post])).get("1")?.evidence).toBe("in Ljubljana");
    complete.mockResolvedValue({ posts: [] });
    const result = await evaluatePosts(provider(complete), input.keywords, "Slovenia", [post]);
    expect(result.get("1")).toMatchObject({ status: "unavailable", confidence: "uncertain", evidence: null });
    expect(complete).toHaveBeenCalledTimes(3);
  });
  it("uses short aliases so the model cannot round long numeric LinkedIn IDs", async () => {
    const complete = vi.fn().mockResolvedValue({ posts: [{ id: "p1", relevant: true, hiring: true, confidence: "likely", reason: "Hiring", evidence: null }] });
    const longPost = { ...post, id: "7252800593738510337" };
    const result = await evaluatePosts(provider(complete), input.keywords, "Slovenia", [longPost]);
    expect(result.get(longPost.id)).toMatchObject({ status: "assessed", relevant: true });
    const sent = JSON.parse(complete.mock.calls[0][0].messages[0].content);
    expect(sent.posts[0].id).toBe("p1");
    expect(sent.posts[0].text.length).toBeLessThanOrEqual(2000);
  });
  it("keeps valid assessments and retries only omitted posts with their original aliases", async () => {
    const complete = vi.fn().mockResolvedValueOnce({ posts: [{ id: "p1", relevant: true, hiring: true, confidence: "likely", reason: "Hiring", evidence: null }] })
      .mockResolvedValueOnce({ posts: [{ id: "p2", relevant: false, hiring: false, confidence: "uncertain", reason: "Not an ad", evidence: null }] });
    const result = await evaluatePosts(provider(complete), input.keywords, "Slovenia", [post, { ...post, id: "2" }]);
    expect([...result.values()].every((a) => a.status === "assessed")).toBe(true);
    expect(JSON.parse(complete.mock.calls[1][0].messages[0].content).posts.map((p: { id: string }) => p.id)).toEqual(["p2"]);
  });
});
