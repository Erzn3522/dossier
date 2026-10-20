"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { Prisma } from "@/generated/prisma/client";
import { OutreachLeadStatus } from "@/generated/prisma/enums";
import { action, ActionError } from "@/lib/action";
import { unitsSchema } from "@/lib/application-data";
import { GmailDeliveryUnknown, GmailNotConnected, GmailSendFailed } from "@/lib/gmail/client";
import { findLatestJob, retryJob, startJob } from "@/lib/jobs/runner";
import { outreachLeadJobKey, prepareOutreachLeadJob } from "@/lib/jobs/prepare-outreach-lead";
import { outreachContactsSchema } from "@/lib/outreach/data";
import { runOutreachCampaign, OutreachRunBlocked } from "@/lib/outreach/runs";
import { markOutreachSent, OutreachSendBlocked, sendOutreachEmail } from "@/lib/outreach/send";
import { startOutreachSchedule } from "@/lib/outreach/schedule";
import { normalizedDomain } from "@/lib/outreach/research";
import { prisma } from "@/lib/prisma";
import { saveSettings } from "@/lib/settings-data";
import { isTimeZone } from "@/lib/time-zones";

const refresh = () => revalidatePath("/outreach");
const id = z.object({ id: z.string().min(1) });

export const updateOutreachSettings = action(z.object({
  enabled: z.boolean(),
  acknowledged: z.boolean(),
  time: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
  timeZone: z.string().trim().max(100).refine(isTimeZone, "Choose a valid time zone."),
  dailySendLimit: z.number().int().min(1).max(5),
}), async (input, { toast }) => {
  if (input.enabled && !input.acknowledged) throw new ActionError("Accept the compliance notice before enabling outreach.");
  await saveSettings({
    outreachEnabled: input.enabled,
    outreachAcknowledged: input.acknowledged,
    outreachTime: input.time,
    outreachTimeZone: input.timeZone,
    outreachDailySendLimit: input.dailySendLimit,
    outreachProblem: null,
  });
  await startOutreachSchedule(true);
  refresh();
  toast(input.enabled ? "Outreach enabled." : "Outreach disabled.");
  return null;
});

const campaignSchema = z.object({
  id: z.string().optional(),
  name: z.string().trim().min(1).max(100),
  enabled: z.boolean(),
  keywords: z.array(z.string().trim().min(1)).min(1).max(20),
  countries: z.array(z.string().trim().min(1)).min(1).max(30),
  remote: z.boolean(),
  targetRole: z.string().trim().min(1).max(200),
  opportunity: z.string().trim().min(1).max(300),
  pitch: z.string().trim().min(1).max(1_000),
  cta: z.string().trim().min(1).max(500),
  language: z.string().trim().min(1).max(50),
  fitThreshold: z.number().int().min(1).max(100),
  dailyDiscoveryLimit: z.number().int().min(1).max(25),
});

export const saveOutreachCampaign = action(campaignSchema, async ({ id: campaignId, ...data }, { toast }) => {
  if (campaignId) await prisma.outreachCampaign.update({ where: { id: campaignId }, data });
  else await prisma.outreachCampaign.create({ data });
  refresh();
  toast(campaignId ? "Campaign updated." : "Campaign created.");
  return null;
});

export const toggleOutreachCampaign = action(id.extend({ enabled: z.boolean() }), async ({ id, enabled }, { toast }) => {
  await prisma.outreachCampaign.update({ where: { id }, data: { enabled } });
  refresh();
  toast(enabled ? "Campaign enabled." : "Campaign paused.");
  return null;
});

export const deleteOutreachCampaign = action(id, async ({ id }, { toast }) => {
  const leads = await prisma.outreachLead.count({ where: { campaignId: id } });
  if (leads) throw new ActionError("A campaign with leads cannot be removed. Pause it instead.");
  await prisma.outreachCampaign.delete({ where: { id } });
  refresh();
  toast("Campaign removed.");
  return null;
});

export const runOutreachNow = action(id.extend({ country: z.string().trim().min(1).max(100).nullable().default(null) }), async ({ id, country }, { toast }) => {
  try {
    const result = await runOutreachCampaign(id, { country });
    const where = country ? ` in ${country}` : "";
    toast(result.limitReached
      ? `This campaign already found its ${result.limit} new companies for today, dismissed ones included. It can search again tomorrow.`
      : result.queued ? `${result.queued} companies${where} queued for research.` : `No new unsuppressed companies were found${where}. Run again to search the next queries.`);
    refresh();
    return result;
  } catch (error) {
    if (error instanceof OutreachRunBlocked) throw new ActionError(error.message);
    throw error;
  }
});

const draftSchema = z.object({
  id: z.string().min(1),
  selectedEmail: z.email(),
  subject: z.string().trim().min(1).max(200),
  body: z.string().trim().min(1).max(10_000),
  resumeUnits: unitsSchema,
  approve: z.boolean(),
});

export const saveOutreachDraft = action(draftSchema, async (input, { toast }) => {
  const lead = await prisma.outreachLead.findUnique({ where: { id: input.id }, select: { status: true, contacts: true, domain: true } });
  if (!lead || !new Set<OutreachLeadStatus>([OutreachLeadStatus.READY, OutreachLeadStatus.APPROVED]).has(lead.status)) throw new ActionError("That lead is no longer available for review.");
  const parsed = outreachContactsSchema.safeParse(lead.contacts);
  const contact = parsed.success ? parsed.data.find((candidate) => candidate.email.toLowerCase() === input.selectedEmail.toLowerCase()) : null;
  if (!contact) throw new ActionError("Choose an email address that was verified from a saved source.");
  const suppressed = await prisma.outreachSuppression.findFirst({ where: { value: { in: [lead.domain, contact.email] } } });
  if (suppressed) throw new ActionError("That recipient or domain is on the suppression list.");
  await prisma.outreachLead.update({
    where: { id: input.id },
    data: {
      selectedEmail: contact.email,
      selectedName: contact.name,
      selectedTitle: contact.title,
      contactSourceUrl: contact.sourceUrl,
      emailSubject: input.subject,
      emailBody: input.body,
      resumeUnits: input.resumeUnits as Prisma.InputJsonValue,
      status: input.approve ? OutreachLeadStatus.APPROVED : OutreachLeadStatus.READY,
      approvedAt: input.approve ? new Date() : null,
      queuedFor: null,
      error: null,
    },
  });
  refresh();
  toast(input.approve ? "Approved for the next outreach window." : "Draft saved.");
  return null;
});

export const dismissOutreachLeads = action(z.object({ ids: z.array(z.string().min(1)).min(1).max(500) }), async ({ ids }, { toast }) => {
  const result = await prisma.outreachLead.updateMany({
    where: { id: { in: [...new Set(ids)] }, delivery: { is: null }, status: { in: ["DISCOVERED", "FILTERED", "READY", "FAILED"] } },
    data: { status: OutreachLeadStatus.DISMISSED, dismissedAt: new Date(), error: null },
  });
  if (!result.count) throw new ActionError("None of those leads can be dismissed now.");
  refresh();
  toast(`${result.count} ${result.count === 1 ? "lead" : "leads"} dismissed.`);
  return null;
});

export const suppressOutreachLead = action(id.extend({ kind: z.enum(["EMAIL", "DOMAIN"]), email: z.email().optional() }), async ({ id, kind, email }, { toast }) => {
  const lead = await prisma.outreachLead.findUnique({ where: { id }, select: { domain: true, selectedEmail: true, contacts: true, status: true } });
  if (!lead) throw new ActionError("That lead no longer exists.");
  if (new Set<OutreachLeadStatus>([OutreachLeadStatus.SENDING, OutreachLeadStatus.SENT]).has(lead.status)) throw new ActionError("A sent or sending lead cannot be suppressed retroactively.");
  const contacts = outreachContactsSchema.safeParse(lead.contacts);
  const requestedEmail = email?.toLowerCase();
  if (kind === "EMAIL" && requestedEmail && (!contacts.success || !contacts.data.some((contact) => contact.email === requestedEmail))) {
    throw new ActionError("Only a verified email candidate can be suppressed.");
  }
  const value = kind === "DOMAIN" ? normalizedDomain(lead.domain) : requestedEmail ?? lead.selectedEmail?.toLowerCase();
  if (!value) throw new ActionError("There is no verified value to suppress.");
  await prisma.$transaction([
    prisma.outreachSuppression.upsert({ where: { value }, create: { kind, value, reason: "Suppressed during outreach review." }, update: { kind, reason: "Suppressed during outreach review." } }),
    prisma.outreachLead.update({ where: { id }, data: { status: OutreachLeadStatus.SUPPRESSED, dismissedAt: new Date(), error: null } }),
  ]);
  refresh();
  toast(kind === "DOMAIN" ? "Company domain suppressed." : "Email address suppressed.");
  return null;
});

export const removeOutreachSuppression = action(id, async ({ id }, { toast }) => {
  const removed = await prisma.outreachSuppression.deleteMany({ where: { id } });
  if (!removed.count) throw new ActionError("That suppression entry no longer exists.");
  refresh();
  toast("Suppression removed. Future campaigns may rediscover it.");
  return null;
});

export const retryOutreachResearch = action(id, async ({ id }, { toast }) => {
  // READY is included so a draft that came out wrong can be researched and written again before approval.
  const claimed = await prisma.outreachLead.updateMany({ where: { id, delivery: { is: null }, status: { in: [OutreachLeadStatus.FAILED, OutreachLeadStatus.FILTERED, OutreachLeadStatus.READY] } }, data: { status: OutreachLeadStatus.DISCOVERED, error: null } });
  if (!claimed.count) throw new ActionError("That lead cannot be researched again now.");
  const previous = await findLatestJob(outreachLeadJobKey(id));
  if (!previous || !(await retryJob(previous.id))) await startJob(prepareOutreachLeadJob, { leadId: id }, { key: outreachLeadJobKey(id), outreachLeadId: id });
  refresh();
  toast("Research queued.");
  return null;
});

export const retryUnknownOutreach = action(id, async ({ id }, { toast }) => {
  try {
    await sendOutreachEmail(id, true);
  } catch (error) {
    if (error instanceof OutreachSendBlocked || error instanceof GmailDeliveryUnknown || error instanceof GmailNotConnected || error instanceof GmailSendFailed) throw new ActionError(error.message);
    throw error;
  }
  refresh();
  toast("Email sent.");
  return null;
});

export const requeueFailedOutreach = action(id, async ({ id }, { toast }) => {
  const updated = await prisma.outreachLead.updateMany({
    where: { id, status: OutreachLeadStatus.FAILED, delivery: { is: { status: "FAILED" } } },
    data: { status: OutreachLeadStatus.APPROVED, approvedAt: new Date(), queuedFor: null, error: null },
  });
  if (!updated.count) throw new ActionError("That failed delivery is no longer available to queue.");
  refresh();
  toast("Moved back to the approved queue for the next window.");
  return null;
});

export const markUnknownOutreachSent = action(id, async ({ id }, { toast }) => {
  try { await markOutreachSent(id); }
  catch (error) { if (error instanceof OutreachSendBlocked) throw new ActionError(error.message); throw error; }
  refresh();
  toast("Marked as sent.");
  return null;
});

