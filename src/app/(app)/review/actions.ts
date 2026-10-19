"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { action, ActionError } from "@/lib/action";
import { isEmailAddress } from "@/lib/application-email";
import { MISSING_APPLICATION_EMAIL } from "@/lib/automation/filter";
import { emailDiscoveryConfigured } from "@/lib/email-discovery/searxng";
import { automationCandidateJobKey, prepareAutomationCandidateJob } from "@/lib/jobs/prepare-automation-candidate";
import { findLatestJob, retryJob, startJob } from "@/lib/jobs/runner";
import { GmailSendBlocked, markApplicationSent, sendApplicationEmail } from "@/lib/gmail/send-application";
import { GmailDeliveryUnknown, GmailNotConnected, GmailSendFailed } from "@/lib/gmail/client";
import { prisma } from "@/lib/prisma";

const idSchema = z.object({ applicationId: z.string().min(1) });
const candidateIdsSchema = z.object({ candidateIds: z.array(z.string().min(1)).min(1).max(500) });
const recipientSchema = z.object({
  candidateId: z.string().min(1),
  recipient: z.string().trim().refine(isEmailAddress, "Enter one valid email address."),
});
const refresh = () => revalidatePath("/", "layout");

export const provideAutomationRecipient = action(recipientSchema, async ({ candidateId, recipient }, { toast }) => {
  const updated = await prisma.automationCandidate.updateMany({
    where: {
      id: candidateId,
      applicationId: null,
      status: "FILTERED",
      reason: MISSING_APPLICATION_EMAIL,
    },
    data: {
      recipientOverride: recipient,
      status: "DISCOVERED",
      reason: null,
      error: null,
    },
  });
  if (!updated.count) throw new ActionError("This item no longer needs an application email address.");
  await startJob(prepareAutomationCandidateJob, { candidateId }, { key: automationCandidateJobKey(candidateId) });
  refresh();
  toast("Email address saved. Application preparation was queued.");
  return null;
});

export const searchForAutomationRecipient = action(z.object({ candidateId: z.string().min(1) }), async ({ candidateId }, { toast }) => {
  if (!emailDiscoveryConfigured()) throw new ActionError("Configure SearXNG in Settings → Automation first.");
  const updated = await prisma.automationCandidate.updateMany({
    where: {
      id: candidateId,
      applicationId: null,
      status: "FILTERED",
      reason: MISSING_APPLICATION_EMAIL,
    },
    data: { status: "DISCOVERED", reason: null, error: null },
  });
  if (!updated.count) throw new ActionError("This item no longer needs an application email address.");
  await startJob(prepareAutomationCandidateJob, { candidateId }, { key: automationCandidateJobKey(candidateId) });
  refresh();
  toast("Public email search queued.");
  return null;
});

export const dismissAutomationCandidate = action(z.object({ candidateId: z.string().min(1) }), async ({ candidateId }, { toast }) => {
  const candidate = await prisma.automationCandidate.findUnique({
    where: { id: candidateId },
    select: { postingId: true, applicationId: true },
  });
  if (!candidate || candidate.applicationId) throw new ActionError("That review item is no longer available.");
  await prisma.posting.update({ where: { id: candidate.postingId }, data: { dismissedAt: new Date() } });
  refresh();
  toast("Dismissed. This posting will not be prepared again.");
  return null;
});

export const dismissAutomationCandidates = action(candidateIdsSchema, async ({ candidateIds }, { toast }) => {
  const uniqueIds = [...new Set(candidateIds)];
  const dismissed = await prisma.$transaction(async (tx) => {
    const candidates = await tx.automationCandidate.findMany({
      where: {
        id: { in: uniqueIds },
        posting: { dismissedAt: null },
        OR: [
          { applicationId: null, status: { in: ["FILTERED", "FAILED"] } },
          { application: { reviewState: "PENDING_REVIEW" } },
        ],
      },
      select: { id: true, postingId: true, applicationId: true },
    });
    if (candidates.length === 0) throw new ActionError("Those review items are no longer available.");

    const prepared = candidates.filter((candidate) => candidate.applicationId !== null);
    if (prepared.length > 0) {
      await tx.automationCandidate.updateMany({
        where: { id: { in: prepared.map((candidate) => candidate.id) } },
        data: { applicationId: null, status: "FILTERED", reason: "Dismissed by you.", error: null },
      });
      await tx.posting.updateMany({
        where: { id: { in: prepared.map((candidate) => candidate.postingId) } },
        data: { applicationId: null, savedAt: null },
      });
      await tx.application.deleteMany({
        where: { id: { in: prepared.map((candidate) => candidate.applicationId!) } },
      });
    }

    await tx.posting.updateMany({
      where: { id: { in: candidates.map((candidate) => candidate.postingId) } },
      data: { dismissedAt: new Date() },
    });
    return candidates.length;
  });
  refresh();
  toast(`${dismissed} review ${dismissed === 1 ? "item" : "items"} dismissed.`);
  return { dismissed };
});

export const keepAutomationDraft = action(idSchema, async ({ applicationId }, { toast }) => {
  const result = await prisma.application.updateMany({ where: { id: applicationId, reviewState: "PENDING_REVIEW" }, data: { reviewState: "NORMAL" } });
  if (!result.count) throw new ActionError("That review item no longer exists.");
  refresh();
  toast("Moved to Applications as a draft.");
  return null;
});

export const dismissAutomationDraft = action(idSchema, async ({ applicationId }, { toast }) => {
  const application = await prisma.application.findUnique({ where: { id: applicationId }, include: { automationCandidate: true, posting: true } });
  if (!application?.automationCandidate) throw new ActionError("That review item no longer exists.");
  await prisma.$transaction(async (tx) => {
    await tx.automationCandidate.update({
      where: { id: application.automationCandidate!.id },
      data: { applicationId: null, status: "FILTERED", reason: "Dismissed by you.", error: null },
    });
    if (application.posting) {
      await tx.posting.update({ where: { id: application.posting.id }, data: { applicationId: null, savedAt: null, dismissedAt: new Date() } });
    }
    await tx.application.delete({ where: { id: applicationId } });
  });
  refresh();
  toast("Dismissed. This posting will not be prepared again.");
  return null;
});

export const retryAutomationCandidate = action(z.object({ candidateId: z.string().min(1) }), async ({ candidateId }, { toast }) => {
  const candidate = await prisma.automationCandidate.findUnique({ where: { id: candidateId }, select: { id: true, status: true } });
  if (!candidate || candidate.status !== "FAILED") throw new ActionError("That failed item is no longer available.");
  await prisma.automationCandidate.update({ where: { id: candidateId }, data: { status: "DISCOVERED", error: null } });
  const previous = await findLatestJob(automationCandidateJobKey(candidateId));
  if (!previous || !(await retryJob(previous.id))) {
    await startJob(prepareAutomationCandidateJob, { candidateId }, { key: automationCandidateJobKey(candidateId) });
  }
  refresh();
  toast("Retry queued.");
  return null;
});

export const approveAndSend = action(idSchema.extend({ retryUnknown: z.boolean().default(false) }), async ({ applicationId, retryUnknown }, { toast }) => {
  try {
    await sendApplicationEmail(applicationId, retryUnknown);
  } catch (error) {
    if (error instanceof GmailSendBlocked || error instanceof GmailDeliveryUnknown || error instanceof GmailNotConnected || error instanceof GmailSendFailed) {
      throw new ActionError(error.message);
    }
    throw error;
  }
  refresh();
  toast("Email sent with your resume and cover letter.");
  return null;
});

export const markAutomationSent = action(idSchema, async ({ applicationId }, { toast }) => {
  try {
    await markApplicationSent(applicationId);
  } catch (error) {
    if (error instanceof GmailSendBlocked) throw new ActionError(error.message);
    throw error;
  }
  refresh();
  toast("Marked as sent.");
  return null;
});
