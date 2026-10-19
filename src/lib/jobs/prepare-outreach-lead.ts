import "server-only";

import { z } from "zod";

import { Prisma } from "@/generated/prisma/client";
import { OutreachLeadStatus, OutreachRunStatus } from "@/generated/prisma/enums";
import { getAiProvider } from "@/lib/ai";
import { loadTaskOptions } from "@/lib/ai/task-options";
import { analyzeOutreachCompany, rankOutreachContacts, tailorOutreachResume, writeOutreachEmail } from "@/lib/ai/tasks";
import { prisma } from "@/lib/prisma";
import { loadProfile } from "@/lib/profile-data";

import { outreachContactsSchema, outreachEvidenceSchema } from "../outreach/data";
import { extractPublicContacts, readCompanyPages } from "../outreach/research";
import { defineJob } from "./runner";

export const outreachLeadJobKey = (leadId: string) => `outreach-lead:${leadId}`;

async function finishRun(runId: string | null): Promise<void> {
  if (!runId) return;
  const remaining = await prisma.outreachLead.count({
    where: { runId, status: { in: [OutreachLeadStatus.DISCOVERED, OutreachLeadStatus.RESEARCHING] } },
  });
  if (remaining) return;
  const grouped = await prisma.outreachLead.groupBy({ by: ["status"], where: { runId }, _count: true });
  const count = (...statuses: OutreachLeadStatus[]) => grouped.filter((row) => statuses.includes(row.status)).reduce((sum, row) => sum + row._count, 0);
  await prisma.outreachRun.updateMany({
    where: { id: runId, status: OutreachRunStatus.RUNNING },
    data: {
      status: OutreachRunStatus.COMPLETE,
      qualified: count(OutreachLeadStatus.READY, OutreachLeadStatus.APPROVED, OutreachLeadStatus.QUEUED, OutreachLeadStatus.SENDING, OutreachLeadStatus.SENT),
      prepared: count(OutreachLeadStatus.READY, OutreachLeadStatus.APPROVED, OutreachLeadStatus.QUEUED, OutreachLeadStatus.SENDING, OutreachLeadStatus.SENT),
      filtered: count(OutreachLeadStatus.FILTERED, OutreachLeadStatus.DISMISSED, OutreachLeadStatus.SUPPRESSED),
      failed: count(OutreachLeadStatus.FAILED, OutreachLeadStatus.UNKNOWN),
      finishedAt: new Date(),
    },
  });
}

export const prepareOutreachLeadJob = defineJob({
  type: "prepare-outreach-lead",
  input: z.object({ leadId: z.string().min(1) }),
  result: z.object({ leadId: z.string(), ready: z.boolean() }),
  async run({ leadId }, { step, signal }) {
    const lead = await prisma.outreachLead.findUnique({ where: { id: leadId }, include: { campaign: true } });
    if (!lead) throw new Error("The outreach lead no longer exists.");
    if (new Set<OutreachLeadStatus>([OutreachLeadStatus.READY, OutreachLeadStatus.APPROVED, OutreachLeadStatus.QUEUED, OutreachLeadStatus.SENT]).has(lead.status)) {
      return { leadId, ready: true };
    }
    if (!new Set<OutreachLeadStatus>([OutreachLeadStatus.DISCOVERED, OutreachLeadStatus.RESEARCHING]).has(lead.status)) {
      return { leadId, ready: false };
    }
    try {
      await prisma.outreachLead.update({ where: { id: leadId }, data: { status: OutreachLeadStatus.RESEARCHING, error: null } });
      await step("Reading the company website");
      const pages = await readCompanyPages(lead.website, signal);
      if (!pages.length) throw new Error("No readable first-party company pages were found.");

      const [provider, options, profile] = await Promise.all([getAiProvider(), loadTaskOptions(), loadProfile()]);
      if (!profile.basics.name.trim()) throw new Error("Add your full name in Profile before preparing cold outreach.");
      await step("Checking company fit from the evidence");
      const analysis = await analyzeOutreachCompany(provider, {
        pages,
        keywords: lead.campaign.keywords,
        targetRole: lead.campaign.targetRole,
        opportunity: lead.campaign.opportunity,
      }, { ...options, language: lead.campaign.language, signal });
      const research = outreachEvidenceSchema.parse({
        pages,
        summary: analysis.data.summary,
        capabilities: analysis.data.capabilities,
        hiringSignal: analysis.data.hiringSignal,
        evidenceIndexes: analysis.data.evidenceIndexes,
      });
      const common = {
        companyName: analysis.data.companyName.trim() || lead.companyName || lead.domain,
        research: research as Prisma.InputJsonValue,
        researchedWith: analysis.promptVersion,
        fitScore: analysis.data.score,
        fitReason: analysis.data.reason,
      };
      if (analysis.data.score < lead.campaign.fitThreshold) {
        await prisma.outreachLead.update({ where: { id: leadId }, data: { ...common, status: OutreachLeadStatus.FILTERED } });
        await finishRun(lead.runId);
        return { leadId, ready: false };
      }

      await step("Finding verified professional contacts");
      const found = extractPublicContacts(lead.domain, pages);
      const suppressed = found.length
        ? await prisma.outreachSuppression.findMany({ where: { kind: "EMAIL", value: { in: found.map((contact) => contact.email) } }, select: { value: true } })
        : [];
      const blocked = new Set(suppressed.map((row) => row.value.toLowerCase()));
      const candidates = found.filter((contact) => !blocked.has(contact.email));
      if (!candidates.length) {
        await prisma.outreachLead.update({ where: { id: leadId }, data: { ...common, contacts: [], status: OutreachLeadStatus.FILTERED, error: "No suitable public professional email was found on the company website." } });
        await finishRun(lead.runId);
        return { leadId, ready: false };
      }
      const ranking = await rankOutreachContacts(provider, { contacts: candidates, targetRole: lead.campaign.targetRole, opportunity: lead.campaign.opportunity }, { ...options, language: lead.campaign.language, signal });
      const contacts = outreachContactsSchema.parse(ranking.data);
      const selected = contacts[0];

      await step("Tailoring the CV from your profile");
      const resume = await tailorOutreachResume(provider, { profile, company: analysis.data, targetRole: lead.campaign.targetRole, opportunity: lead.campaign.opportunity }, { ...options, language: lead.campaign.language, signal });
      await step("Writing the cold email");
      const email = await writeOutreachEmail(provider, { profile, company: analysis.data, contact: selected, pitch: lead.campaign.pitch, cta: lead.campaign.cta, opportunity: lead.campaign.opportunity }, { ...options, language: lead.campaign.language, signal });

      await step("Saving for review");
      await prisma.outreachLead.update({
        where: { id: leadId },
        data: {
          ...common,
          contacts: contacts as Prisma.InputJsonValue,
          rankedWith: ranking.promptVersion,
          selectedEmail: selected.email,
          selectedName: selected.name,
          selectedTitle: selected.title,
          contactSourceUrl: selected.sourceUrl,
          emailSubject: email.data.subject,
          emailBody: email.data.body,
          emailWrittenWith: email.promptVersion,
          resumeUnits: resume.data as Prisma.InputJsonValue,
          resumeWrittenWith: resume.promptVersion,
          status: OutreachLeadStatus.READY,
          error: null,
        },
      });
      await finishRun(lead.runId);
      return { leadId, ready: true };
    } catch (error) {
      const message = error instanceof Error ? error.message.slice(0, 500) : "Outreach research failed.";
      await prisma.outreachLead.updateMany({ where: { id: leadId }, data: { status: OutreachLeadStatus.FAILED, error: message } });
      await finishRun(lead.runId);
      throw error;
    }
  },
});

