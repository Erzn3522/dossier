"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { action, ActionError } from "@/lib/action";
import { isEmailAddress } from "@/lib/application-email";
import { MISSING_APPLICATION_EMAIL } from "@/lib/automation/filter";
import { automationCandidateJobKey, prepareAutomationCandidateJob } from "@/lib/jobs/prepare-automation-candidate";
import { findLatestJob, retryJob, startJob } from "@/lib/jobs/runner";
import { GmailSendBlocked, markApplicationSent, sendApplicationEmail } from "@/lib/gmail/send-application";
import { GmailDeliveryUnknown, GmailNotConnected, GmailSendFailed } from "@/lib/gmail/client";
import { prisma } from "@/lib/prisma";

const idSchema = z.object({ applicationId: z.string().min(1) });
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
