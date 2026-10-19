import "server-only";

import { DocumentKind, OutreachDeliveryStatus, OutreachLeadStatus } from "@/generated/prisma/enums";
import { unitsSchema } from "@/lib/application-data";
import { dayBoundsIn } from "@/lib/automation/schedule";
import { resolveFileName } from "@/lib/file-name";
import { buildMime, gmailConnection, GmailDeliveryUnknown, sendRawMessage } from "@/lib/gmail/client";
import { renderPdf } from "@/lib/pdf/render";
import { prisma } from "@/lib/prisma";
import { loadProfileName } from "@/lib/profile-data";
import { loadSettings } from "@/lib/settings-data";

export class OutreachSendBlocked extends Error {}

export async function sendOutreachEmail(leadId: string, allowUnknownRetry = false): Promise<{ messageId: string }> {
  const lead = await prisma.outreachLead.findUnique({ where: { id: leadId }, include: { delivery: true, campaign: true } });
  if (!lead) throw new OutreachSendBlocked("That outreach lead no longer exists.");
  if (!lead.selectedEmail || !lead.emailSubject?.trim() || !lead.emailBody?.trim() || !unitsSchema.safeParse(lead.resumeUnits).success) {
    throw new OutreachSendBlocked("Review and save the recipient, email and tailored CV before sending.");
  }
  const recipient = lead.selectedEmail.toLowerCase();
  const settings = await loadSettings();
  if (!settings.outreachEnabled || !settings.outreachAcknowledged) throw new OutreachSendBlocked("Outreach is disabled.");

  await prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT 1 FROM "OutreachLead" WHERE id = ${leadId} FOR UPDATE`;
    const current = await tx.outreachLead.findUnique({ where: { id: leadId }, include: { delivery: true } });
    if (!current) throw new OutreachSendBlocked("That outreach lead no longer exists.");
    if (current.delivery?.status === OutreachDeliveryStatus.SENT || current.status === OutreachLeadStatus.SENT) {
      throw new OutreachSendBlocked("This company has already been contacted.");
    }
    if (current.delivery?.status === OutreachDeliveryStatus.SENDING || current.status === OutreachLeadStatus.SENDING) {
      throw new OutreachSendBlocked("This email is already being sent.");
    }
    if (current.delivery?.status === OutreachDeliveryStatus.UNKNOWN && !allowUnknownRetry) {
      throw new OutreachSendBlocked("Gmail did not confirm the previous attempt. Check Sent before choosing Retry.");
    }
    if (!new Set<OutreachLeadStatus>([OutreachLeadStatus.QUEUED, OutreachLeadStatus.UNKNOWN]).has(current.status)) {
      throw new OutreachSendBlocked("Approve this lead and wait for its sending window first.");
    }
    const suppression = await tx.outreachSuppression.findFirst({ where: { value: { in: [current.domain, recipient] } } });
    if (suppression) throw new OutreachSendBlocked("This recipient or company is on the suppression list.");
    const { start, end } = dayBoundsIn(new Date(), settings.outreachTimeZone);
    const sentToday = await tx.outreachDelivery.count({ where: { status: OutreachDeliveryStatus.SENT, sentAt: { gte: start, lt: end } } });
    if (sentToday >= settings.outreachDailySendLimit) throw new OutreachSendBlocked("Today's cold email limit has been reached.");
    await tx.outreachDelivery.upsert({
      where: { leadId },
      create: { leadId, status: OutreachDeliveryStatus.SENDING, recipient, subject: current.emailSubject!.trim() },
      update: { status: OutreachDeliveryStatus.SENDING, recipient, subject: current.emailSubject!.trim(), error: null, gmailMessageId: null, attemptedAt: new Date(), sentAt: null },
    });
    await tx.outreachLead.update({ where: { id: leadId }, data: { status: OutreachLeadStatus.SENDING } });
  });

  let gmailAccepted = false;
  try {
    const [connection, name, pdf] = await Promise.all([gmailConnection(), loadProfileName(), renderPdf(`/print/outreach-resume/${leadId}`)]);
    const raw = await buildMime({
      from: connection.email,
      to: [recipient],
      subject: lead.emailSubject.trim(),
      body: lead.emailBody.trim(),
      attachments: [{
        filename: resolveFileName(settings.fileNamePattern, { name, company: lead.companyName, role: lead.campaign.targetRole, doc: DocumentKind.RESUME, date: new Date() }),
        content: pdf,
        contentType: "application/pdf",
      }],
    });
    const sent = await sendRawMessage(raw);
    gmailAccepted = true;
    const sentAt = new Date();
    await prisma.$transaction([
      prisma.outreachDelivery.update({ where: { leadId }, data: { status: OutreachDeliveryStatus.SENT, gmailMessageId: sent.id, sentAt, error: null } }),
      prisma.outreachLead.update({ where: { id: leadId }, data: { status: OutreachLeadStatus.SENT, sentAt, error: null } }),
    ]);
    return { messageId: sent.id };
  } catch (error) {
    const unknown = error instanceof GmailDeliveryUnknown || gmailAccepted;
    const message = error instanceof Error ? error.message.slice(0, 500) : "Gmail could not send this email.";
    await prisma.$transaction([
      prisma.outreachDelivery.updateMany({ where: { leadId, status: OutreachDeliveryStatus.SENDING }, data: { status: unknown ? OutreachDeliveryStatus.UNKNOWN : OutreachDeliveryStatus.FAILED, error: message } }),
      prisma.outreachLead.updateMany({ where: { id: leadId, status: OutreachLeadStatus.SENDING }, data: { status: unknown ? OutreachLeadStatus.UNKNOWN : OutreachLeadStatus.FAILED, error: message } }),
    ]);
    throw error;
  }
}

export async function markOutreachSent(leadId: string): Promise<void> {
  const delivery = await prisma.outreachDelivery.findUnique({ where: { leadId } });
  if (delivery?.status !== OutreachDeliveryStatus.UNKNOWN) throw new OutreachSendBlocked("Only an unconfirmed delivery can be marked sent.");
  const sentAt = new Date();
  await prisma.$transaction([
    prisma.outreachDelivery.update({ where: { leadId }, data: { status: OutreachDeliveryStatus.SENT, sentAt, error: null } }),
    prisma.outreachLead.update({ where: { id: leadId }, data: { status: OutreachLeadStatus.SENT, sentAt, error: null } }),
  ]);
}

