import "server-only";

import { ApplicationStatus, EmailDeliveryStatus } from "@/generated/prisma/enums";
import { emailAddresses, emailParts } from "@/lib/application-email";
import { unitsSchema } from "@/lib/application-data";
import { resolveFileName } from "@/lib/file-name";
import { renderPdf } from "@/lib/pdf/render";
import { prisma } from "@/lib/prisma";
import { loadProfileName } from "@/lib/profile-data";
import { loadSettings } from "@/lib/settings-data";
import { applyStatusChange } from "@/lib/status-changes";

import { buildMime, gmailConnection, GmailDeliveryUnknown, sendRawMessage } from "./client";

export class GmailSendBlocked extends Error {}

export async function sendApplicationEmail(applicationId: string, allowUnknownRetry = false): Promise<{ messageId: string }> {
  const application = await prisma.application.findUnique({
    where: { id: applicationId },
    include: { documents: true, emailDelivery: true },
  });
  if (!application) throw new GmailSendBlocked("That application no longer exists.");
  const emailDocument = application.documents.find((document) => document.kind === "EMAIL");
  const parsed = unitsSchema.safeParse(emailDocument?.units);
  if (!parsed.success) throw new GmailSendBlocked("Review and save the email before sending.");
  const parts = emailParts(parsed.data);
  const recipients = emailAddresses(parts.to);
  if (recipients.length !== 1 || !parts.subject.trim() || !parts.body.trim()) {
    throw new GmailSendBlocked("The email needs one valid recipient, a subject and a message.");
  }

  await prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT 1 FROM "Application" WHERE id = ${applicationId} FOR UPDATE`;
    const delivery = await tx.emailDelivery.findUnique({ where: { applicationId } });
    if (delivery?.status === EmailDeliveryStatus.SENT) throw new GmailSendBlocked("This email has already been sent.");
    if (delivery?.status === EmailDeliveryStatus.SENDING) throw new GmailSendBlocked("This email is already being sent.");
    if (delivery?.status === EmailDeliveryStatus.UNKNOWN && !allowUnknownRetry) {
      throw new GmailSendBlocked("Gmail did not confirm the previous attempt. Check Sent before choosing Retry.");
    }
    await tx.emailDelivery.upsert({
      where: { applicationId },
      create: { applicationId, status: EmailDeliveryStatus.SENDING, recipient: recipients[0], subject: parts.subject.trim() },
      update: {
        status: EmailDeliveryStatus.SENDING,
        recipient: recipients[0],
        subject: parts.subject.trim(),
        error: null,
        gmailMessageId: null,
        attemptedAt: new Date(),
        sentAt: null,
      },
    });
  });

  try {
    const [connection, settings, name, resume, letter] = await Promise.all([
      gmailConnection(),
      loadSettings(),
      loadProfileName(),
      renderPdf(`/print/resume/${applicationId}`),
      renderPdf(`/print/letter/${applicationId}`),
    ]);
    const now = new Date();
    const attachment = (doc: "RESUME" | "COVER_LETTER", content: Uint8Array) => ({
      filename: resolveFileName(settings.fileNamePattern, { name, company: application.company, role: application.role, doc, date: now }),
      content,
      contentType: "application/pdf" as const,
    });
    const raw = await buildMime({
      from: connection.email,
      to: recipients,
      subject: parts.subject.trim(),
      body: parts.body,
      attachments: [attachment("RESUME", resume), attachment("COVER_LETTER", letter)],
    });
    const sent = await sendRawMessage(raw);
    const sentAt = new Date();
    await prisma.emailDelivery.update({
      where: { applicationId },
      data: { status: EmailDeliveryStatus.SENT, gmailMessageId: sent.id, sentAt, error: null },
    });
    await applyStatusChange(prisma, applicationId, ApplicationStatus.SENT, sentAt);
    await prisma.$transaction([
      prisma.application.update({ where: { id: applicationId }, data: { reviewState: "NORMAL" } }),
      prisma.automationCandidate.updateMany({ where: { applicationId }, data: { status: "SENT", error: null } }),
    ]);
    return { messageId: sent.id };
  } catch (error) {
    const unknown = error instanceof GmailDeliveryUnknown;
    const message = error instanceof Error ? error.message.slice(0, 500) : "Gmail could not send this email.";
    await prisma.emailDelivery.updateMany({
      where: { applicationId, status: EmailDeliveryStatus.SENDING },
      data: { status: unknown ? EmailDeliveryStatus.UNKNOWN : EmailDeliveryStatus.FAILED, error: message },
    });
    throw error;
  }
}

export async function markApplicationSent(applicationId: string): Promise<void> {
  const delivery = await prisma.emailDelivery.findUnique({ where: { applicationId } });
  if (delivery?.status !== EmailDeliveryStatus.UNKNOWN) throw new GmailSendBlocked("Only an unconfirmed delivery can be marked sent.");
  const sentAt = new Date();
  await prisma.emailDelivery.update({ where: { applicationId }, data: { status: EmailDeliveryStatus.SENT, sentAt, error: null } });
  await applyStatusChange(prisma, applicationId, ApplicationStatus.SENT, sentAt);
  await prisma.$transaction([
    prisma.application.update({ where: { id: applicationId }, data: { reviewState: "NORMAL" } }),
    prisma.automationCandidate.updateMany({ where: { applicationId }, data: { status: "SENT", error: null } }),
  ]);
}
