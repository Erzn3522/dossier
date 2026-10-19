import "server-only";

import { OutreachLeadStatus } from "@/generated/prisma/enums";
import { dayBoundsIn, nextAutomationRun } from "@/lib/automation/schedule";
import { logServerError } from "@/lib/log";
import { prisma } from "@/lib/prisma";
import { loadSettings, saveSettings } from "@/lib/settings-data";

import { runEnabledOutreachCampaigns } from "./runs";
import { sendOutreachEmail } from "./send";

const FIVE_MINUTES = 5 * 60_000;
const globalSchedule = globalThis as unknown as {
  outreachTimer?: ReturnType<typeof setTimeout>;
  outreachDispatch?: ReturnType<typeof setInterval>;
  outreachDispatching?: boolean;
};

export async function queueApprovedOutreach(now = new Date()): Promise<number> {
  const settings = await loadSettings();
  if (!settings.outreachEnabled || !settings.outreachAcknowledged) return 0;
  const { start, end } = dayBoundsIn(now, settings.outreachTimeZone);
  const [sent, queued] = await Promise.all([
    prisma.outreachDelivery.count({ where: { status: "SENT", sentAt: { gte: start, lt: end } } }),
    prisma.outreachLead.count({ where: { status: { in: [OutreachLeadStatus.QUEUED, OutreachLeadStatus.SENDING] }, queuedFor: { gte: start, lt: end } } }),
  ]);
  const available = Math.max(0, settings.outreachDailySendLimit - sent - queued);
  if (!available) return 0;
  const leads = await prisma.outreachLead.findMany({ where: { status: OutreachLeadStatus.APPROVED }, orderBy: { approvedAt: "asc" }, take: available, select: { id: true } });
  for (const [index, lead] of leads.entries()) {
    await prisma.outreachLead.updateMany({ where: { id: lead.id, status: OutreachLeadStatus.APPROVED }, data: { status: OutreachLeadStatus.QUEUED, queuedFor: new Date(now.getTime() + index * FIVE_MINUTES) } });
  }
  return leads.length;
}

async function dispatchDueOutreach(): Promise<void> {
  if (globalSchedule.outreachDispatching) return;
  globalSchedule.outreachDispatching = true;
  try {
    const lastAttempt = await prisma.outreachDelivery.findFirst({ orderBy: { attemptedAt: "desc" }, select: { attemptedAt: true } });
    if (lastAttempt && Date.now() - lastAttempt.attemptedAt.getTime() < FIVE_MINUTES) return;
    const lead = await prisma.outreachLead.findFirst({ where: { status: OutreachLeadStatus.QUEUED, queuedFor: { lte: new Date() } }, orderBy: { queuedFor: "asc" }, select: { id: true } });
    if (lead) await sendOutreachEmail(lead.id);
  } catch (error) {
    logServerError("outreach delivery", error);
  } finally {
    globalSchedule.outreachDispatching = false;
  }
}

export async function startOutreachSchedule(reset = false): Promise<void> {
  if (reset && globalSchedule.outreachTimer) {
    clearTimeout(globalSchedule.outreachTimer);
    globalSchedule.outreachTimer = undefined;
  }
  if (reset && globalSchedule.outreachDispatch) {
    clearInterval(globalSchedule.outreachDispatch);
    globalSchedule.outreachDispatch = undefined;
  }
  if (!globalSchedule.outreachDispatch) {
    globalSchedule.outreachDispatch = setInterval(() => void dispatchDueOutreach(), 30_000);
    globalSchedule.outreachDispatch.unref?.();
    void dispatchDueOutreach();
  }
  if (globalSchedule.outreachTimer && !reset) return;
  const schedule = async () => {
    const settings = await loadSettings();
    const now = new Date();
    globalSchedule.outreachTimer = setTimeout(() => {
      void Promise.all([queueApprovedOutreach(), runEnabledOutreachCampaigns()])
        .then(() => saveSettings({ outreachProblem: null }))
        .catch(async (error) => {
          logServerError("outreach schedule", error);
          await saveSettings({ outreachProblem: error instanceof Error ? error.message : "The daily outreach run failed." }).catch(() => {});
        })
        .finally(schedule);
    }, nextAutomationRun(now, settings.outreachTime, settings.outreachTimeZone).getTime() - now.getTime());
    globalSchedule.outreachTimer.unref?.();
  };
  await schedule();
}

export async function recoverInterruptedOutreach(): Promise<void> {
  await prisma.$transaction([
    prisma.outreachLead.updateMany({ where: { status: { in: [OutreachLeadStatus.DISCOVERED, OutreachLeadStatus.RESEARCHING] } }, data: { status: OutreachLeadStatus.FAILED, error: "Dossier restarted before research finished. Retry this lead." } }),
    prisma.outreachLead.updateMany({ where: { status: OutreachLeadStatus.SENDING }, data: { status: OutreachLeadStatus.UNKNOWN, error: "Dossier restarted while Gmail delivery was in progress. Check Sent before retrying." } }),
    prisma.outreachDelivery.updateMany({ where: { status: "SENDING" }, data: { status: "UNKNOWN", error: "Dossier restarted while Gmail delivery was in progress. Check Sent before retrying." } }),
    prisma.outreachRun.updateMany({ where: { status: "RUNNING" }, data: { status: "FAILED", error: "Dossier restarted before this run finished.", finishedAt: new Date() } }),
  ]);
}

