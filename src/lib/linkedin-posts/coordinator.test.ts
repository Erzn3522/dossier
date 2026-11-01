import { beforeEach, describe, expect, it, vi } from "vitest";
import { apifyRequest } from "./apify";
import { startJob } from "@/lib/jobs/runner";
import { recoverCampaigns, tickCampaigns } from "./coordinator";

const db = vi.hoisted(() => ({
  linkedInCampaign: { findMany: vi.fn(), updateMany: vi.fn(), update: vi.fn() },
  linkedInAttempt: { findFirst: vi.fn(), findMany: vi.fn(), update: vi.fn(), updateMany: vi.fn() },
  linkedInCampaignPost: { findUnique: vi.fn(), upsert: vi.fn(), count: vi.fn(), findMany: vi.fn() },
  $transaction: vi.fn(),
}));
vi.mock("@/lib/prisma", () => ({ prisma: db }));
vi.mock("@/lib/action", () => ({ ActionError: class ActionError extends Error {} }));
vi.mock("@/lib/log", () => ({ logServerError: vi.fn() }));
vi.mock("./searches", () => ({ loadApifyKey: async () => "test-token" }));
vi.mock("@/lib/jobs/runner", () => ({ startJob: vi.fn(), getJob: vi.fn().mockResolvedValue({ status: "DONE" }), cancelJob: vi.fn() }));
vi.mock("./campaign-jobs", () => ({ planLinkedInRound: { type: "plan" }, evaluateLinkedInBatch: { type: "evaluate" }, pendingEvaluation: () => ({}) }));
vi.mock("./apify", async (original) => ({ ...await original<typeof import("./apify")>(), apifyRequest: vi.fn() }));
const input = { keywords: ["Computer Vision"], countries: ["Turkey", "Slovenia"], rounds: 3, budgetUsd: 1, authors: [], maxPosts: 20, postedWithin: "month", since: "" };
const campaign = { id: "campaign", input, status: "RUNNING", error: null };
let attempts: Array<{ id: string; campaignId: string; country: string; round: number; position: number; status: string; queries: string[]; capUsd: number; runId: string | null; jobId: string | null; error: string | null; fetched: number; fresh: number; duplicates: number }>;
let stored: Array<{ url: string; occurrences: unknown[] }>;
beforeEach(() => {
  vi.clearAllMocks(); campaign.status = "RUNNING"; campaign.error = null;
  stored = [];
  attempts = Array.from({ length: 6 }, (_, i) => ({ id: `attempt-${i}`, campaignId: campaign.id, country: i % 2 ? "Slovenia" : "Turkey", round: Math.floor(i / 2) + 1, position: i, status: "PENDING", queries: [], capUsd: 0.166666, runId: null, jobId: null, error: null, fetched: 0, fresh: 0, duplicates: 0 }));
  db.linkedInCampaign.findMany.mockImplementation(async () => ["RUNNING", "CANCELLING"].includes(campaign.status) ? [{ ...campaign }] : []);
  db.linkedInCampaign.updateMany.mockImplementation(async ({ data }) => { Object.assign(campaign, data); return { count: 1 }; });
  db.linkedInCampaign.update.mockImplementation(async ({ data }) => Object.assign(campaign, data));
  db.linkedInAttempt.findFirst.mockImplementation(async () => { const a = attempts.find((a) => a.status !== "COMPLETE"); return a ? { ...a } : null; });
  db.linkedInAttempt.findMany.mockImplementation(async () => attempts.filter((a) => a.status !== "COMPLETE").map((a) => ({ ...a })));
  db.linkedInAttempt.update.mockImplementation(async ({ where, data }) => Object.assign(attempts.find((a) => a.id === where.id)!, data));
  db.linkedInAttempt.updateMany.mockImplementation(async ({ where, data }) => {
    const a = attempts.find((a) => a.id === where.id && a.status === where.status);
    if (!a || (where.campaign && campaign.status !== where.campaign.status)) return { count: 0 };
    Object.assign(a, data); return { count: 1 };
  });
  db.$transaction.mockImplementation((fn) => fn(db));
  db.linkedInCampaignPost.findUnique.mockImplementation(async ({ where }) => stored.find((p) => p.url === where.campaignId_url.url) ?? null);
  db.linkedInCampaignPost.upsert.mockImplementation(async ({ where, create, update }) => {
    const old = stored.find((p) => p.url === where.campaignId_url.url);
    if (old) Object.assign(old, update); else stored.push(create); return old ?? create;
  });
  db.linkedInCampaignPost.count.mockResolvedValue(0);
  db.linkedInCampaignPost.findMany.mockResolvedValue([{ assessments: [{ country: "Turkey", relevant: true, hiring: true, confidence: "likely", reason: "Match", evidence: null }, { country: "Slovenia", relevant: true, hiring: true, confidence: "likely", reason: "Match", evidence: null }] }]);
  vi.mocked(startJob).mockImplementation(async (_definition, value) => {
    const { attemptId } = value as { attemptId: string };
    const a = attempts.find((a) => a.id === attemptId)!;
    a.queries = [`vision hiring ${a.country} ${a.round}`]; a.status = "PLANNED";
    return `job-${attemptId}`;
  });
  vi.mocked(apifyRequest).mockImplementation(async (_key, path, body) => {
    if (body !== undefined) return { data: { id: `run-${path}`, status: "READY" } };
    if (path.includes("/actor-runs/")) return { data: { id: "run", status: "SUCCEEDED", defaultDatasetId: "dataset" } };
    return [{ id: "123", url: "https://www.linkedin.com/posts/example", text: "Hiring vision engineers", author: { name: "Acme", type: "company" } }];
  });
});

describe("AI search coordinator", () => {
  it("completes every country round even after good results, with a single paid call per round", async () => {
    for (let i = 0; i < 30; i++) await tickCampaigns();
    expect(campaign.status).toBe("COMPLETE");
    expect(attempts.every((a) => a.status === "COMPLETE")).toBe(true);
    const starts = vi.mocked(apifyRequest).mock.calls.filter((call) => call[1].startsWith("/actors/"));
    expect(starts).toHaveLength(6);
    expect(starts.every((call) => call[1].includes("maxTotalChargeUsd=0.166666"))).toBe(true);
    expect(attempts.map((a) => a.country)).toEqual(["Turkey", "Slovenia", "Turkey", "Slovenia", "Turkey", "Slovenia"]);
    expect(stored).toHaveLength(1);
    expect(stored[0].occurrences).toHaveLength(6);
    expect(attempts[0].fresh).toBe(1);
    expect(attempts[1].duplicates).toBe(1);
  });
  it("queues AI work separately and returns without waiting for a model or scraper", async () => {
    await tickCampaigns();
    expect(startJob).toHaveBeenCalledOnce(); expect(apifyRequest).not.toHaveBeenCalled();
    attempts[0].status = "ANALYZING"; attempts[0].jobId = null;
    db.linkedInCampaignPost.count.mockResolvedValue(10);
    await tickCampaigns();
    expect(startJob).toHaveBeenLastCalledWith({ type: "evaluate" }, { attemptId: "attempt-0" }, expect.anything());
    expect(apifyRequest).not.toHaveBeenCalled();
  });
  it("never repeats a paid request after an uncertain network error", async () => {
    attempts[0].status = "PLANNED"; attempts[0].queries = ["vision hiring"];
    vi.mocked(apifyRequest).mockRejectedValue(new Error("offline"));
    await tickCampaigns(); await tickCampaigns();
    expect(attempts[0].status).toBe("UNKNOWN"); expect(campaign.status).toBe("FAILED");
    expect(apifyRequest).toHaveBeenCalledOnce();
  });
  it("cancels without starting pending rounds", async () => {
    campaign.status = "CANCELLING";
    await tickCampaigns();
    expect(campaign.status).toBe("CANCELLED"); expect(startJob).not.toHaveBeenCalled(); expect(apifyRequest).not.toHaveBeenCalled();
  });
  it("aborts an active run and keeps partial posts before finishing cancellation", async () => {
    campaign.status = "CANCELLING"; attempts[0].status = "SEARCHING"; attempts[0].runId = "known";
    vi.mocked(apifyRequest).mockReset();
    vi.mocked(apifyRequest).mockResolvedValueOnce({ data: { id: "known", status: "RUNNING" } })
      .mockResolvedValueOnce({ data: { id: "known", status: "ABORTING" } })
      .mockResolvedValueOnce({ data: { id: "known", status: "ABORTED", defaultDatasetId: "partial" } })
      .mockResolvedValueOnce([{ id: "123", url: "https://www.linkedin.com/posts/partial", text: "Hiring engineer" }]);
    await tickCampaigns();
    expect(campaign.status).toBe("CANCELLED"); expect(stored).toHaveLength(1);
    expect(apifyRequest).toHaveBeenNthCalledWith(2, "test-token", "/actor-runs/known/abort", {});
    expect(startJob).not.toHaveBeenCalled();
  });
  it("stops after an upstream credit/quota failure without trying later rounds", async () => {
    attempts[0].status = "PLANNED"; attempts[0].queries = ["vision hiring"];
    vi.mocked(apifyRequest).mockRejectedValue(new Error("quota"));
    await tickCampaigns(); await tickCampaigns();
    expect(campaign.status).toBe("FAILED");
    expect(attempts.slice(1).every((a) => a.status === "PENDING")).toBe(true);
    expect(apifyRequest).toHaveBeenCalledOnce();
  });
  it("resumes a known remote run by checking its ID, never by submitting again", async () => {
    attempts[0].status = "SEARCHING"; attempts[0].runId = "known";
    await tickCampaigns();
    expect(apifyRequest).toHaveBeenNthCalledWith(1, "test-token", "/actor-runs/known");
    expect(attempts[0].status).toBe("ANALYZING");
    expect(vi.mocked(apifyRequest).mock.calls.some((call) => call[2] !== undefined)).toBe(false);
  });
  it("continues to the next country after unassessed results without repeating the paid extraction", async () => {
    attempts[0].status = "ANALYZING"; attempts[0].jobId = "finished-evaluation"; attempts[0].fetched = 20; attempts[0].fresh = 20;
    db.linkedInCampaignPost.count.mockResolvedValue(0);
    db.linkedInCampaignPost.findMany.mockResolvedValue(Array.from({ length: 20 }, () => ({ assessments: [{ country: "Turkey", status: "unavailable", relevant: false, hiring: false, confidence: "uncertain", reason: "AI omitted this post", evidence: null }] })));
    await tickCampaigns();
    expect(attempts[0]).toMatchObject({ status: "COMPLETE", fetched: 20, relevant: 0 });
    await tickCampaigns();
    expect(startJob).toHaveBeenCalledWith({ type: "plan" }, { attemptId: "attempt-1" }, expect.anything());
    expect(apifyRequest).not.toHaveBeenCalled();
  });
  it("pauses running campaigns on restart without making an upstream request", async () => {
    await recoverCampaigns();
    expect(db.linkedInCampaign.updateMany).toHaveBeenCalledWith(expect.objectContaining({ where: { status: "RUNNING" }, data: expect.objectContaining({ status: "PAUSED" }) }));
    expect(apifyRequest).not.toHaveBeenCalled();
  });
});
