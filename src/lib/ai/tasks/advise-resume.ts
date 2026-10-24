import { z } from "zod";

import type { Extracted, Match } from "@/lib/application-data";
import type { ProfileData } from "@/lib/profile";
import type { ResumeAdvice } from "@/lib/resume-advice";

import {
  jobForPrompt,
  languageRule,
  NO_EM_DASHES,
  postingForPrompt,
  profileForPrompt,
  system,
  UNTRUSTED_POSTING,
  type Task,
} from "./prompt-parts";

export const ADVISE_RESUME_VERSION = "advise-resume@1";

const MAX_SUGGESTIONS = 8;

const answerSchema = z.object({
  suggestions: z.array(z.object({ area: z.string(), suggestion: z.string(), reason: z.string() })),
});

const INSTRUCTIONS = `You are a career coach reviewing a candidate's CV for one job. Say what the candidate should change in their CV before applying, as JSON.

- suggestions: three to ${MAX_SUGGESTIONS} concrete, actionable changes, most important first. Each one names what to change and how, e.g. "Rewrite the first bullet at Acme to lead with the inspection system you built and its accuracy", not "highlight your experience".
- area: one of "Summary", "Experience", "Skills", "Keywords", "Structure".
- reason: one sentence tying it to what this posting asks for.
- Look for: experience that fits the job but is buried or vague, words the posting uses that the CV says differently, a summary that doesn't speak to this role, things that take space but don't help for this job, and order.
- Never tell the candidate to claim anything their profile doesn't show. When the job asks for something they may have but the profile doesn't mention, say "If you have …, add …".
- Requirements the profile doesn't cover at all are listed separately already; don't repeat them one by one.`;

export type AdviseResumeInput = { profile: ProfileData; extracted: Extracted; match: Match; posting: string };

/** What to change in the CV for this posting (Quick apply). */
export const adviseResume: Task<AdviseResumeInput, ResumeAdvice> = async (provider, { profile, extracted, match, posting }, options) => {
  const answer = await provider.complete({
    system: system(INSTRUCTIONS, languageRule(options.language), UNTRUSTED_POSTING, NO_EM_DASHES),
    messages: [
      {
        role: "user",
        content: [
          `The candidate's profile (their CV):\n${profileForPrompt(profile)}`,
          `The job, with how the profile matches it:\n${jobForPrompt(extracted, match)}`,
          `The posting:\n${postingForPrompt(posting)}`,
        ].join("\n\n"),
      },
    ],
    schema: answerSchema,
    schemaName: "resume_advice",
    creativity: "BALANCED",
    signal: options.signal,
  });
  const clean = (text: string, max: number) => text.replace(/\s+/g, " ").trim().slice(0, max);
  return {
    data: answer.suggestions
      .map((item) => ({ area: clean(item.area, 60) || "Experience", suggestion: clean(item.suggestion, 1000), reason: clean(item.reason, 1000), from: "ai" as const }))
      .filter((item) => item.suggestion)
      .slice(0, MAX_SUGGESTIONS),
    promptVersion: ADVISE_RESUME_VERSION,
  };
};
