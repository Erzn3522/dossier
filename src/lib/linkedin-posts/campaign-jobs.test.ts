import { beforeEach, describe, expect, it, vi } from "vitest";
import { createProvider } from "@/lib/ai";
import { bestConfidence, campaignProvider, evaluateLinkedInBatch, planLinkedInRound } from "./campaign-jobs";
import { AiError } from "@/lib/ai/errors";

const db = vi.hoisted(() => ({ linkedInAttempt: { findUniqueOrThrow: vi.fn(), findMany: vi.fn(), updateMany: vi.fn(), update: vi.fn() }, linkedInCampaignPost: { findMany: vi.fn(), updateMany: vi.fn() } }));
const complete = vi.hoisted(() => vi.fn());
vi.mock("@/lib/prisma", () => ({ prisma: db }));
vi.mock("@/lib/ai", () => ({ createProvider: vi.fn(() => ({ complete })) }));
vi.mock("@/lib/ai/config", () => ({ loadAiConfig: async () => ({ provider: "LOCAL", model: "my-ollama", baseUrl: "http://ollama:11434", apiKey: null }) }));
vi.mock("@/lib/jobs/runner", () => ({ defineJob: (definition: unknown) => definition }));
vi.mock("@/lib/action", () => ({ ActionError: class ActionError extends Error {} }));
const campaign = { id: "campaign", status: "RUNNING", provider: "LOCAL", model: "my-ollama", input: { keywords: ["Computer Vision"], countries: ["Slovenia"], rounds: 3, budgetUsd: 1, authors: [], maxPosts: 20, postedWithin: "month", since: "" } };
beforeEach(() => {
  vi.clearAllMocks();
  db.linkedInAttempt.findUniqueOrThrow.mockResolvedValue({ id: "attempt", campaignId: campaign.id, country: "Slovenia", round: 2, position: 1, status: "PLANNING", campaign });
  db.linkedInAttempt.findMany.mockResolvedValue([{ queries: ["hiring vision"], fetched: 10, fresh: 3, duplicates: 7, relevant: 0 }]);
  db.linkedInCampaignPost.findMany.mockResolvedValue([]);
  complete.mockResolvedValue({ strategy: "Try local wording", queries: ["računalniški vid zaposlimo"] });
});
describe("queued AI campaign tasks", () => {
  it("commits the user's exact manual baseline before any Ollama completion", async () => {
    const topics = ['"Computer Vision" hiring OR recruiting', '"Machine Vision" engineer hiring'];
    db.linkedInAttempt.findUniqueOrThrow.mockResolvedValue({ id: "attempt", campaignId: campaign.id, country: "Slovenia", round: 1, position: 0, status: "PLANNING", campaign: { ...campaign, input: { ...campaign.input, keywords: topics } } });
    db.linkedInAttempt.findMany.mockResolvedValue([]);
    await planLinkedInRound.run({ attemptId: "attempt" }, { signal: new AbortController().signal, step: vi.fn() });
    expect(complete).not.toHaveBeenCalled();
    expect(db.linkedInAttempt.updateMany).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: "PLANNED", queries: topics }) }));
  });
  it("uses the selected Ollama configuration and commits the plan only while running", async () => {
    await planLinkedInRound.run({ attemptId: "attempt" }, { signal: new AbortController().signal, step: vi.fn() });
    expect(createProvider).toHaveBeenCalledWith(expect.objectContaining({ provider: "LOCAL", model: "my-ollama", baseUrl: "http://ollama:11434" }));
    expect(db.linkedInAttempt.updateMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ campaign: { status: "RUNNING" } }), data: expect.objectContaining({ status: "PLANNED", queries: expect.arrayContaining(["Computer Vision", "računalniški vid zaposlimo"]) }) }));
    expect(complete.mock.calls[0][0].messages[0].content).toContain('"duplicates":7');
  });
  it("prevents silently changing the provider/model of an existing campaign", async () => {
    await expect(campaignProvider({ provider: "OPENAI", model: "other" })).rejects.toThrow("changed");
    expect(createProvider).not.toHaveBeenCalled();
  });
  it("aggregates country confidence without discarding uncertainty", () => {
    const a = { country: "Slovenia", relevant: true, hiring: true, reason: "Unknown", evidence: null, confidence: "uncertain" as const };
    expect(bestConfidence([a])).toBe("uncertain");
    expect(bestConfidence([a, { ...a, country: "Turkey", confidence: "likely" }])).toBe("likely");
  });
  it("keeps omitted assessments explicitly unavailable instead of failing the whole paid-search campaign", async () => {
    db.linkedInAttempt.findUniqueOrThrow.mockResolvedValue({ id: "attempt", campaignId: campaign.id, country: "Slovenia", round: 1, status: "ANALYZING", campaign, error: null });
    const rows = [1, 2, 3].map((i) => ({ id: `row-${i}`, hiring: true, assessments: [], post: { id: `725280059373851033${i}`, url: `https://www.linkedin.com/posts/${i}`, text: "Hiring Computer Vision engineer", postedAt: null, likes: 0, commentsCount: 0, query: "vision", author: { name: "Acme", type: "company", url: null } } }));
    db.linkedInCampaignPost.findMany.mockResolvedValue(rows);
    complete.mockResolvedValue({ posts: [] });
    await expect(evaluateLinkedInBatch.run({ attemptId: "attempt" }, { signal: new AbortController().signal, step: vi.fn() })).resolves.toEqual({ attemptId: "attempt" });
    expect(complete).toHaveBeenCalledTimes(2);
    expect(db.linkedInCampaignPost.findMany).toHaveBeenCalledWith(expect.objectContaining({ take: 3 }));
    expect(db.linkedInCampaignPost.updateMany).toHaveBeenCalledTimes(3);
    expect(db.linkedInCampaignPost.updateMany).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ assessments: [expect.objectContaining({ status: "unavailable", confidence: "uncertain" })] }) }));
    expect(db.linkedInAttempt.update).toHaveBeenCalledWith(expect.objectContaining({ data: { error: expect.stringContaining("later search rounds will continue") } }));
  });
  it("ends a failed optional AI assessment without discarding any of the 20 fetched posts", async () => {
    db.linkedInAttempt.findUniqueOrThrow.mockResolvedValue({ id: "attempt", campaignId: campaign.id, country: "Slovenia", round: 1, status: "ANALYZING", campaign, error: null });
    const rows = Array.from({ length: 20 }, (_, i) => ({ id: `row-${i}`, hiring: true, assessments: [], post: { id: String(i), url: `https://www.linkedin.com/posts/${i}`, text: "Hiring vision engineer", postedAt: null, likes: 0, commentsCount: 0, query: "vision", author: { name: "Acme", type: "company", url: null } } }));
    db.linkedInCampaignPost.findMany.mockResolvedValueOnce(rows.slice(0, 3)).mockResolvedValueOnce(rows);
    complete.mockRejectedValue(AiError.of("invalid-output"));
    await evaluateLinkedInBatch.run({ attemptId: "attempt" }, { signal: new AbortController().signal, step: vi.fn() });
    expect(complete).toHaveBeenCalledOnce();
    expect(db.linkedInCampaignPost.updateMany).toHaveBeenCalledTimes(20);
    expect(db.linkedInAttempt.update).toHaveBeenCalledWith(expect.objectContaining({ data: { error: expect.stringContaining("AI assessment unavailable") } }));
  });
});
