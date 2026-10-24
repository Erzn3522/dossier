import "server-only";

import { z } from "zod";

import { DocumentKind } from "@/generated/prisma/enums";
import { getAiProvider } from "@/lib/ai";
import { AiError } from "@/lib/ai/errors";
import { summaryText, tailoringSummary } from "@/lib/ai/tailoring-summary";
import { loadTaskOptions } from "@/lib/ai/task-options";
import { adviseResume, extractPosting, matchRequirements, tailorResume, writeCoverLetter, writeEmail } from "@/lib/ai/tasks";
import { calendarDay } from "@/lib/application-documents";
import { isEmailAddress } from "@/lib/application-email";
import { documentLanguage } from "@/lib/document-language";
import { isParagraph, newFrame, withFrame } from "@/lib/letter-frame";
import { logServerError } from "@/lib/log";
import { describeTrim, fitResumeToOnePage } from "@/lib/one-page";
import { prisma } from "@/lib/prisma";
import { QUICK_APPLY_STEPS } from "@/lib/quick-apply";
import { loadProfile } from "@/lib/profile-data";
import { adviceFromMatch } from "@/lib/resume-advice";
import { loadSettings } from "@/lib/settings-data";

import { defineJob } from "./runner";

const NOT_A_POSTING =
  "I couldn't read a job posting in that text. If you fetched it from a link, the site may load the posting in the browser: open the link, copy the posting and paste it into the form, then try again.";

/**
 * Quick apply: a posting the user found themselves, read and turned into a
 * Draft application in one go: the match, what to change in the CV, a
 * tailored resume, a cover letter and the email to send them with.
 */
export const quickApplyJob = defineJob({
  type: "quick-apply",
  input: z.object({
    posting: z.string().min(1).max(100_000),
    postingUrl: z.string().max(2000),
    /** An address the user gave; it wins over the one the posting names. */
    recipient: z.string().max(320),
    note: z.string().max(2000),
  }),
  result: z.object({ applicationId: z.string() }),
  async run({ posting, postingUrl, recipient, note }, { step, signal }) {
    const [provider, options, profile, settings] = await Promise.all([getAiProvider(), loadTaskOptions(), loadProfile(), loadSettings()]);
    const run = { ...options, signal };

    await step(QUICK_APPLY_STEPS[0]);
    const extraction = await extractPosting(provider, { posting }, run).catch((error: unknown) => {
      // A model that can't find a posting in the text rambles until it's cut off.
      if (error instanceof AiError && (error.kind === "cut-off" || error.kind === "invalid-output")) throw new AiError(error.kind, NOT_A_POSTING);
      throw error;
    });
    const extracted = extraction.data;
    await step(QUICK_APPLY_STEPS[1]);
    const matching = await matchRequirements(provider, { requirements: extracted.requirements, profile }, run);
    await step(QUICK_APPLY_STEPS[2]);
    const advice = await adviseResume(provider, { profile, extracted, match: matching.data, posting }, run);
    await step(QUICK_APPLY_STEPS[3]);
    const resume = await tailorResume(provider, { profile, extracted, match: matching.data, note, posting }, run);
    await step(QUICK_APPLY_STEPS[4]);
    const letterResult = await writeCoverLetter(
      provider,
      { profile, extracted, match: matching.data, tone: settings.defaultTone, note, posting },
      run,
    );
    const language = settings.docLanguage ?? extracted.language ?? "English";
    const letter = withFrame(
      letterResult.data,
      newFrame({
        basics: profile.basics,
        company: extracted.company ?? "",
        location: extracted.location ?? "",
        date: calendarDay(),
        dateFormat: settings.dateFormat,
        lang: documentLanguage(language, letterResult.data.map((unit) => unit.text).join(" ")).lang,
      }),
    );
    await step(QUICK_APPLY_STEPS[5]);
    const email = await writeEmail(
      provider,
      {
        profile, extracted, match: matching.data, tone: settings.defaultTone, note, posting,
        letter: letter.filter(isParagraph).map((unit) => unit.text),
      },
      { ...run, language },
    );
    const to = recipient.trim();
    if (isEmailAddress(to)) email.data = email.data.map((unit) => (unit.id === "to" ? { ...unit, text: to } : unit));

    await step(QUICK_APPLY_STEPS[6]);
    const company = extracted.company ?? "";
    const role = extracted.role ?? "";
    const summary = tailoringSummary({
      profile, company, role, match: matching.data, resume: resume.data, letter: letterResult.data,
      tone: settings.defaultTone, note,
      references: !settings.includeRefs ? "setting-off" : extracted.asksForReferences ? "included" : "not-asked",
      strict: settings.strict, showChanges: settings.showDiff,
    });
    const application = await prisma.application.create({
      data: {
        title: extracted.title ?? ([role, company].filter(Boolean).join(" · ") || "Untitled application"),
        company,
        role,
        location: extracted.location ?? "",
        mode: extracted.mode ?? "",
        salary: extracted.salary ?? "",
        deadline: extracted.deadline ? new Date(`${extracted.deadline}T00:00:00Z`) : null,
        postingUrl,
        postingText: posting,
        extracted,
        extractedWith: extraction.promptVersion,
        match: matching.data,
        matchedWith: matching.promptVersion,
        resumeAdvice: [...adviceFromMatch(matching.data), ...advice.data],
        tone: settings.defaultTone,
        userNote: note,
        language,
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

    if (settings.onePage) {
      try {
        const { trimmed, fits } = await fitResumeToOnePage(application.id, profile);
        if (trimmed.length > 0 && settings.showDiff) {
          const text = summaryText({ ...summary, list: [...summary.list, ...describeTrim(trimmed, profile, fits)] });
          await prisma.chatMessage.updateMany({ where: { applicationId: application.id, role: "AI", writtenWith: null }, data: { text } });
        }
      } catch (error) {
        logServerError("quick apply one-page trimming", error);
      }
    }
    return { applicationId: application.id };
  },
});
