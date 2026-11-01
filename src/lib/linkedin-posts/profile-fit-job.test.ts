import { beforeEach, describe, expect, it, vi } from "vitest";
import { AiError } from "@/lib/ai/errors";
import { assessProfileFit } from "./profile-fit-ai";
import { profileReviewJob } from "./profile-fit-job";
import { fitSnapshot, scopePosts } from "./profile-fit-store";
import { startJob } from "@/lib/jobs/runner";

const db = vi.hoisted(() => ({ linkedInProfileReview: { findUnique: vi.fn(), count: vi.fn(), updateMany: vi.fn() }, linkedInProfileFit: { findUnique: vi.fn(), upsert: vi.fn() } }));
vi.mock("@/lib/prisma", () => ({ prisma: db }));
vi.mock("@/lib/action", () => ({ ActionError: class ActionError extends Error {} }));
vi.mock("@/lib/ai", () => ({ createProvider: () => ({}) }));
vi.mock("@/lib/jobs/runner", () => ({ defineJob: (definition: unknown) => definition, startJob: vi.fn().mockResolvedValue("next-job") }));
vi.mock("./profile-fit-ai", async (original) => ({ ...await original<typeof import("./profile-fit-ai")>(), assessProfileFit: vi.fn() }));
vi.mock("./profile-fit-store", () => ({ fitSnapshot: vi.fn(), scopePosts: vi.fn(), activeDismissals: async () => new Set() }));
const post = { id: "123", url: "https://www.linkedin.com/posts/123", text: "Hiring Python engineer", author: { name: "Acme", type: "company" as const, url: null }, postedAt: null, likes: 0, commentsCount: 0, query: "python" };
const run = { id: "review", scope: "manual:search", profileHash: "current", status: "RUNNING", total: 1, processed: 0, jobId: null, error: null };
const result = { verdict: "suitable" as const, summary: "Meets requirements", requirements: [] };
beforeEach(() => {
  vi.clearAllMocks(); Object.assign(run, { profileHash: "current", status: "RUNNING", total: 1, processed: 0 });
  db.linkedInProfileReview.findUnique.mockImplementation(async () => ({ ...run }));
  db.linkedInProfileReview.count.mockImplementation(async () => run.status === "RUNNING" ? 1 : 0);
  db.linkedInProfileReview.updateMany.mockImplementation(async ({ data }) => { Object.assign(run, data); return { count: 1 }; });
  db.linkedInProfileFit.findUnique.mockResolvedValue(null);
  vi.mocked(scopePosts).mockResolvedValue([post]);
  vi.mocked(fitSnapshot).mockResolvedValue({ hash: "current", ready: true, profile: {}, config: { provider: "LOCAL", model: "ollama" } } as Awaited<ReturnType<typeof fitSnapshot>>);
  vi.mocked(assessProfileFit).mockResolvedValue(result);
});
const execute = () => profileReviewJob.run({ reviewId: "review" }, { signal: new AbortController().signal, step: vi.fn() });
describe("background profile matching", () => {
  it("persists matches and completes without making an Apify request", async () => {
    await execute();
    expect(db.linkedInProfileFit.upsert).toHaveBeenCalledWith(expect.objectContaining({ create: expect.objectContaining({ result, provider: "LOCAL", verdict: "suitable" }) }));
    expect(run).toMatchObject({ status: "COMPLETE", processed: 1 });
  });
  it("reuses a current cached match without calling AI again", async () => {
    db.linkedInProfileFit.findUnique.mockResolvedValue({ result });
    await execute();
    expect(assessProfileFit).not.toHaveBeenCalled(); expect(run.processed).toBe(1);
  });
  it("does not apply an old profile after it changes", async () => {
    vi.mocked(fitSnapshot).mockResolvedValue({ hash: "changed" } as Awaited<ReturnType<typeof fitSnapshot>>);
    await execute();
    expect(run.status).toBe("STALE"); expect(assessProfileFit).not.toHaveBeenCalled(); expect(db.linkedInProfileFit.upsert).not.toHaveBeenCalled();
  });
  it("keeps AI failures unassessed and continues with the next post in a separate queued job", async () => {
    run.total = 20;
    vi.mocked(assessProfileFit).mockRejectedValue(AiError.of("invalid-output"));
    await execute();
    expect(db.linkedInProfileFit.upsert).toHaveBeenCalledWith(expect.objectContaining({ create: expect.objectContaining({ verdict: "unavailable" }) }));
    expect(run).toMatchObject({ status: "RUNNING", processed: 1 });
    expect(startJob).toHaveBeenCalledOnce();
    expect(scopePosts).toHaveBeenCalledWith({ kind: "manual", id: "search" }, 0, 1);
  });
  it("never writes a match after cancellation during AI work", async () => {
    const controller = new AbortController();
    vi.mocked(assessProfileFit).mockImplementation(async () => { run.status = "CANCELLED"; controller.abort(); throw AiError.of("cancelled"); });
    await expect(profileReviewJob.run({ reviewId: "review" }, { signal: controller.signal, step: vi.fn() })).rejects.toMatchObject({ kind: "cancelled" });
    expect(db.linkedInProfileFit.upsert).not.toHaveBeenCalled(); expect(startJob).not.toHaveBeenCalled();
  });
});
