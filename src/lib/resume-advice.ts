import { z } from "zod";

import type { Match } from "@/lib/application-data";

// Quick apply: what the candidate should change in their CV for one posting.
// Gaps and half-backed skills come from the match, decided by code; the rest
// is the model's advice on wording, emphasis and order.

export const RESUME_ADVICE_AREAS = ["Missing requirement", "Skills", "Experience", "Summary", "Keywords", "Structure"] as const;

export const resumeAdviceSchema = z.array(
  z.object({
    area: z.string().max(60),
    suggestion: z.string().max(1000),
    reason: z.string().max(1000),
    /** "match" for gaps the profile check found; "ai" for the model's advice. */
    from: z.enum(["match", "ai"]),
  }),
);
export type ResumeAdvice = z.infer<typeof resumeAdviceSchema>;

/** Advice that follows from the match alone: requirements the profile doesn't back, and skills not tied to a role. */
export function adviceFromMatch(match: Match): ResumeAdvice {
  return match.items.flatMap((item): ResumeAdvice => {
    if (item.result === "gap") {
      return [{
        area: "Missing requirement",
        suggestion: `The posting asks for: "${item.requirement}". If you have this, add it to your profile and show where you used it.`,
        reason: item.note ?? "Nothing in your profile backs this yet.",
        from: "match",
      }];
    }
    if (item.result === "partial" && item.skill) {
      return [{
        area: "Skills",
        suggestion: `Link "${item.skill}" to the role where you used it, with a bullet that shows the result.`,
        reason: `It's in your skills list, but no role shows it, and the posting asks for it ("${item.requirement}").`,
        from: "match",
      }];
    }
    return [];
  });
}
