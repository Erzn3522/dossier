import "server-only";

import { z } from "zod";

import { AutomationCandidateStatus, AutomationRunStatus, DocumentKind } from "@/generated/prisma/enums";
import { getAiProvider } from "@/lib/ai";
import { tailoringSummary, summaryText } from "@/lib/ai/tailoring-summary";
import { loadTaskOptions } from "@/lib/ai/task-options";
import { extractPosting, matchRequirements, tailorResume, writeCoverLetter, writeEmail } from "@/lib/ai/tasks";
import { calendarDay } from "@/lib/application-documents";
import { emailParts } from "@/lib/application-email";
import { automationEligibility, MISSING_APPLICATION_EMAIL } from "@/lib/automation/filter";
import { discoverApplicationEmails } from "@/lib/email-discovery/discover";
import { emailDiscoveryConfigured } from "@/lib/email-discovery/searxng";
import { documentLanguage } from "@/lib/document-language";
import { fullText } from "@/lib/job-search/find";
import { isParagraph, newFrame, withFrame } from "@/lib/letter-frame";
import { logServerError } from "@/lib/log";
import { describeTrim, fitResumeToOnePage } from "@/lib/one-page";
import { foundFromPosting } from "@/lib/postings";
import { prisma } from "@/lib/prisma";
import { loadProfile } from "@/lib/profile-data";
import { loadSettings } from "@/lib/settings-data";

import { defineJob } from "./runner";

export const automationCandidateJobKey = (candidateId: string) => `automation-candidate:${candidateId}`;

async function finishRun(runId: string): Promise<void> {
  const remaining = await prisma.automationCandidate.count({
    where: { runId, status: { in: ["DISCOVERED", "ANALYZING", "PREPARING"] } },
  });
  if (remaining > 0) return;
  const grouped = await prisma.automationCandidate.groupBy({ by: ["status"], where: { runId }, _count: true });
  const count = (status: AutomationCandidateStatus) => grouped.find((row) => row.status === status)?._count ?? 0;
  await prisma.automationRun.updateMany({
    where: { id: runId, status: AutomationRunStatus.RUNNING },
    data: {
      status: AutomationRunStatus.COMPLETE,
      filtered: count(AutomationCandidateStatus.FILTERED),
      prepared: count(AutomationCandidateStatus.READY) + count(AutomationCandidateStatus.SENT),
      eligible: count(AutomationCandidateStatus.READY) + count(AutomationCandidateStatus.SENT),
      failed: count(AutomationCandidateStatus.FAILED),
      finishedAt: new Date(),
    },
  });
}

/** One candidate owns this whole idempotent pipeline, so local Ollama work stays serial. */
export const prepareAutomationCandidateJob = defineJob({
  type: "prepare-automation-candidate",
  input: z.object({ candidateId: z.string().min(1) }),
  result: z.object({ candidateId: z.string(), applicationId: z.string().nullable(), filtered: z.boolean() }),
  async run({ candidateId }, { step, signal }) {
    const candidate = await prisma.automationCandidate.findUnique({ where: { id: candidateId }, include: { posting: true } });
    if (!candidate) throw new Error("The automation candidate no longer exists.");
    if (candidate.applicationId) return { candidateId, applicationId: candidate.applicationId, filtered: false };

    try {
      await step("Reading the posting");
      await prisma.automationCandidate.update({ where: { id: candidateId }, data: { status: AutomationCandidateStatus.ANALYZING, error: null } });
      const found = foundFromPosting(candidate.posting);
      const text = (await fullText(found)) ?? candidate.posting.description;
      if (!text.trim()) throw new Error("The full posting text could not be loaded.");
      if (!candidate.posting.complete) {
        await prisma.posting.update({ where: { id: candidate.postingId }, data: { description: text, complete: true } });
      }

      const [provider, options, profile, settings] = await Promise.all([getAiProvider(), loadTaskOptions(), loadProfile(), loadSettings()]);
      await step("Comparing the posting with your profile");
      const extraction = await extractPosting(provider, { posting: text }, { ...options, signal });
      const matching = await matchRequirements(provider, { requirements: extraction.data.requirements, profile }, { ...options, signal });
      const eligibility = automationEligibility(extraction.data, matching.data, {
        threshold: settings.automationMatchThreshold,
        blockCriticalGaps: settings.automationBlockCriticalGaps,
        recipientOverride: candidate.recipientOverride,
      });
      if (!eligibility.eligible) {
        if (eligibility.reason === MISSING_APPLICATION_EMAIL && emailDiscoveryConfigured()) {
          await step("Looking for a public application email");
          const discovery = await discoverApplicationEmails(
            provider,
            {
              company: extraction.data.company ?? candidate.posting.company,
              role: extraction.data.role ?? candidate.posting.title,
              postingUrl: candidate.posting.url,
            },
            { ...options, signal },
          );
          await prisma.automationCandidate.update({ where: { id: candidateId }, data: { emailDiscovery: discovery } });
        }
        await prisma.automationCandidate.update({
          where: { id: candidateId },
          data: {
            status: AutomationCandidateStatus.FILTERED,
            matchHit: matching.data.items.filter((item) => item.result !== "gap").length,
            matchTotal: matching.data.items.length,
            reason: eligibility.reason,
            error: null,
          },
        });
        await finishRun(candidate.runId);
        return { candidateId, applicationId: null, filtered: true };
      }

      await prisma.automationCandidate.update({
        where: { id: candidateId },
        data: {
          status: AutomationCandidateStatus.PREPARING,
          matchHit: matching.data.items.filter((item) => item.result !== "gap").length,
          matchTotal: matching.data.items.length,
          reason: null,
        },
      });
      await step("Tailoring your resume");
      const resume = await tailorResume(provider, { profile, extracted: extraction.data, match: matching.data, note: "", posting: text }, { ...options, signal });
      await step("Writing your cover letter");
      const letterResult = await writeCoverLetter(
        provider,
        { profile, extracted: extraction.data, match: matching.data, tone: settings.defaultTone, note: "", posting: text },
        { ...options, signal },
      );
      const language = settings.docLanguage ?? extraction.data.language ?? "English";
      const letter = withFrame(
        letterResult.data,
        newFrame({
          basics: profile.basics,
          company: extraction.data.company ?? candidate.posting.company,
          location: extraction.data.location ?? candidate.posting.place,
          date: calendarDay(),
          dateFormat: settings.dateFormat,
          lang: documentLanguage(language, letterResult.data.map((unit) => unit.text).join(" ")).lang,
        }),
      );
      await step("Writing the application email");
      const email = await writeEmail(
        provider,
        {
          profile,
          extracted: extraction.data,
          match: matching.data,
          tone: settings.defaultTone,
          note: "",
          posting: text,
          letter: letter.filter(isParagraph).map((unit) => unit.text),
        },
        { ...options, language, signal },
      );
      if (emailParts(email.data).to !== eligibility.recipient) {
        email.data = email.data.map((unit) => (unit.id === "to" ? { ...unit, text: eligibility.recipient } : unit));
      }

      await step("Saving for review");
      const company = extraction.data.company ?? candidate.posting.company;
      const role = extraction.data.role ?? candidate.posting.title;
      const summary = tailoringSummary({
        profile,
        company,
        role,
        match: matching.data,
        resume: resume.data,
        letter: letterResult.data,
        tone: settings.defaultTone,
        note: "",
        references: !settings.includeRefs ? "setting-off" : extraction.data.asksForReferences ? "included" : "not-asked",
        strict: settings.strict,
        showChanges: settings.showDiff,
      });
      const application = await prisma.$transaction(async (tx) => {
        const claimed = await tx.automationCandidate.updateMany({
          where: { id: candidateId, applicationId: null },
          data: { status: AutomationCandidateStatus.PREPARING },
        });
        if (claimed.count === 0) {
          return tx.application.findFirstOrThrow({ where: { automationCandidate: { id: candidateId } }, select: { id: true } });
        }
        const created = await tx.application.create({
          data: {
            title: extraction.data.title ?? ([role, company].filter(Boolean).join(" · ") || "Untitled application"),
            company,
            role,
            location: extraction.data.location ?? candidate.posting.place,
            mode: extraction.data.mode ?? "",
            salary: extraction.data.salary ?? candidate.posting.salary,
            deadline: extraction.data.deadline ? new Date(`${extraction.data.deadline}T00:00:00Z`) : null,
            postingUrl: candidate.posting.url,
            postingText: text,
            extracted: extraction.data,
            extractedWith: extraction.promptVersion,
            match: matching.data,
            matchedWith: matching.promptVersion,
            tone: settings.defaultTone,
            language,
            reviewState: "PENDING_REVIEW",
            documents: {
              create: [
                { kind: DocumentKind.RESUME, units: resume.data, themeId: settings.baseThemeId, writtenWith: resume.promptVersion, versions: { create: { units: resume.data, cause: "WRITTEN" } } },
                { kind: DocumentKind.COVER_LETTER, units: letter, themeId: settings.baseThemeId, writtenWith: letterResult.promptVersion, versions: { create: { units: letter, cause: "WRITTEN" } } },
                { kind: DocumentKind.EMAIL, units: email.data, writtenWith: email.promptVersion, versions: { create: { units: email.data, cause: "WRITTEN" } } },
              ],
            },
            messages: { create: { role: "AI", text: summaryText(summary) } },
          },
          select: { id: true },
        });
        await tx.posting.update({ where: { id: candidate.postingId }, data: { applicationId: created.id } });
        await tx.automationCandidate.update({ where: { id: candidateId }, data: { applicationId: created.id, status: AutomationCandidateStatus.READY } });
        return created;
      });

      if (settings.onePage) {
        try {
          const { trimmed, fits } = await fitResumeToOnePage(application.id, profile);
          if (trimmed.length > 0 && settings.showDiff) {
            const text = summaryText({ ...summary, list: [...summary.list, ...describeTrim(trimmed, profile, fits)] });
            await prisma.chatMessage.updateMany({ where: { applicationId: application.id, role: "AI", writtenWith: null }, data: { text } });
          }
        } catch (error) {
          logServerError("automation one-page trimming", error);
        }
      }
      await finishRun(candidate.runId);
      return { candidateId, applicationId: application.id, filtered: false };
    } catch (error) {
      const message = error instanceof Error ? error.message.slice(0, 500) : "Preparing this application failed.";
      await prisma.automationCandidate.updateMany({ where: { id: candidateId }, data: { status: AutomationCandidateStatus.FAILED, error: message } });
      await finishRun(candidate.runId);
      throw error;
    }
  },
});
