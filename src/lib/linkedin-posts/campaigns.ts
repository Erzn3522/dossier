import "server-only";

import { z } from "zod";
import { Prisma, type LinkedInCampaign, type LinkedInAttempt } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { ActionError } from "@/lib/action";
import { loadAiConfig } from "@/lib/ai/config";
import { loadApifyKey } from "./searches";
import { linkedInPostSchema } from "./data";
import { linkedInPostKey } from "./post-key";
import { fitSnapshot, fitsForPosts, profileFitWhere } from "./profile-fit-store";
import { campaignDismissalFilter, dismissedPostKeys } from "./dismissals";
import { CAMPAIGN_ACTIVE, campaignInputSchema, countryAssessmentSchema, occurrenceSchema, roundCap, roundOrder,
  type CampaignInput, type CampaignSummary, type CampaignView, type CampaignFilters } from "./campaign-data";

export function campaignSummary(row: LinkedInCampaign & { attempts: LinkedInAttempt[] }): CampaignSummary {
  return {
    id: row.id, input: campaignInputSchema.parse(row.input), provider: row.provider, model: row.model, status: row.status,
    error: row.error, createdAt: row.createdAt.toISOString(), completed: row.attempts.filter((a) => a.status === "COMPLETE").length,
    total: row.attempts.length, reservedUsd: row.attempts.filter((a) => a.runId || ["STARTING", "UNKNOWN"].includes(a.status)).reduce((sum, a) => sum + Number(a.capUsd), 0),
  };
}
export async function listCampaigns() {
  return (await prisma.linkedInCampaign.findMany({ orderBy: { createdAt: "desc" }, take: 50, include: { attempts: { orderBy: { position: "asc" } } } })).map(campaignSummary);
}
export async function campaignView(id: string, filters: CampaignFilters, page = 1): Promise<CampaignView> {
  const row = await prisma.linkedInCampaign.findUnique({ where: { id }, include: { attempts: { orderBy: { position: "asc" } } } });
  if (!row) throw new ActionError("That AI search no longer exists.");
  const and: Prisma.LinkedInCampaignPostWhereInput[] = [{ campaignId: id }];
  const dismissed = await dismissedPostKeys();
  if (dismissed.length) and.push(campaignDismissalFilter(dismissed));
  if (filters.text.trim()) and.push({ OR: [{ text: { contains: filters.text.trim(), mode: "insensitive" } }, { authorName: { contains: filters.text.trim(), mode: "insensitive" } }] });
  if (filters.location.trim()) and.push({ text: { contains: filters.location.trim(), mode: "insensitive" } });
  for (const word of filters.exclude.split(",").map((s) => s.trim()).filter(Boolean)) and.push({ NOT: { OR: [{ text: { contains: word, mode: "insensitive" } }, { authorName: { contains: word, mode: "insensitive" } }] } });
  if (filters.hiringOnly) and.push({ hiring: true });
  if (filters.remoteOnly) and.push({ remote: true });
  if (filters.authorType !== "all") and.push({ authorType: filters.authorType });
  if (filters.relevantOnly) and.push({ relevant: true });
  if (filters.confidence !== "all") and.push({ confidence: filters.confidence });
  const snapshot = await fitSnapshot();
  const fitWhere = await profileFitWhere(filters.profileFit ?? "all", snapshot.hash);
  if (fitWhere) and.push(fitWhere);
  const where = { AND: and };
  const [found, filtered] = await Promise.all([prisma.linkedInCampaignPost.count({ where: { campaignId: id } }), prisma.linkedInCampaignPost.count({ where })]);
  const pages = Math.max(1, Math.ceil(filtered / 20));
  page = Math.min(page, pages);
  const orderBy: Prisma.LinkedInCampaignPostOrderByWithRelationInput[] = filters.sort === "likes" ? [{ likes: "desc" }, { id: "asc" }]
    : filters.sort === "newest" ? [{ postedAt: { sort: "desc", nulls: "last" } }, { id: "asc" }] : [{ relevant: "desc" }, { createdAt: "asc" }, { id: "asc" }];
  const posts = await prisma.linkedInCampaignPost.findMany({ where, orderBy, skip: (page - 1) * 20, take: 20, omit: { contentHash: true } });
  const fits = await fitsForPosts(posts.map((post) => linkedInPostSchema.parse(post.post)), snapshot.hash);
  return { ...campaignSummary(row), found, filtered, page, pages,
    attempts: row.attempts.map((a) => ({ id: a.id, country: a.country, round: a.round, status: a.status, queries: z.array(z.string()).parse(a.queries), strategy: a.strategy,
      fetched: a.fetched, fresh: a.fresh, duplicates: a.duplicates, relevant: a.relevant, error: a.error, capUsd: Number(a.capUsd), runId: a.runId })),
    posts: posts.map((post) => ({ id: post.id, post: linkedInPostSchema.parse(post.post), assessments: countryAssessmentSchema.array().parse(post.assessments), occurrences: occurrenceSchema.array().parse(post.occurrences), profileFit: fits[linkedInPostKey(linkedInPostSchema.parse(post.post))] ?? null })),
  };
}
export async function startCampaign(input: CampaignInput) {
  input = campaignInputSchema.parse(input);
  input.countries = [...new Map(input.countries.map((country) => [country.toLocaleLowerCase(), country])).values()];
  await loadApifyKey();
  const ai = await loadAiConfig();
  if (!ai.model || ai.apiKeyProblem) throw new ActionError("Choose a working AI provider and model in Settings → AI provider first.");
  const cap = roundCap(input);
  if (cap < 0.001) throw new ActionError("Increase the budget or reduce the number of rounds; each round needs a cap of at least $0.001.");
  const row = await prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(710301)`;
    const [campaign, manual] = await Promise.all([
      tx.linkedInCampaign.findFirst({ where: { status: { in: CAMPAIGN_ACTIVE } } }),
      tx.linkedInPostSearch.findFirst({ where: { status: { in: ["STARTING", "RUNNING"] } } }),
    ]);
    if (campaign || manual) throw new ActionError("A LinkedIn search is already running. Finish or cancel it before starting another.");
    return tx.linkedInCampaign.create({ data: { input, provider: ai.provider, model: ai.model,
      attempts: { create: roundOrder(input).map((round, position) => ({ ...round, position, capUsd: cap })) },
    } });
  });
  const { startCampaignSchedule } = await import("./coordinator"); startCampaignSchedule();
  return { id: row.id };
}
export async function requestCampaignCancel(id: string) {
  await prisma.linkedInCampaign.updateMany({ where: { id, status: { in: ["RUNNING", "PAUSED", "FAILED"] } }, data: { status: "CANCELLING", error: null } });
  const { startCampaignSchedule } = await import("./coordinator"); startCampaignSchedule();
}
export async function resumeCampaign(id: string) {
  await prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(710301)`;
    const row = await tx.linkedInCampaign.findUnique({ where: { id }, include: { attempts: true } });
    if (!row || !["PAUSED", "FAILED"].includes(row.status)) throw new ActionError("Only a paused or failed AI search can be resumed.");
    if (row.attempts.some((a) => a.status === "UNKNOWN" || (a.status === "STARTING" && !a.runId))) throw new ActionError("A paid request was not confirmed. Check Apify Console; this search cannot safely repeat that request.");
    if (row.attempts.some((a) => a.status === "IMPORTED")) throw new ActionError("Imported AI searches are read-only. Use their topics and countries to start a new search.");
    if (await tx.linkedInCampaign.count({ where: { id: { not: id }, status: { in: CAMPAIGN_ACTIVE } } }) || await tx.linkedInPostSearch.count({ where: { status: { in: ["STARTING", "RUNNING"] } } })) throw new ActionError("Another LinkedIn search is running.");
    await tx.linkedInAttempt.updateMany({ where: { campaignId: id, status: "PLANNING" }, data: { status: "PENDING", jobId: null } });
    await tx.linkedInAttempt.updateMany({ where: { campaignId: id, status: "ANALYZING" }, data: { jobId: null } });
    await tx.linkedInCampaign.update({ where: { id }, data: { status: "RUNNING", error: null } });
  });
  const { startCampaignSchedule } = await import("./coordinator"); startCampaignSchedule();
}
