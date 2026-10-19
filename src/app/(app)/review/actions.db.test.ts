import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

import { MISSING_APPLICATION_EMAIL } from "@/lib/automation/filter";
import { createTestClient, resetDatabase } from "@/test/db";

import { dismissAutomationCandidates, searchForAutomationRecipients } from "./actions";

const db = vi.hoisted(() => ({ client: undefined as ReturnType<typeof createTestClient> | undefined }));
const jobs = vi.hoisted(() => ({ start: vi.fn(async () => "job-1") }));
vi.mock("@/lib/prisma", async () => {
  const { createTestClient } = await import("@/test/db");
  db.client = createTestClient();
  return { prisma: db.client };
});
vi.mock("@/lib/auth/session", () => ({
  getSession: async () => ({ persistent: false, issuedAt: new Date(), expiresAt: new Date(Date.now() + 60_000) }),
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/email-discovery/searxng", () => ({ emailDiscoveryConfigured: () => true }));
vi.mock("@/lib/jobs/prepare-automation-candidate", () => ({
  automationCandidateJobKey: (candidateId: string) => `automation-candidate:${candidateId}`,
  prepareAutomationCandidateJob: { type: "prepare-automation-candidate" },
}));
vi.mock("@/lib/jobs/runner", () => ({
  findLatestJob: vi.fn(),
  retryJob: vi.fn(),
  startJob: jobs.start,
}));

const prisma = () => db.client!;

beforeEach(async () => {
  vi.clearAllMocks();
  await resetDatabase(prisma());
});
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

describe("searchForAutomationRecipients", () => {
  it("queues only selected candidates that do not already have a discovered email", async () => {
    const search = await prisma().automatedSearch.create({ data: { name: "Daily", query: {} } });
    const run = await prisma().automationRun.create({ data: { searchId: search.id } });
    const missingPosting = await prisma().posting.create({ data: { source: "JSEARCH", externalId: "missing-email" } });
    const foundPosting = await prisma().posting.create({ data: { source: "JSEARCH", externalId: "found-email" } });
    const missing = await prisma().automationCandidate.create({
      data: { runId: run.id, postingId: missingPosting.id, status: "FILTERED", reason: MISSING_APPLICATION_EMAIL },
    });
    const found = await prisma().automationCandidate.create({
      data: {
        runId: run.id,
        postingId: foundPosting.id,
        status: "FILTERED",
        reason: MISSING_APPLICATION_EMAIL,
        emailDiscovery: {
          searchedAt: "2026-10-19T10:00:00.000Z",
          queryCount: 3,
          pagesRead: 1,
          rankedWith: "rank-application-emails@1",
          candidates: [{
            email: "jobs@example.com",
            sourceUrl: "https://example.com/careers",
            sourceTitle: "Careers",
            context: "Apply at jobs@example.com",
            confidence: "HIGH",
            reason: "The official careers page names it.",
          }],
          error: null,
        },
      },
    });

    const result = await searchForAutomationRecipients({ candidateIds: [missing.id, found.id] });

    expect(result).toMatchObject({ ok: true, data: { queued: 1, skipped: 1 }, toast: "1 email search queued." });
    expect(jobs.start).toHaveBeenCalledTimes(1);
    expect(jobs.start).toHaveBeenCalledWith(expect.anything(), { candidateId: missing.id }, { key: `automation-candidate:${missing.id}` });
    expect(await prisma().automationCandidate.findUniqueOrThrow({ where: { id: missing.id } })).toMatchObject({ status: "DISCOVERED", reason: null });
    expect(await prisma().automationCandidate.findUniqueOrThrow({ where: { id: found.id } })).toMatchObject({ status: "FILTERED", reason: MISSING_APPLICATION_EMAIL });
  });
});
