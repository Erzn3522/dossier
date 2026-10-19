import type { Metadata } from "next";

import { PageHeader } from "@/components/page-header";
import { unitsSchema } from "@/lib/application-data";
import { emailDiscoveryConfigured } from "@/lib/email-discovery/searxng";
import { outreachContactsSchema, outreachEvidenceSchema } from "@/lib/outreach/data";
import { prisma } from "@/lib/prisma";
import { loadSettings } from "@/lib/settings-data";
import { supportedTimeZones } from "@/lib/time-zones";

import { OutreachScreen } from "./outreach-screen";

export const metadata: Metadata = { title: "Outreach" };

export default async function OutreachPage() {
  const [campaigns, leads, settings, suppressions] = await Promise.all([
    prisma.outreachCampaign.findMany({ include: { runs: { orderBy: { startedAt: "desc" }, take: 1 } }, orderBy: { createdAt: "asc" } }),
    prisma.outreachLead.findMany({ include: { campaign: { select: { name: true, targetRole: true, language: true } }, delivery: true }, orderBy: { createdAt: "desc" }, take: 500 }),
    loadSettings(),
    prisma.outreachSuppression.findMany({ orderBy: { createdAt: "desc" }, take: 50 }),
  ]);
  const items = leads.map((lead) => {
    const contacts = outreachContactsSchema.safeParse(lead.contacts);
    const research = outreachEvidenceSchema.safeParse(lead.research);
    const resume = unitsSchema.safeParse(lead.resumeUnits);
    return {
      id: lead.id,
      campaign: lead.campaign.name,
      targetRole: lead.campaign.targetRole,
      language: lead.campaign.language,
      companyName: lead.companyName || lead.domain,
      domain: lead.domain,
      website: lead.website,
      status: lead.status,
      score: lead.fitScore,
      reason: lead.fitReason,
      error: lead.error,
      contacts: contacts.success ? contacts.data : [],
      research: research.success ? research.data : null,
      selectedEmail: lead.selectedEmail ?? "",
      subject: lead.emailSubject ?? "",
      body: lead.emailBody ?? "",
      resumeUnits: resume.success ? resume.data : [],
      approvedAt: lead.approvedAt?.toISOString() ?? null,
      queuedFor: lead.queuedFor?.toISOString() ?? null,
      sentAt: lead.sentAt?.toISOString() ?? null,
      delivery: lead.delivery ? { status: lead.delivery.status, error: lead.delivery.error, attemptedAt: lead.delivery.attemptedAt.toISOString(), gmailMessageId: lead.delivery.gmailMessageId } : null,
      createdAt: lead.createdAt.toISOString(),
    };
  });
  return (
    <>
      <PageHeader title="Outreach" description="Research computer-vision companies, review every recipient and draft, then send within a conservative daily window." />
      <OutreachScreen
        campaigns={campaigns.map((campaign) => ({
          id: campaign.id,
          name: campaign.name,
          enabled: campaign.enabled,
          keywords: campaign.keywords,
          countries: campaign.countries,
          remote: campaign.remote,
          targetRole: campaign.targetRole,
          opportunity: campaign.opportunity,
          pitch: campaign.pitch,
          cta: campaign.cta,
          language: campaign.language,
          fitThreshold: campaign.fitThreshold,
          dailyDiscoveryLimit: campaign.dailyDiscoveryLimit,
          lastRunAt: campaign.lastRunAt?.toISOString() ?? null,
          lastRun: campaign.runs[0] ? { status: campaign.runs[0].status, found: campaign.runs[0].found, prepared: campaign.runs[0].prepared, filtered: campaign.runs[0].filtered, failed: campaign.runs[0].failed } : null,
        }))}
        leads={items}
        settings={{
          enabled: settings.outreachEnabled,
          acknowledged: settings.outreachAcknowledged,
          time: settings.outreachTime,
          timeZone: settings.outreachTimeZone,
          dailySendLimit: settings.outreachDailySendLimit,
          problem: settings.outreachProblem,
        }}
        timeZones={supportedTimeZones(settings.outreachTimeZone, "Europe/Ljubljana")}
        searchConfigured={emailDiscoveryConfigured()}
        suppressions={suppressions.map((entry) => ({ id: entry.id, kind: entry.kind, value: entry.value, createdAt: entry.createdAt.toISOString() }))}
      />
    </>
  );
}

