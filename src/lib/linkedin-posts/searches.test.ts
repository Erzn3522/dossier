import { beforeEach, describe, expect, it, vi } from "vitest";
import { actorInput, apifyRequest } from "./apify";
import { cancelPostSearch, refreshPostSearch, startPostSearch } from "./searches";

const db = vi.hoisted(() => ({
  linkedInPostSearch: { findUnique: vi.fn(), findFirst: vi.fn(), create: vi.fn(), update: vi.fn() },
  linkedInCampaign: { count: vi.fn().mockResolvedValue(0) },
  $transaction: vi.fn(), $executeRaw: vi.fn(),
}));
vi.mock("@/lib/prisma", () => ({ prisma: db }));
vi.mock("@/lib/action", () => ({ ActionError: class ActionError extends Error {} }));
vi.mock("@/lib/settings-data", () => ({ loadSettings: async () => ({ apifyKeyEnc: "encrypted" }) }));
vi.mock("@/lib/secrets", () => ({ APIFY_API_KEY: {}, decryptSecret: () => "token", secretState: () => "set" }));
vi.mock("./apify", async (original) => ({ ...await original<typeof import("./apify")>(), apifyRequest: vi.fn() }));
const query = { keywords: ["hiring engineer"], authors: [], postedWithin: "month" as const, since: "", maxPosts: 25 };
const row = { id: "search", query, posts: [], runId: "run", status: "RUNNING", error: null, createdAt: new Date(), updatedAt: new Date() };
beforeEach(() => {
  vi.clearAllMocks();
  db.$transaction.mockImplementation((fn) => fn(db));
  db.linkedInPostSearch.findUnique.mockResolvedValue(row);
  db.linkedInPostSearch.findFirst.mockResolvedValue(null);
  db.linkedInPostSearch.create.mockResolvedValue({ ...row, runId: null, status: "STARTING" });
  db.linkedInPostSearch.update.mockImplementation(({ data }) => Promise.resolve({ ...row, ...data }));
});

describe("LinkedIn search lifecycle", () => {
  it("creates exactly one bounded paid run and saves its run id", async () => {
    vi.mocked(apifyRequest).mockResolvedValue({ data: { id: "new-run", status: "READY" } });
    const result = await startPostSearch(query);
    expect(result).toMatchObject({ id: "search", status: "RUNNING" });
    expect(apifyRequest).toHaveBeenCalledExactlyOnceWith("token", expect.stringContaining("maxTotalChargeUsd=1"), actorInput(query));
    expect(db.linkedInPostSearch.update).toHaveBeenCalledWith({ where: { id: "search" }, data: { runId: "new-run", status: "RUNNING" } });
    expect(db.$executeRaw).toHaveBeenCalledTimes(1);
  });
  it("refuses a second active search before calling Apify", async () => {
    db.linkedInPostSearch.findFirst.mockResolvedValue(row);
    await expect(startPostSearch(query)).rejects.toThrow("already running");
    expect(apifyRequest).not.toHaveBeenCalled();
    expect(db.linkedInPostSearch.create).not.toHaveBeenCalled();
  });
  it("keeps failed starts in history instead of retrying", async () => {
    vi.mocked(apifyRequest).mockRejectedValue(new Error("network"));
    await expect(startPostSearch(query)).rejects.toThrow("network");
    expect(db.linkedInPostSearch.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: "FAILED" }) }));
    expect(apifyRequest).toHaveBeenCalledTimes(1);
  });
  it("does not call Apify when reopening a completed search", async () => {
    db.linkedInPostSearch.findUnique.mockResolvedValue({ ...row, status: "SUCCEEDED" });
    expect((await refreshPostSearch("search")).status).toBe("SUCCEEDED");
    expect(apifyRequest).not.toHaveBeenCalled();
  });
  it("checks the saved run and fetches results only after completion", async () => {
    vi.mocked(apifyRequest).mockResolvedValueOnce({ data: { id: "run", status: "RUNNING" } });
    expect((await refreshPostSearch("search")).status).toBe("RUNNING");
    expect(apifyRequest).toHaveBeenCalledTimes(1);
    vi.mocked(apifyRequest).mockResolvedValueOnce({ data: { id: "run", status: "SUCCEEDED", defaultDatasetId: "dataset" } }).mockResolvedValueOnce([]);
    expect((await refreshPostSearch("search")).status).toBe("SUCCEEDED");
    expect(apifyRequest).toHaveBeenLastCalledWith("token", "/datasets/dataset/items?format=json&clean=true&limit=200");
  });
  it("marks an interrupted start as failed so it cannot block searches forever", async () => {
    db.linkedInPostSearch.findUnique.mockResolvedValue({ ...row, runId: null, status: "STARTING", createdAt: new Date(Date.now() - 120_000) });
    expect((await refreshPostSearch("search")).status).toBe("FAILED");
    expect(apifyRequest).not.toHaveBeenCalled();
  });
  it("aborts only the saved run, then checks its status", async () => {
    vi.mocked(apifyRequest).mockResolvedValueOnce({}).mockResolvedValueOnce({ data: { id: "run", status: "ABORTED", defaultDatasetId: "dataset" } }).mockResolvedValueOnce([]);
    expect((await cancelPostSearch("search")).status).toBe("ABORTED");
    expect(apifyRequest).toHaveBeenNthCalledWith(1, "token", "/actor-runs/run/abort", {});
  });
  it("does not convert a temporary polling outage into a failed run", async () => {
    vi.mocked(apifyRequest).mockRejectedValue(new Error("offline"));
    await expect(refreshPostSearch("search")).rejects.toThrow("offline");
    expect(db.linkedInPostSearch.update).not.toHaveBeenCalled();
  });
});
