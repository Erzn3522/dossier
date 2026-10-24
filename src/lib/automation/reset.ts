import type { Prisma, PrismaClient } from "@/generated/prisma/client";

import { AUTOMATION_PROFILE_SPECS, installationSchedule } from "./profile-plan";

const setting = (tx: Pick<PrismaClient, "setting">, key: string, value: string) =>
  tx.setting.upsert({ where: { key }, create: { key, value }, update: { value } });

/**
 * Replaces every automation profile, run and Review candidate with the planned
 * profiles and turns the daily run on. Manual searches, saved or dismissed
 * postings and prepared applications are kept.
 */
export async function resetJobAutomation(db: PrismaClient, now = new Date()) {
  // Make a concurrently running app harmless before checking or replacing profiles.
  await setting(db, "automationEnabled", "false");
  const otherAiJobs = await db.job.count({
    where: { status: { in: ["QUEUED", "RUNNING"] }, type: { not: "prepare-automation-candidate" } },
  });
  if (otherAiJobs > 0) {
    throw new Error(`${otherAiJobs} non-automation background job(s) are still queued/running. Let them finish, then run this script again.`);
  }

  const schedule = installationSchedule(now);
  await db.$transaction(async (tx) => {
    const candidatePostings = await tx.automationCandidate.findMany({ select: { postingId: true } });
    await tx.job.deleteMany({ where: { type: "prepare-automation-candidate" } });
    await tx.automatedSearch.deleteMany(); // cascades runs and Review candidates only
    if (candidatePostings.length > 0) {
      await tx.posting.deleteMany({
        where: {
          id: { in: candidatePostings.map(({ postingId }) => postingId) },
          savedAt: null, dismissedAt: null, applicationId: null, automationCandidate: null,
        },
      });
    }
    await tx.automatedSearch.createMany({
      data: AUTOMATION_PROFILE_SPECS.map((profile) => ({ ...profile, query: profile.query as Prisma.InputJsonValue })),
    });
    await setting(tx, "automationTime", schedule.time);
    await setting(tx, "automationTimeZone", schedule.timeZone);
    await setting(tx, "automationProblem", "");
    await setting(tx, "automationEnabled", "true");
  });
  return { profiles: AUTOMATION_PROFILE_SPECS.length, ...schedule };
}
