import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { createTestClient, resetDatabase } from "@/test/db";

import { AUTOMATION_PROFILE_SPECS } from "./profile-plan";
import { resetJobAutomation } from "./reset";

const db = createTestClient();
beforeEach(() => resetDatabase(db));
afterAll(() => db.$disconnect());

const posting = (externalId: string, extra = {}) => db.posting.create({ data: { source: "JSEARCH", externalId, title: externalId, ...extra } });

describe("resetJobAutomation", () => {
  it("replaces automation data with the 35 planned profiles and keeps manual work", async () => {
    const old = await db.automatedSearch.create({ data: { name: "Old", query: {}, pagesPerRun: 1 } });
    const run = await db.automationRun.create({ data: { searchId: old.id } });
    const [stale, saved, applied] = await Promise.all([posting("stale"), posting("saved", { savedAt: new Date() }), posting("applied")]);
    const application = await db.application.create({ data: { title: "Kept" } });
    await db.posting.update({ where: { id: applied.id }, data: { applicationId: application.id } });
    const candidates = await Promise.all([stale, saved, applied].map(({ id }) => db.automationCandidate.create({ data: { runId: run.id, postingId: id } })));
    await db.job.create({ data: { type: "prepare-automation-candidate", status: "QUEUED", input: { candidateId: candidates[0].id } } });
    await db.postingSearch.create({ data: { source: "JSEARCH", query: {}, postings: [], found: 0 } });
    await db.setting.create({ data: { key: "automationEnabled", value: "false" } });

    const result = await resetJobAutomation(db, new Date("2026-10-24T04:34:28.911Z"));

    const profiles = await db.automatedSearch.findMany();
    expect(result.profiles).toBe(35);
    expect(profiles).toHaveLength(35);
    expect(profiles.every((profile) => profile.enabled && profile.pagesPerRun === 3 && (profile.query as { postedWithin: string }).postedWithin === "week")).toBe(true);
    expect(profiles.filter((profile) => !(profile.query as { remoteOnly: boolean }).remoteOnly)).toHaveLength(4);
    expect(await db.automationRun.count()).toBe(0);
    expect(await db.automationCandidate.count()).toBe(0);
    expect(await db.job.count()).toBe(0);
    expect(await db.posting.findMany({ select: { externalId: true }, orderBy: { externalId: "asc" } })).toEqual([{ externalId: "applied" }, { externalId: "saved" }]);
    expect(await db.application.count()).toBe(1);
    expect(await db.postingSearch.count()).toBe(1);
    const settings = Object.fromEntries((await db.setting.findMany()).map(({ key, value }) => [key, value]));
    expect(settings).toMatchObject({ automationEnabled: "true", automationTimeZone: "Europe/Ljubljana", automationTime: "06:37", automationProblem: "" });
  });

  it("is repeatable", async () => {
    await resetJobAutomation(db);
    await resetJobAutomation(db);
    expect(await db.automatedSearch.count()).toBe(AUTOMATION_PROFILE_SPECS.length);
  });

  it("refuses to run while other AI jobs are active, leaving automation off", async () => {
    await db.job.create({ data: { type: "extract-posting", status: "RUNNING", input: {} } });
    await expect(resetJobAutomation(db)).rejects.toThrow(/still queued\/running/);
    expect(await db.automatedSearch.count()).toBe(0);
    expect((await db.setting.findUnique({ where: { key: "automationEnabled" } }))?.value).toBe("false");
  });
});
