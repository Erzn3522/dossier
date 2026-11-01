import "server-only";

import { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { ActionError } from "@/lib/action";
import { loadAiConfig } from "@/lib/ai/config";
import { loadProfile } from "@/lib/profile-data";
import { linkedInPostSchema, type LinkedInPost } from "./data";
import { dismissedPostKeys, campaignDismissalFilter } from "./dismissals";
import { linkedInPostKey } from "./post-key";
import { hasFitProfile, postContentHash, profileFitHash, profileForFit } from "./profile-fit-ai";
import { fitScopeKey, profileFitResultSchema, type FitFilter, type FitScope, type ProfileFitState, type ProfileFitView } from "./profile-fit-data";

const missingFitStorage = (error: unknown) => error !== null && typeof error === "object" && "code" in error && ["P2021", "P2022"].includes(String(error.code));
export async function fitSnapshot() {
  const [profile, config] = await Promise.all([loadProfile(), loadAiConfig()]);
  const professional = profileForFit(profile);
  return { profile: professional, config, ready: hasFitProfile(professional), hash: profileFitHash(professional, config.provider, config.model) };
}
export async function scopePostCount(scope: FitScope) {
  if (scope.kind === "manual") {
    const row = await prisma.linkedInPostSearch.findUnique({ where: { id: scope.id }, select: { posts: true } });
    if (!row) throw new ActionError("That search no longer exists.");
    return linkedInPostSchema.array().parse(row.posts).length;
  }
  if (!await prisma.linkedInCampaign.count({ where: { id: scope.id } })) throw new ActionError("That AI search no longer exists.");
  return prisma.linkedInCampaignPost.count({ where: { campaignId: scope.id } });
}
export async function scopePosts(scope: FitScope, skip: number, take: number): Promise<LinkedInPost[]> {
  if (scope.kind === "manual") {
    const row = await prisma.linkedInPostSearch.findUnique({ where: { id: scope.id }, select: { posts: true } });
    if (!row) throw new ActionError("That search no longer exists.");
    return linkedInPostSchema.array().parse(row.posts).slice(skip, skip + take);
  }
  return (await prisma.linkedInCampaignPost.findMany({ where: { campaignId: scope.id }, select: { post: true }, orderBy: [{ createdAt: "asc" }, { id: "asc" }], skip, take })).map((row) => linkedInPostSchema.parse(row.post));
}
export async function fitsForPosts(posts: LinkedInPost[], profileHash: string): Promise<Record<string, ProfileFitView>> {
  if (!posts.length || !prisma.linkedInProfileFit) return {};
  try {
    const rows = await prisma.linkedInProfileFit.findMany({ where: { profileHash, OR: posts.map((post) => ({ key: linkedInPostKey(post), postHash: postContentHash(post.text) })) } });
    return Object.fromEntries(rows.map((row) => [row.key, { ...profileFitResultSchema.parse(row.result), evaluatedAt: row.evaluatedAt.toISOString(), provider: row.provider, model: row.model }]));
  } catch (error) { if (missingFitStorage(error)) return {}; throw error; }
}
export async function readProfileFit(scope: FitScope): Promise<ProfileFitState> {
  const snapshot = await fitSnapshot();
  const empty: ProfileFitState = { scope: fitScopeKey(scope), available: false, profileReady: snapshot.ready, profileHash: snapshot.hash, run: null, results: {} };
  if (!prisma.linkedInProfileReview) return empty;
  try {
    const run = await prisma.linkedInProfileReview.findUnique({ where: { scope: fitScopeKey(scope) } });
    const results = scope.kind === "manual" ? await fitsForPosts(await scopePosts(scope, 0, 200), snapshot.hash) : {};
    return { ...empty, available: true, results, run: run ? { id: run.id, status: run.profileHash !== snapshot.hash ? "STALE" : run.status, active: run.status === "RUNNING", total: run.total, processed: run.processed, error: run.error } : null };
  } catch (error) { if (missingFitStorage(error)) return empty; throw error; }
}
export async function startProfileFit(scope: FitScope) {
  const snapshot = await fitSnapshot();
  if (!snapshot.ready) throw new ActionError("Add your skills, work experience or professional summary in Profile before matching posts.");
  if (!snapshot.config.model || snapshot.config.apiKeyProblem) throw new ActionError("Choose a working AI model in Settings → AI provider first.");
  if (!prisma.linkedInProfileReview) throw new ActionError("Restart Dossier to apply the profile-matching database update.");
  const total = await scopePostCount(scope);
  if (!total) throw new ActionError("This search has no posts to compare with your profile yet.");
  let review;
  try {
    review = await prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(710303)`;
      const active = await tx.linkedInProfileReview.findFirst({ where: { status: "RUNNING" } });
      if (active) {
        if (active.scope === fitScopeKey(scope) && active.profileHash === snapshot.hash) return { row: active, start: false };
        if (active.scope === fitScopeKey(scope)) throw new ActionError("Stop the previous profile review before matching your changed profile.");
        throw new ActionError("A profile review is running for another search. Finish or stop it first.");
      }
      const old = await tx.linkedInProfileReview.findUnique({ where: { scope: fitScopeKey(scope) } });
      const processed = old && old.profileHash === snapshot.hash && ["FAILED", "PAUSED"].includes(old.status) ? Math.min(old.processed, total) : 0;
      const data = { profileHash: snapshot.hash, provider: snapshot.config.provider, model: snapshot.config.model, status: "RUNNING", total, processed, error: null, jobId: null };
      return { row: await tx.linkedInProfileReview.upsert({ where: { scope: fitScopeKey(scope) }, create: { ...data, scope: fitScopeKey(scope) }, update: data }), start: true };
    });
  } catch (error) { if (missingFitStorage(error)) throw new ActionError("Restart Dossier to apply the profile-matching database update."); throw error; }
  if (review.start) {
    const { queueProfileReview } = await import("./profile-fit-job");
    try { await queueProfileReview(review.row.id); }
    catch (error) {
      await prisma.linkedInProfileReview.updateMany({ where: { id: review.row.id, status: "RUNNING" }, data: { status: "FAILED", error: "Could not queue profile matching. Resume to retry." } });
      throw error;
    }
  }
  return readProfileFit(scope);
}
export async function stopProfileFit(scope: FitScope) {
  const run = await prisma.linkedInProfileReview.findUnique({ where: { scope: fitScopeKey(scope) } });
  if (run?.status === "RUNNING") {
    await prisma.linkedInProfileReview.updateMany({ where: { id: run.id, status: "RUNNING" }, data: { status: "CANCELLED" } });
    const { cancelJob, findUnfinishedJobs } = await import("@/lib/jobs/runner");
    for (const job of await findUnfinishedJobs(`linkedin-profile-fit:${run.scope}`)) await cancelJob(job.id);
  }
  return readProfileFit(scope);
}
export async function profileFitWhere(mode: FitFilter, profileHash: string): Promise<Prisma.LinkedInCampaignPostWhereInput | null> {
  if (mode === "all") return null;
  if (!prisma.linkedInProfileFit) return null;
  const negative = mode === "hide_unsuitable" || mode === "unassessed";
  const verdict = mode === "hide_unsuitable" ? "not_suitable" : mode === "unassessed" ? { not: "unavailable" } : mode;
  let fits;
  try { fits = await prisma.linkedInProfileFit.findMany({ where: { profileHash, verdict }, select: { key: true, postHash: true } }); }
  catch (error) { if (missingFitStorage(error)) return null; throw error; }
  if (!fits.length) return negative ? null : { id: { in: [] } };
  const matches: Prisma.LinkedInCampaignPostWhereInput = { OR: fits.map((fit) => ({ AND: [{ NOT: campaignDismissalFilter([fit.key]) }, { contentHash: fit.postHash }] })) };
  return negative ? { NOT: matches } : matches;
}
export const activeDismissals = async () => new Set(await dismissedPostKeys());
