import "server-only";

import { AiProvider, OutreachRunStatus } from "@/generated/prisma/enums";
import { loadAiConfig } from "@/lib/ai/config";
import { dayBoundsIn } from "@/lib/automation/schedule";
import { startJob } from "@/lib/jobs/runner";
import { prisma } from "@/lib/prisma";
import { loadSettings } from "@/lib/settings-data";

import { prepareOutreachLeadJob, outreachLeadJobKey } from "../jobs/prepare-outreach-lead";
import { campaignCountries, discoverCompanySites } from "./discovery";

export class OutreachRunBlocked extends Error {}

/** Starts one campaign and queues each new domain on the shared persistent AI queue. */
export async function runOutreachCampaign(
  campaignId: string,
  { country = null }: { country?: string | null } = {},
): Promise<{ runId: string; queued: number; limitReached: false } | { runId: null; queued: 0; limitReached: true; limit: number }> {
  const [campaign, settings, ai] = await Promise.all([
    prisma.outreachCampaign.findUnique({ where: { id: campaignId } }),
    loadSettings(),
    loadAiConfig(),
  ]);
  if (!campaign) throw new OutreachRunBlocked("That outreach campaign no longer exists.");
  if (!settings.outreachEnabled || !settings.outreachAcknowledged) {
    throw new OutreachRunBlocked("Enable outreach and accept the compliance notice before running a campaign.");
  }
  if (!campaign.enabled) throw new OutreachRunBlocked("Enable this campaign before running it.");
  if (ai.provider !== AiProvider.LOCAL) throw new OutreachRunBlocked("Cold outreach requires the local Ollama/llama.cpp AI provider.");
  if (country !== null && !campaignCountries(campaign.countries).includes(country)) {
    throw new OutreachRunBlocked("Choose a country from this campaign's regions.");
  }

  const running = await prisma.outreachRun.findFirst({ where: { campaignId, status: OutreachRunStatus.RUNNING } });
  if (running) throw new OutreachRunBlocked("This campaign is already running.");

  // Every company created today counts, dismissed ones included: each was searched for and researched.
  // No run is recorded when nothing may be searched, so the query plan does not skip ahead.
  const { start, end } = dayBoundsIn(new Date(), settings.outreachTimeZone);
  const discoveredToday = await prisma.outreachLead.count({ where: { campaignId, createdAt: { gte: start, lt: end } } });
  const available = Math.max(0, campaign.dailyDiscoveryLimit - discoveredToday);
  if (!available) return { runId: null, queued: 0, limitReached: true, limit: campaign.dailyDiscoveryLimit };

  const run = await prisma.outreachRun.create({ data: { campaignId, country } });
  try {
    const [existing, suppressed, previousRuns] = await Promise.all([
      prisma.outreachLead.findMany({ select: { domain: true } }),
      prisma.outreachSuppression.findMany({ where: { kind: "DOMAIN" }, select: { value: true } }),
      prisma.outreachRun.count({ where: { campaignId, country, id: { not: run.id } } }),
    ]);
    const skip = new Set([...existing.map((row) => row.domain), ...suppressed.map((row) => row.value.toLowerCase())]);
    // Each run searches the next slice of its plan (the whole campaign's, or one country's), so repeated runs reach new places.
    const searched = country ? { ...campaign, countries: [country] } : campaign;
    const fresh = await discoverCompanySites(searched, available, { skip, cursor: previousRuns });
    const created: string[] = [];
    for (const candidate of fresh) {
      try {
        const lead = await prisma.outreachLead.create({
          data: {
            campaignId,
            runId: run.id,
            companyName: candidate.title.replace(/\s*[|–-].*$/, "").trim(),
            domain: candidate.domain,
            website: candidate.website,
          },
          select: { id: true },
        });
        created.push(lead.id);
      } catch (error) {
        // A concurrent campaign may have claimed this globally unique domain.
        if (!String(error).includes("Unique constraint")) throw error;
      }
    }
    await prisma.$transaction([
      prisma.outreachRun.update({
        where: { id: run.id },
        data: created.length ? { found: created.length } : { found: 0, status: OutreachRunStatus.COMPLETE, finishedAt: new Date() },
      }),
      prisma.outreachCampaign.update({ where: { id: campaignId }, data: { lastRunAt: new Date() } }),
    ]);
    for (const leadId of created) {
      await startJob(prepareOutreachLeadJob, { leadId }, { key: outreachLeadJobKey(leadId), outreachLeadId: leadId });
    }
    return { runId: run.id, queued: created.length, limitReached: false };
  } catch (error) {
    const message = error instanceof Error ? error.message.slice(0, 500) : "Company discovery failed.";
    await prisma.$transaction([
      prisma.outreachLead.updateMany({ where: { runId: run.id, status: "DISCOVERED" }, data: { status: "FAILED", error: message } }),
      prisma.outreachRun.update({ where: { id: run.id }, data: { status: OutreachRunStatus.FAILED, error: message, finishedAt: new Date() } }),
    ]);
    throw error;
  }
}

export async function runEnabledOutreachCampaigns(): Promise<void> {
  const settings = await loadSettings();
  if (!settings.outreachEnabled || !settings.outreachAcknowledged) return;
  const campaigns = await prisma.outreachCampaign.findMany({ where: { enabled: true }, select: { id: true } });
  for (const campaign of campaigns) await runOutreachCampaign(campaign.id);
}

