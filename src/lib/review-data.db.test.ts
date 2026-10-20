import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

import { MISSING_APPLICATION_EMAIL } from "@/lib/automation/filter";
import { createTestClient, resetDatabase } from "@/test/db";

import { loadReviewCandidateDetails, loadReviewPage } from "./review-data";

const db = vi.hoisted(() => ({ client: undefined as ReturnType<typeof createTestClient> | undefined }));
vi.mock("@/lib/prisma", async () => {
  const { createTestClient } = await import("@/test/db");
  db.client = createTestClient();
  return { prisma: db.client };
});

const prisma = () => db.client!;
const params = { page: 1, matchBelow: null, email: "all" as const, sort: "queue" as const };

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
});

