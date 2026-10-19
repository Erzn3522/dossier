import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

import { createTestClient, resetDatabase } from "@/test/db";

import { dismissAutomationCandidates } from "./actions";

const db = vi.hoisted(() => ({ client: undefined as ReturnType<typeof createTestClient> | undefined }));
vi.mock("@/lib/prisma", async () => {
  const { createTestClient } = await import("@/test/db");
  db.client = createTestClient();
  return { prisma: db.client };
});
vi.mock("@/lib/auth/session", () => ({
  getSession: async () => ({ persistent: false, issuedAt: new Date(), expiresAt: new Date(Date.now() + 60_000) }),
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

const prisma = () => db.client!;

beforeEach(() => resetDatabase(prisma()));
afterAll(() => prisma().$disconnect());

describe("dismissAutomationCandidates", () => {
  it("dismisses filtered candidates and deletes selected prepared drafts in one action", async () => {
    const search = await prisma().automatedSearch.create({ data: { name: "Daily", query: {} } });
    const run = await prisma().automationRun.create({ data: { searchId: search.id } });
    const filteredPosting = await prisma().posting.create({ data: { source: "JSEARCH", externalId: "filtered" } });
    const filtered = await prisma().automationCandidate.create({
      data: { runId: run.id, postingId: filteredPosting.id, status: "FILTERED", matchHit: 4, matchTotal: 10 },
    });

    const draft = await prisma().application.create({ data: { title: "Prepared draft", reviewState: "PENDING_REVIEW" } });
    const preparedPosting = await prisma().posting.create({
      data: { source: "JSEARCH", externalId: "prepared", applicationId: draft.id, savedAt: new Date() },
    });
    const prepared = await prisma().automationCandidate.create({
      data: { runId: run.id, postingId: preparedPosting.id, applicationId: draft.id, status: "READY", matchHit: 6, matchTotal: 10 },
    });

    const result = await dismissAutomationCandidates({ candidateIds: [filtered.id, prepared.id, filtered.id] });

    expect(result).toMatchObject({ ok: true, data: { dismissed: 2 }, toast: "2 review items dismissed." });
    expect(await prisma().posting.findUniqueOrThrow({ where: { id: filteredPosting.id } })).toMatchObject({ dismissedAt: expect.any(Date) });
    expect(await prisma().posting.findUniqueOrThrow({ where: { id: preparedPosting.id } })).toMatchObject({
      applicationId: null,
      savedAt: null,
      dismissedAt: expect.any(Date),
    });
    expect(await prisma().application.findUnique({ where: { id: draft.id } })).toBeNull();
    expect(await prisma().automationCandidate.findUniqueOrThrow({ where: { id: prepared.id } })).toMatchObject({
      applicationId: null,
      status: "FILTERED",
      reason: "Dismissed by you.",
    });
  });
});
