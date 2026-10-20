import { revalidatePath } from "next/cache";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

import { MISSING_APPLICATION_EMAIL } from "@/lib/automation/filter";
import { createTestClient, resetDatabase } from "@/test/db";

import { dismissAutomationCandidates, markAutomationAppliedManually, searchForAutomationRecipients } from "./actions";

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
    expect(revalidatePath).toHaveBeenCalledWith("/review");
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
        discoveredEmailCount: 1,
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

describe("markAutomationAppliedManually", () => {
  const setup = async () => {
    const search = await prisma().automatedSearch.create({ data: { name: "Daily", query: {} } });
    return prisma().automationRun.create({ data: { searchId: search.id } });
  };

  it("makes a sent application from a filtered posting, so Applications and the dashboard count it", async () => {
    const run = await setup();
    const posting = await prisma().posting.create({ data: {
      source: "JSEARCH", externalId: "manual", title: "Vision Engineer", company: "Vision Co", place: "Ljubljana",
      remote: true, salary: "€60k", url: "https://jobs.example/vision", description: "Build inspection systems.",
    } });
    const candidate = await prisma().automationCandidate.create({
      data: { runId: run.id, postingId: posting.id, status: "FILTERED", reason: MISSING_APPLICATION_EMAIL },
    });

    const result = await markAutomationAppliedManually({ candidateId: candidate.id });

    expect(result).toMatchObject({ ok: true });
    const updated = await prisma().automationCandidate.findUniqueOrThrow({ where: { id: candidate.id }, include: { application: { include: { events: true } } } });
    expect(updated.status).toBe("SENT");
    expect(updated.application).toMatchObject({
      title: "Vision Engineer · Vision Co", company: "Vision Co", role: "Vision Engineer", location: "Ljubljana", mode: "Remote",
      postingUrl: "https://jobs.example/vision", status: "SENT", reviewState: "NORMAL", furthestStage: "SENT", sentAt: expect.any(Date),
    });
    expect(updated.application!.events.map((event) => [event.from, event.to])).toEqual([["DRAFT", "SENT"]]);
    expect(await prisma().posting.findUniqueOrThrow({ where: { id: posting.id } })).toMatchObject({ applicationId: updated.applicationId, savedAt: expect.any(Date) });
  });

  it("keeps a prepared draft's documents and moves it out of Review as sent", async () => {
    const run = await setup();
    const draft = await prisma().application.create({ data: { title: "Prepared", reviewState: "PENDING_REVIEW" } });
    const posting = await prisma().posting.create({ data: { source: "JSEARCH", externalId: "prepared", applicationId: draft.id } });
    const candidate = await prisma().automationCandidate.create({ data: { runId: run.id, postingId: posting.id, applicationId: draft.id, status: "READY" } });

    expect(await markAutomationAppliedManually({ candidateId: candidate.id })).toMatchObject({ ok: true, data: { applicationId: draft.id } });
    expect(await prisma().application.findUniqueOrThrow({ where: { id: draft.id } })).toMatchObject({ status: "SENT", reviewState: "NORMAL" });
    expect(await prisma().automationCandidate.findUniqueOrThrow({ where: { id: candidate.id } })).toMatchObject({ status: "SENT" });
  });

  it("refuses a draft Dossier already tried to send, and an item still being prepared", async () => {
    const run = await setup();
    const draft = await prisma().application.create({ data: { title: "Tried", reviewState: "PENDING_REVIEW", emailDelivery: { create: { status: "UNKNOWN", recipient: "jobs@example.com", subject: "Hi" } } } });
    const tried = await prisma().automationCandidate.create({ data: { runId: run.id, postingId: (await prisma().posting.create({ data: { source: "JSEARCH", externalId: "tried", applicationId: draft.id } })).id, applicationId: draft.id, status: "READY" } });
    const busy = await prisma().automationCandidate.create({ data: { runId: run.id, postingId: (await prisma().posting.create({ data: { source: "JSEARCH", externalId: "busy" } })).id, status: "PREPARING" } });

    expect(await markAutomationAppliedManually({ candidateId: tried.id })).toMatchObject({ ok: false });
    expect(await markAutomationAppliedManually({ candidateId: busy.id })).toMatchObject({ ok: false });
    expect(await prisma().application.count({ where: { status: "SENT" } })).toBe(0);
  });
});
