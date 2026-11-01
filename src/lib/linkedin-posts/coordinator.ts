import "server-only";

import { z } from "zod";
import { type LinkedInAttempt } from "@/generated/prisma/client";
import { ActionError } from "@/lib/action";
import { AiError } from "@/lib/ai/errors";
import { cancelJob, getJob, startJob } from "@/lib/jobs/runner";
import { logServerError } from "@/lib/log";
import { prisma } from "@/lib/prisma";
import { ACTOR, actorInput, apifyRequest, parsePosts, parseRun } from "./apify";
import { campaignInputSchema, countryAssessmentSchema, occurrenceSchema } from "./campaign-data";
import { evaluateLinkedInBatch, pendingEvaluation, planLinkedInRound } from "./campaign-jobs";
import { hasHiringSignal } from "./data";
import { loadApifyKey } from "./searches";
import { linkedInPostKey } from "./post-key";
import { postContentHash } from "./profile-fit-ai";

const globalState = globalThis as unknown as { linkedInCoordinator?: { busy: boolean; timer?: ReturnType<typeof setInterval>; tick?: () => Promise<void> } };
const state = globalState.linkedInCoordinator ??= { busy: false };
const safeError = (error: unknown) => error instanceof ActionError || error instanceof AiError ? error.message : "The AI search was interrupted. Results are saved; resume to retry the current stage safely.";

export async function ingestAttemptPosts(attempt: LinkedInAttempt, posts: ReturnType<typeof parsePosts>) {
  await prisma.$transaction(async (tx) => {
    let fresh = 0;
    for (const post of posts) {
      // Numeric activity IDs identify the same post even if LinkedIn varies its public URL.
      const url = linkedInPostKey(post);
      const old = await tx.linkedInCampaignPost.findUnique({ where: { campaignId_url: { campaignId: attempt.campaignId, url } } });
      const occurrences = old ? occurrenceSchema.array().parse(old.occurrences) : [];
      if (!old) fresh++;
      if (!occurrences.some((o) => o.country === attempt.country && o.round === attempt.round)) occurrences.push({ country: attempt.country, round: attempt.round, queries: post.queries?.length ? post.queries : post.query ? [post.query] : z.array(z.string()).parse(attempt.queries) });
      await tx.linkedInCampaignPost.upsert({ where: { campaignId_url: { campaignId: attempt.campaignId, url } },
        create: { campaignId: attempt.campaignId, url, post, text: post.text, contentHash: postContentHash(post.text), authorName: post.author.name, authorType: post.author.type, likes: Math.round(post.likes),
          postedAt: post.postedAt ? new Date(post.postedAt) : null, hiring: hasHiringSignal(post.text), remote: /\b(remote|uzaktan|home office|work from home|delo na daljavo)\b/iu.test(post.text), occurrences },
        update: { occurrences },
      });
    }
    // Re-fetching the same dataset after a crash must not overwrite already committed counts.
    await tx.linkedInAttempt.updateMany({ where: { id: attempt.id, status: "SEARCHING" }, data: {
      status: "ANALYZING", fetched: posts.length, fresh, duplicates: posts.length - fresh, jobId: null,
    } });
  }, { timeout: 30_000 });
}

async function tickAttempt(attempt: LinkedInAttempt, input: z.infer<typeof campaignInputSchema>) {
  if (attempt.status === "PENDING") {
    const claimed = await prisma.linkedInAttempt.updateMany({ where: { id: attempt.id, status: "PENDING", campaign: { status: "RUNNING" } }, data: { status: "PLANNING" } });
    if (!claimed.count) return;
    const jobId = await startJob(planLinkedInRound, { attemptId: attempt.id }, { key: `linkedin-campaign:${attempt.campaignId}` });
    await prisma.linkedInAttempt.update({ where: { id: attempt.id }, data: { jobId } });
    return;
  }
  if (attempt.status === "PLANNING") {
    const job = attempt.jobId ? await getJob(attempt.jobId) : null;
    if (!job || job.status === "FAILED") throw new ActionError(job?.error ?? "The planning task was interrupted. Resume to plan this round again.");
    return;
  }
  if (attempt.status === "PLANNED") {
    const queries = z.array(z.string().min(2).max(200)).min(1).max(5).parse(attempt.queries);
    if (queries.length * Math.max(1, input.authors.length) * input.maxPosts > 200) throw new ActionError("The AI query plan exceeds the 200-post round limit.");
    const key = await loadApifyKey();
    const claimed = await prisma.linkedInAttempt.updateMany({ where: { id: attempt.id, status: "PLANNED", campaign: { status: "RUNNING" } }, data: { status: "STARTING" } });
    if (!claimed.count) return;
    try {
      const cap = Number(attempt.capUsd).toFixed(6);
      const run = parseRun(await apifyRequest(key, `/actors/${ACTOR}/runs?timeout=600&maxItems=200&maxTotalChargeUsd=${cap}&restartOnError=false`, actorInput({ ...input, keywords: queries, countries: [] })));
      await prisma.linkedInAttempt.update({ where: { id: attempt.id }, data: { runId: run.id, status: "SEARCHING", error: null } });
    } catch (error) {
      await prisma.linkedInAttempt.updateMany({ where: { id: attempt.id, status: "STARTING" }, data: { status: "UNKNOWN", error: "The paid request was not confirmed. Check Apify Console; it will not be repeated automatically." } });
      throw error;
    }
    return;
  }
  if (attempt.status === "STARTING" || attempt.status === "UNKNOWN") throw new ActionError("A paid request was not confirmed. Check Apify Console before starting another search.");
  if (attempt.status === "SEARCHING") {
    if (!attempt.runId) throw new ActionError("This round has no confirmed Apify run ID. Check Apify Console.");
    const key = await loadApifyKey();
    const run = parseRun(await apifyRequest(key, `/actor-runs/${encodeURIComponent(attempt.runId)}`));
    if (["READY", "RUNNING", "TIMING-OUT", "ABORTING"].includes(run.status)) return;
    if (run.status !== "SUCCEEDED") await prisma.linkedInAttempt.update({ where: { id: attempt.id }, data: { error: `Apify ended this round (${run.status}); partial results are included.` } });
    const posts = run.defaultDatasetId ? parsePosts(await apifyRequest(key, `/datasets/${encodeURIComponent(run.defaultDatasetId)}/items?format=json&clean=true&limit=200`)) : [];
    if (run.status === "SUCCEEDED" && !run.defaultDatasetId) throw new ActionError("Apify finished without a dataset. Check the run in Apify Console.");
    await ingestAttemptPosts(attempt, posts);
    return;
  }
  if (attempt.status === "ANALYZING") {
    const job = attempt.jobId ? await getJob(attempt.jobId) : null;
    if (job && (job.status === "RUNNING" || job.status === "QUEUED")) return;
    if (job?.status === "FAILED") throw new ActionError(job.error ?? "The evaluation task failed. Resume to retry without repeating the paid search.");
    const pending = await prisma.linkedInCampaignPost.count({ where: pendingEvaluation(attempt.campaignId, attempt.country, attempt.round) });
    if (pending) {
      const jobId = await startJob(evaluateLinkedInBatch, { attemptId: attempt.id }, { key: `linkedin-campaign:${attempt.campaignId}` });
      await prisma.linkedInAttempt.update({ where: { id: attempt.id }, data: { jobId } });
    } else {
      const rows = await prisma.linkedInCampaignPost.findMany({ where: { campaignId: attempt.campaignId, occurrences: { array_contains: [{ country: attempt.country, round: attempt.round }] } }, select: { assessments: true } });
      const relevant = rows.filter((row) => countryAssessmentSchema.array().parse(row.assessments).some((a) => a.country === attempt.country && a.relevant && a.hiring)).length;
      await prisma.linkedInAttempt.update({ where: { id: attempt.id }, data: { status: "COMPLETE", relevant, jobId: null } });
    }
  }
}

async function cancelCampaign(id: string) {
  const attempts = await prisma.linkedInAttempt.findMany({ where: { campaignId: id, status: { not: "COMPLETE" } } });
  for (const attempt of attempts) {
    if (attempt.jobId) await cancelJob(attempt.jobId);
    if (attempt.runId && ["SEARCHING", "STARTING"].includes(attempt.status)) {
      // Leave the campaign cancelling if abort cannot be confirmed; no later rounds can start.
      const key = await loadApifyKey();
      let run = parseRun(await apifyRequest(key, `/actor-runs/${encodeURIComponent(attempt.runId)}`));
      if (["READY", "RUNNING", "TIMING-OUT"].includes(run.status)) {
        await apifyRequest(key, `/actor-runs/${encodeURIComponent(attempt.runId)}/abort`, {});
        run = parseRun(await apifyRequest(key, `/actor-runs/${encodeURIComponent(attempt.runId)}`));
      }
      if (["READY", "RUNNING", "ABORTING", "TIMING-OUT"].includes(run.status)) return;
      const posts = run.defaultDatasetId ? parsePosts(await apifyRequest(key, `/datasets/${encodeURIComponent(run.defaultDatasetId)}/items?format=json&clean=true&limit=200`)) : [];
      await ingestAttemptPosts(attempt, posts);
    }
    await prisma.linkedInAttempt.update({ where: { id: attempt.id }, data: { status: "CANCELLED" } });
  }
  await prisma.linkedInCampaign.update({ where: { id }, data: { status: "CANCELLED", error: attempts.some((a) => a.status === "UNKNOWN" || a.status === "STARTING") ? "An unconfirmed run may remain in Apify Console. Check it there." : null } });
}

/** One short coordinator tick: AI jobs queue separately, and remote waits never hold an AI slot. */
export async function tickCampaigns() {
  if (state.busy) return;
  state.busy = true;
  try {
    const campaigns = await prisma.linkedInCampaign.findMany({ where: { status: { in: ["RUNNING", "CANCELLING"] } } });
    for (const campaign of campaigns) {
      try {
        if (campaign.status === "CANCELLING") { await cancelCampaign(campaign.id); continue; }
        const attempt = await prisma.linkedInAttempt.findFirst({ where: { campaignId: campaign.id, status: { not: "COMPLETE" } }, orderBy: { position: "asc" } });
        if (!attempt) {
          await prisma.linkedInCampaign.updateMany({ where: { id: campaign.id, status: "RUNNING" }, data: { status: "COMPLETE" } });
        } else await tickAttempt(attempt, campaignInputSchema.parse(campaign.input));
      } catch (error) {
        if (!(error instanceof ActionError) && !(error instanceof AiError)) logServerError("linkedin campaign", error);
        await prisma.linkedInCampaign.updateMany({ where: { id: campaign.id, status: { in: ["RUNNING", "CANCELLING"] } }, data: { status: campaign.status === "CANCELLING" ? "PAUSED" : "FAILED", error: safeError(error) } });
      }
    }
  } finally { state.busy = false; }
}
export function startCampaignSchedule() {
  state.tick = tickCampaigns;
  if (!state.timer) { state.timer = setInterval(() => { void state.tick?.().catch((error) => logServerError("linkedin coordinator", error)); }, 5000); state.timer.unref?.(); }
  void state.tick().catch((error) => logServerError("linkedin coordinator", error));
}
export async function recoverCampaigns() {
  await prisma.linkedInCampaign.updateMany({ where: { status: "RUNNING" }, data: { status: "PAUSED", error: "The server restarted. Resume to continue from the saved stage; existing paid searches will not be repeated." } });
}
