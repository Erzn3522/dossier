import "server-only";

import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { createProvider } from "@/lib/ai";
import { loadAiConfig } from "@/lib/ai/config";
import { AiError } from "@/lib/ai/errors";
import { defineJob } from "@/lib/jobs/runner";
import { linkedInPostSchema } from "./data";
import { campaignInputSchema, countryAssessmentSchema, type CountryAssessment } from "./campaign-data";
import { evaluatePosts, planRound, unavailableAssessment } from "./ai";

const ref = z.object({ attemptId: z.string() });
const result = z.object({ attemptId: z.string() });
export async function campaignProvider(campaign: { provider: string; model: string | null }) {
  const config = await loadAiConfig();
  if (config.provider !== campaign.provider || config.model !== campaign.model) throw AiError.config("The AI provider/model changed. Restore the campaign's AI settings before resuming, or start a new campaign.");
  return createProvider(config);
}
export function bestConfidence(assessments: CountryAssessment[]) {
  return assessments.some((a) => a.confidence === "confirmed") ? "confirmed" : assessments.some((a) => a.confidence === "likely") ? "likely" : "uncertain";
}
export const planLinkedInRound = defineJob({
  type: "linkedin-plan-round", input: ref, result,
  async run({ attemptId }, { signal, step }) {
    const attempt = await prisma.linkedInAttempt.findUniqueOrThrow({ where: { id: attemptId }, include: { campaign: true } });
    if (attempt.campaign.status !== "RUNNING" || attempt.status !== "PLANNING") return { attemptId };
    const input = campaignInputSchema.parse(attempt.campaign.input);
    const provider = await campaignProvider(attempt.campaign);
    await step(`Planning ${attempt.country} · round ${attempt.round}`);
    const rounds = await prisma.linkedInAttempt.findMany({ where: { campaignId: attempt.campaignId, country: attempt.country, position: { lt: attempt.position } }, orderBy: { position: "asc" } });
    const samples = await prisma.linkedInCampaignPost.findMany({ where: { campaignId: attempt.campaignId, occurrences: { array_contains: [{ country: attempt.country }] } }, take: 8, orderBy: { updatedAt: "desc" } });
    const feedback = samples.map((post) => ({ text: post.text.slice(0, 1000), reason: countryAssessmentSchema.array().parse(post.assessments).find((a) => a.country === attempt.country)?.reason ?? "Not assessed" }));
    const plan = await planRound(provider, input, attempt.country, rounds.map((round, i) => ({
      queries: z.array(z.string()).parse(round.queries), fetched: round.fetched, fresh: round.fresh, duplicates: round.duplicates, relevant: round.relevant,
      samples: i === rounds.length - 1 ? feedback : [],
    })), signal);
    signal.throwIfAborted();
    await prisma.linkedInAttempt.updateMany({ where: { id: attemptId, status: "PLANNING", campaign: { status: "RUNNING" } }, data: { queries: plan.queries, strategy: plan.strategy, status: "PLANNED" } });
    return { attemptId };
  },
});

export function pendingEvaluation(campaignId: string, country: string, round: number) {
  return { campaignId, occurrences: { array_contains: [{ country, round }] }, NOT: { assessments: { array_contains: [{ country }] } } };
}
export const evaluateLinkedInBatch = defineJob({
  type: "linkedin-evaluate-posts", input: ref, result,
  async run({ attemptId }, { signal, step }) {
    const attempt = await prisma.linkedInAttempt.findUniqueOrThrow({ where: { id: attemptId }, include: { campaign: true } });
    if (attempt.campaign.status !== "RUNNING" || attempt.status !== "ANALYZING") return { attemptId };
    const input = campaignInputSchema.parse(attempt.campaign.input);
    let rows = await prisma.linkedInCampaignPost.findMany({ where: pendingEvaluation(attempt.campaignId, attempt.country, attempt.round), take: 3, orderBy: { createdAt: "asc" } });
    if (!rows.length) return { attemptId };
    await step(`Assessing ${attempt.country} · round ${attempt.round} · ${rows.length} posts`);
    let evaluations: Map<string, CountryAssessment>;
    let assessmentWarning: string | undefined;
    try {
      evaluations = await evaluatePosts(await campaignProvider(attempt.campaign), input.keywords, attempt.country, rows.map((row) => linkedInPostSchema.parse(row.post)), signal);
    } catch (error) {
      if (signal.aborted || !(error instanceof AiError) || ["auth", "config", "model"].includes(error.kind)) throw error;
      // Optional ranking must not hold the remaining paid searches hostage.
      // A failed model response is not a negative relevance assessment.
      const reason = `AI assessment unavailable: ${error.message} These posts are unverified; the search can continue.`;
      assessmentWarning = reason;
      rows = await prisma.linkedInCampaignPost.findMany({ where: pendingEvaluation(attempt.campaignId, attempt.country, attempt.round), take: 200, orderBy: { createdAt: "asc" } });
      evaluations = new Map(rows.map((row) => [linkedInPostSchema.parse(row.post).id, unavailableAssessment(attempt.country, reason)]));
    }
    if ([...evaluations.values()].some((assessment) => assessment.status === "unavailable")) {
      await prisma.linkedInAttempt.update({ where: { id: attemptId }, data: { error: [attempt.error, assessmentWarning ?? "Some posts could not be assessed by AI. They remain visible and unverified; later search rounds will continue."].filter(Boolean).join(" ") } });
    }
    for (const row of rows) {
      signal.throwIfAborted();
      const assessment = evaluations.get(linkedInPostSchema.parse(row.post).id)!;
      const assessments = [...countryAssessmentSchema.array().parse(row.assessments).filter((a) => a.country !== attempt.country), assessment];
      await prisma.linkedInCampaignPost.updateMany({ where: { id: row.id, campaign: { status: "RUNNING" } }, data: {
        assessments, relevant: assessments.some((a) => a.relevant && a.hiring), hiring: row.hiring || assessments.some((a) => a.hiring), confidence: bestConfidence(assessments),
      } });
    }
    return { attemptId };
  },
});
