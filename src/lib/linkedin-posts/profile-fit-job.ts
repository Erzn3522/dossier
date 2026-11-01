import "server-only";

import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { ActionError } from "@/lib/action";
import { createProvider } from "@/lib/ai";
import { AiError } from "@/lib/ai/errors";
import { defineJob, startJob } from "@/lib/jobs/runner";
import { linkedInPostKey } from "./post-key";
import { assessProfileFit, postContentHash } from "./profile-fit-ai";
import { fitSnapshot, scopePosts, activeDismissals } from "./profile-fit-store";
import { fitScopeSchema, profileFitResultSchema, type ProfileFitResult } from "./profile-fit-data";

export async function queueProfileReview(reviewId: string) {
  const review = await prisma.linkedInProfileReview.findUnique({ where: { id: reviewId } });
  if (!review || review.status !== "RUNNING") return;
  const jobId = await startJob(profileReviewJob, { reviewId }, { key: `linkedin-profile-fit:${review.scope}` });
  await prisma.linkedInProfileReview.updateMany({ where: { id: reviewId, status: "RUNNING", processed: review.processed }, data: { jobId } });
}
export const profileReviewJob = defineJob({
  type: "linkedin-profile-fit", input: z.object({ reviewId: z.string() }), result: z.object({ reviewId: z.string() }),
  async run({ reviewId }, { signal, step }) {
    const run = await prisma.linkedInProfileReview.findUnique({ where: { id: reviewId } });
    if (!run || run.status !== "RUNNING") return { reviewId };
    try {
      const snapshot = await fitSnapshot();
      if (snapshot.hash !== run.profileHash) {
        await prisma.linkedInProfileReview.updateMany({ where: { id: reviewId, status: "RUNNING" }, data: { status: "STALE", error: "Your profile or AI model changed. Match again to use the new settings." } });
        return { reviewId };
      }
      const separator = run.scope.indexOf(":");
      const scope = fitScopeSchema.parse({ kind: run.scope.slice(0, separator), id: run.scope.slice(separator + 1) });
      const posts = await scopePosts(scope, run.processed, Math.min(1, Math.max(0, run.total - run.processed)));
      const dismissed = await activeDismissals();
      const provider = createProvider(snapshot.config);
      let processed = run.processed;
      for (const post of posts) {
        signal.throwIfAborted();
        if (!await prisma.linkedInProfileReview.count({ where: { id: reviewId, status: "RUNNING" } })) return { reviewId };
        const key = linkedInPostKey(post);
        if (!dismissed.has(key)) {
          const postHash = postContentHash(post.text);
          const where = { key_profileHash_postHash: { key, profileHash: run.profileHash, postHash } };
          const cached = await prisma.linkedInProfileFit.findUnique({ where });
          if (!cached || profileFitResultSchema.parse(cached.result).verdict === "unavailable") {
            await step(`Comparing post ${processed + 1} of ${run.total} with your profile`);
            let result: ProfileFitResult;
            try { result = await assessProfileFit(provider, snapshot.profile, post.text, signal); }
            catch (error) {
              if (signal.aborted || !(error instanceof AiError) || ["auth", "config", "model"].includes(error.kind)) throw error;
              result = { verdict: "unavailable", summary: `AI could not assess this post: ${error.message} It remains visible and can be checked again.`, requirements: [] };
            }
            signal.throwIfAborted();
            if (!await prisma.linkedInProfileReview.count({ where: { id: reviewId, status: "RUNNING" } })) return { reviewId };
            const data = { key, profileHash: run.profileHash, postHash, result, verdict: result.verdict, provider: snapshot.config.provider, model: snapshot.config.model, evaluatedAt: new Date() };
            await prisma.linkedInProfileFit.upsert({ where, create: data, update: data });
          }
        }
        processed++;
        await prisma.linkedInProfileReview.updateMany({ where: { id: reviewId, status: "RUNNING" }, data: { processed } });
      }
      const complete = processed >= run.total || !posts.length;
      await prisma.linkedInProfileReview.updateMany({ where: { id: reviewId, status: "RUNNING" }, data: { status: complete ? "COMPLETE" : "RUNNING", jobId: null } });
      if (!complete) await queueProfileReview(reviewId);
      return { reviewId };
    } catch (error) {
      const message = error instanceof AiError || error instanceof ActionError ? error.message : "Profile matching could not finish. Saved results are kept; resume to retry.";
      await prisma.linkedInProfileReview.updateMany({ where: { id: reviewId, status: "RUNNING" }, data: { status: "FAILED", error: message } });
      throw error;
    }
  },
});
export async function recoverProfileReviews() {
  if (!prisma.linkedInProfileReview) return;
  await prisma.linkedInProfileReview.updateMany({ where: { status: "RUNNING" }, data: { status: "PAUSED", error: "Dossier restarted. Resume profile matching; previous results are kept." } });
}
