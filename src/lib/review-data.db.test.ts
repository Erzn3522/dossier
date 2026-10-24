import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

import { MISSING_APPLICATION_EMAIL } from "@/lib/automation/filter";
import { DEFAULT_REVIEW_PARAMS } from "@/lib/review-list";
import { createTestClient, resetDatabase } from "@/test/db";

import { loadReviewCandidateDetails, loadReviewFilterOptions, loadReviewPage, loadReviewProgress } from "./review-data";

const db = vi.hoisted(() => ({ client: undefined as ReturnType<typeof createTestClient> | undefined }));
vi.mock("@/lib/prisma", async () => {
  const { createTestClient } = await import("@/test/db");
  db.client = createTestClient();
  return { prisma: db.client };
});

const prisma = () => db.client!;
const params = DEFAULT_REVIEW_PARAMS;

beforeEach(async () => resetDatabase(prisma()));
afterAll(() => prisma().$disconnect());

describe("review data", () => {
  it("filters and paginates in the database with a stable 50-row page", async () => {
    const search = await prisma().automatedSearch.create({ data: { name: "Daily", query: {} } });
    const run = await prisma().automationRun.create({ data: { searchId: search.id } });
    const createdAt = new Date("2026-10-19T12:00:00.000Z");
    await prisma().posting.createMany({
      data: Array.from({ length: 55 }, (_, index) => ({ id: `posting-${index + 1}`, source: "JSEARCH", externalId: `job-${index + 1}`, title: `Role ${index + 1}`, createdAt })),
    });
    await prisma().automationCandidate.createMany({
      data: Array.from({ length: 55 }, (_, index) => ({
        id: `candidate-${String(index + 1).padStart(2, "0")}`,
        runId: run.id,
        postingId: `posting-${index + 1}`,
        status: "FILTERED",
        reason: MISSING_APPLICATION_EMAIL,
        matchHit: index + 1,
        matchTotal: 100,
        matchPercent: index + 1,
        discoveredEmailCount: index === 54 ? 1 : 0,
        createdAt,
      })),
    });

    const second = await loadReviewPage({ ...params, page: 2 });
    expect(second).toMatchObject({ total: 55, filtered: 55, page: 2, pages: 2, pageSize: 50 });
    expect(second.items).toHaveLength(5);

    const low = await loadReviewPage({ ...params, matchBelow: 10, sort: "highest" });
    expect(low.filtered).toBe(9);
    expect(low.items.map((item) => item.score)).toEqual([9, 8, 7, 6, 5, 4, 3, 2, 1]);

    const found = await loadReviewPage({ ...params, email: "found" });
    expect(found.filtered).toBe(1);
    expect(found.items[0]?.id).toBe("candidate-55");
    const missing = await loadReviewPage({ ...params, email: "not-found" });
    expect(missing.filtered).toBe(54);
  });

  it("loads posting and email bodies only through the detail query", async () => {
    const search = await prisma().automatedSearch.create({ data: { name: "Daily", query: {} } });
    const run = await prisma().automationRun.create({ data: { searchId: search.id } });
    const application = await prisma().application.create({
      data: {
        reviewState: "PENDING_REVIEW",
        documents: { create: { kind: "EMAIL", units: [
          { id: "to", label: "Recipient", text: "jobs@example.com" },
          { id: "subject", label: "Subject", text: "Application" },
          { id: "body", label: "Message", text: "Hello" },
        ] } },
      },
    });
    const posting = await prisma().posting.create({ data: { source: "JSEARCH", externalId: "detail", description: "Long posting", applicationId: application.id } });
    const candidate = await prisma().automationCandidate.create({ data: { runId: run.id, postingId: posting.id, applicationId: application.id, status: "READY" } });

    const list = await loadReviewPage(params);
    expect(list.items[0]).not.toHaveProperty("postingText");
    expect(list.items[0]).not.toHaveProperty("body");
    expect(await loadReviewCandidateDetails(candidate.id)).toEqual({
      postingText: "Long posting",
      mandatory: [],
      email: { to: "jobs@example.com", subject: "Application", body: "Hello" },
    });
  });

  it("filters by status, work mode, source, profile and text, and counts statuses", async () => {
    const [daily, other] = await Promise.all([
      prisma().automatedSearch.create({ data: { name: "Berlin", query: {} } }),
      prisma().automatedSearch.create({ data: { name: "Paris", query: {} } }),
    ]);
    const [run, otherRun] = await Promise.all([daily, other].map((search) => prisma().automationRun.create({ data: { searchId: search.id } })));
    const rows = [
      { id: "a", source: "JSEARCH", company: "Bosch", title: "Vision Engineer", remote: true, status: "READY", run },
      { id: "b", source: "HIMALAYAS", company: "Zeiss", title: "ML Engineer", remote: false, status: "FILTERED", run },
      { id: "c", source: "JOBICY", company: "Acme", title: "Robotics", remote: null, status: "DISCOVERED", run: otherRun },
    ] as const;
    for (const row of rows) {
      const application = row.status === "READY" ? await prisma().application.create({ data: { reviewState: "PENDING_REVIEW" } }) : null;
      await prisma().posting.create({ data: { id: `p-${row.id}`, source: row.source, externalId: row.id, company: row.company, title: row.title, remote: row.remote, applicationId: application?.id } });
      await prisma().automationCandidate.create({ data: { id: row.id, runId: row.run.id, postingId: `p-${row.id}`, status: row.status, applicationId: application?.id, matchPercent: row.id === "a" ? 80 : 30 } });
    }
    const ids = async (override: Partial<typeof params>) => (await loadReviewPage({ ...params, sort: "company", ...override })).items.map((item) => item.id);

    expect(await ids({ status: "ready" })).toEqual(["a"]);
    expect(await ids({ status: "queued" })).toEqual(["c"]);
    expect(await ids({ remote: "remote" })).toEqual(["a"]);
    expect(await ids({ remote: "onsite" })).toEqual(["c", "b"]);
    expect(await ids({ source: "HIMALAYAS" })).toEqual(["b"]);
    expect(await ids({ searchId: otherRun.searchId })).toEqual(["c"]);
    expect(await ids({ q: "zeiss" })).toEqual(["b"]);
    expect(await ids({ matchAtLeast: 50 })).toEqual(["a"]);
    expect(await ids({})).toEqual(["c", "a", "b"]);
    const options = await loadReviewFilterOptions();
    expect(options.statusCounts).toEqual({ ready: 1, filtered: 1, queued: 1, failed: 0 });
    expect(options.sources.map((source) => source.value).sort()).toEqual(["HIMALAYAS", "JOBICY", "JSEARCH"]);
    expect(options.searches).toHaveLength(2);
  });

  it("reports progress only while candidates wait for the AI", async () => {
    expect(await loadReviewProgress()).toBeNull();
    const search = await prisma().automatedSearch.create({ data: { name: "Berlin", query: {} } });
    const run = await prisma().automationRun.create({
      data: { searchId: search.id, sourceStats: [{ source: "JSEARCH", found: 40, error: null }, { source: "REMOTE_OK", found: 5, error: null }] },
    });
    for (const [index, status] of (["FILTERED", "READY", "DISCOVERED", "ANALYZING"] as const).entries()) {
      await prisma().posting.create({ data: { id: `q${index}`, source: "JSEARCH", externalId: `q${index}` } });
      await prisma().automationCandidate.create({ data: { runId: run.id, postingId: `q${index}`, status } });
    }
    expect(await loadReviewProgress()).toMatchObject({ searching: false, profilesSearched: 1, profilesTotal: 1, scanned: 45, candidates: 4, analyzed: 2, analyzing: 1 });
    await prisma().automationRun.update({ where: { id: run.id }, data: { status: "COMPLETE" } });
    await prisma().automationCandidate.updateMany({ data: { status: "FILTERED" } });
    expect(await loadReviewProgress()).toBeNull();
  });
});
