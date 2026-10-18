import { matchScore, type Extracted, type Match } from "@/lib/application-data";
import { isEmailAddress } from "@/lib/application-email";

export type Eligibility =
  | { eligible: true; score: number; recipient: string }
  | { eligible: false; score: number | null; reason: string };

export const MISSING_APPLICATION_EMAIL = "The posting does not contain an explicit application email address.";

/** The deterministic safety gate between AI analysis and document writing. */
export function automationEligibility(
  extracted: Extracted,
  match: Match,
  {
    threshold = 70,
    blockCriticalGaps = true,
    recipientOverride = null,
  }: { threshold?: number; blockCriticalGaps?: boolean; recipientOverride?: string | null } = {},
): Eligibility {
  const { hit, total } = matchScore(match);
  if (total === 0) return { eligible: false, score: null, reason: "No requirements could be extracted from the posting." };

  const score = Math.round((hit / total) * 100);
  if (blockCriticalGaps) {
    const critical = extracted.requirements.find(
      (requirement, index) => requirement.required && (requirement.kind === "language" || requirement.kind === "years") && match.items[index]?.result === "gap",
    );
    if (critical) return { eligible: false, score, reason: `Missing mandatory requirement: ${critical.text}` };
  }

  if (score < threshold) return { eligible: false, score, reason: `Match score is ${score}%, below the ${threshold}% minimum.` };

  const recipient = recipientOverride?.trim() || extracted.contactEmail?.trim() || "";
  if (!recipient || !isEmailAddress(recipient)) {
    return { eligible: false, score, reason: MISSING_APPLICATION_EMAIL };
  }
  return { eligible: true, score, recipient };
}
