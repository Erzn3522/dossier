import "server-only";

import { Prisma } from "@/generated/prisma/client";
import { PostingSource } from "@/generated/prisma/enums";
import { isAutomationSearching, parseSourceStats } from "@/lib/automation/searches";
import { SOURCE_INFO } from "@/lib/job-search/sources";
import { emailParts } from "@/lib/application-email";
import { extractedSchema, unitsSchema } from "@/lib/application-data";
import { MISSING_APPLICATION_EMAIL } from "@/lib/automation/filter";
import { emailDiscoverySchema } from "@/lib/email-discovery-data";
import { prisma } from "@/lib/prisma";
import {
  REVIEW_PAGE_SIZE,
  type ReviewCandidateDetails,
  type ReviewFilterOptions,
  type ReviewListParams,
  type ReviewProgress,
  type ReviewQueueItem,
} from "@/lib/review-list";

const QUEUED = ["DISCOVERED", "ANALYZING", "PREPARING"] as const;

export function reviewBaseWhere(): Prisma.AutomationCandidateWhereInput {
  return {
    posting: { dismissedAt: null },
    OR: [
      { status: { in: ["DISCOVERED", "ANALYZING", "FILTERED", "PREPARING", "FAILED"] } },
      { status: "READY", application: { reviewState: "PENDING_REVIEW" } },
    ],
  };
}

function filteredWhere(params: ReviewListParams): Prisma.AutomationCandidateWhereInput {
  const filters: Prisma.AutomationCandidateWhereInput[] = [reviewBaseWhere()];
  if (params.status === "ready") filters.push({ status: "READY" });
  else if (params.status === "filtered") filters.push({ status: "FILTERED" });
  else if (params.status === "failed") filters.push({ status: "FAILED" });
  else if (params.status === "queued") filters.push({ status: { in: [...QUEUED] } });
  if (params.matchBelow !== null) filters.push({ matchPercent: { lt: params.matchBelow } });
  if (params.matchAtLeast !== null) filters.push({ matchPercent: { gte: params.matchAtLeast } });
  if (params.remote === "remote") filters.push({ posting: { remote: true } });
  if (params.remote === "onsite") filters.push({ posting: { OR: [{ remote: false }, { remote: null }] } });
  if (params.source && params.source in PostingSource) filters.push({ posting: { source: params.source as PostingSource } });
  if (params.searchId) filters.push({ run: { searchId: params.searchId } });
  if (params.q) {
    const contains = { contains: params.q, mode: "insensitive" as const };
    filters.push({ posting: { OR: [{ company: contains }, { title: contains }, { place: contains }] } });
  }
  if (params.email !== "all") {
    filters.push({
      status: "FILTERED",
      reason: MISSING_APPLICATION_EMAIL,
      discoveredEmailCount: params.email === "found" ? { gt: 0 } : 0,
    });
  }
  return { AND: filters };
}

function orderBy(sort: ReviewListParams["sort"]): Prisma.AutomationCandidateOrderByWithRelationInput[] {
  if (sort === "oldest") return [{ createdAt: "asc" }, { id: "asc" }];
  if (sort === "company") return [{ posting: { company: "asc" } }, { posting: { title: "asc" } }, { id: "desc" }];
  if (sort === "lowest") return [{ matchPercent: { sort: "asc", nulls: "last" } }, { createdAt: "desc" }, { id: "desc" }];
  if (sort === "highest") return [{ matchPercent: { sort: "desc", nulls: "last" } }, { createdAt: "desc" }, { id: "desc" }];
  return [{ createdAt: "desc" }, { id: "desc" }];
}

export async function loadReviewPage(requested: ReviewListParams) {
  const where = filteredWhere(requested);
  const [total, filtered] = await Promise.all([
    prisma.automationCandidate.count({ where: reviewBaseWhere() }),
    prisma.automationCandidate.count({ where }),
  ]);
  const pages = Math.max(1, Math.ceil(filtered / REVIEW_PAGE_SIZE));
  const page = Math.min(requested.page, pages);
  const candidates = filtered === 0 ? [] : await prisma.automationCandidate.findMany({
    where,
    orderBy: orderBy(requested.sort),
    skip: (page - 1) * REVIEW_PAGE_SIZE,
    take: REVIEW_PAGE_SIZE,
    select: {
      id: true,
      applicationId: true,
      status: true,
      matchPercent: true,
      reason: true,
      error: true,
      recipientOverride: true,
      emailDiscovery: true,
      posting: { select: { company: true, title: true, place: true, remote: true, url: true, source: true } },
      run: { select: { search: { select: { name: true } } } },
      application: { select: { emailDelivery: { select: { status: true } } } },
    },
  });
  const items: ReviewQueueItem[] = candidates.map((candidate) => {
    const discovery = emailDiscoverySchema.safeParse(candidate.emailDiscovery);
    return {
      id: candidate.id,
      applicationId: candidate.applicationId,
      status: candidate.status,
      score: candidate.matchPercent,
      issue: candidate.error ?? candidate.reason,
      canProvideRecipient: candidate.status === "FILTERED" && candidate.reason === MISSING_APPLICATION_EMAIL,
      recipientOverride: candidate.recipientOverride ?? "",
      company: candidate.posting.company,
      role: candidate.posting.title,
      place: candidate.posting.place,
      remote: candidate.posting.remote,
      postingUrl: candidate.posting.url,
      source: `${candidate.run.search.name} · ${candidate.posting.source}`,
      delivery: candidate.application?.emailDelivery?.status ?? null,
      discoveredEmails: discovery.success ? discovery.data.candidates : [],
      emailDiscoveryError: discovery.success ? discovery.data.error : null,
      emailDiscoverySearched: discovery.success,
    };
  });
  return { items, total, filtered, page, pages, pageSize: REVIEW_PAGE_SIZE };
}

export async function loadReviewCandidateDetails(candidateId: string): Promise<ReviewCandidateDetails | null> {
  const candidate = await prisma.automationCandidate.findFirst({
    where: { AND: [{ id: candidateId }, reviewBaseWhere()] },
    select: {
      posting: { select: { description: true } },
      application: {
        select: {
          extracted: true,
          documents: { where: { kind: "EMAIL" }, take: 1, select: { units: true } },
        },
      },
    },
  });
  if (!candidate) return null;
  const extracted = extractedSchema.safeParse(candidate.application?.extracted);
  const units = unitsSchema.safeParse(candidate.application?.documents[0]?.units);
  return {
    postingText: candidate.posting.description,
    mandatory: extracted.success ? extracted.data.requirements.filter((requirement) => requirement.required).map((requirement) => requirement.text) : [],
    email: units.success ? emailParts(units.data) : null,
  };
}


export async function loadReviewFilterOptions(): Promise<ReviewFilterOptions> {
  const [searches, sources, counts] = await Promise.all([
    prisma.automatedSearch.findMany({ orderBy: { name: "asc" }, select: { id: true, name: true } }),
    prisma.posting.findMany({ where: { automationCandidate: { isNot: null } }, distinct: ["source"], select: { source: true } }),
    prisma.automationCandidate.groupBy({ by: ["status"], where: reviewBaseWhere(), _count: { _all: true } }),
  ]);
  const count = (...statuses: string[]) => counts.filter((row) => statuses.includes(row.status)).reduce((sum, row) => sum + row._count._all, 0);
  return {
    searches: searches.map(({ id, name }) => ({ value: id, label: name })),
    sources: sources.map(({ source }) => ({ value: source, label: SOURCE_INFO[source].name })).sort((a, b) => a.label.localeCompare(b.label)),
    statusCounts: { ready: count("READY"), filtered: count("FILTERED"), failed: count("FAILED"), queued: count(...QUEUED) },
  };
}

/** Progress of the automation batch in flight, or null when the AI has nothing left to do. */
export async function loadReviewProgress(): Promise<ReviewProgress | null> {
  const searching = isAutomationSearching();
  const running = await prisma.automationRun.findFirst({ where: { status: "RUNNING" }, orderBy: { startedAt: "asc" }, select: { startedAt: true } });
  if (!running && !searching) return null;
  const since = running?.startedAt ?? new Date(Date.now() - 12 * 3_600_000);
  const [runs, profilesTotal, byStatus, durations] = await Promise.all([
    prisma.automationRun.findMany({ where: { startedAt: { gte: since } }, select: { found: true, sourceStats: true } }),
    prisma.automatedSearch.count({ where: { enabled: true } }),
    prisma.automationCandidate.groupBy({ by: ["status"], where: { run: { startedAt: { gte: since } } }, _count: { _all: true } }),
    prisma.$queryRaw<{ seconds: number | null }[]>`
      SELECT AVG(EXTRACT(EPOCH FROM ("finishedAt" - "startedAt")))::float AS seconds FROM "Job"
      WHERE type = 'prepare-automation-candidate' AND status = 'DONE' AND "finishedAt" >= ${since}`,
  ]);
  const count = (...statuses: string[]) => byStatus.filter((row) => statuses.includes(row.status)).reduce((sum, row) => sum + row._count._all, 0);
  const candidates = byStatus.reduce((sum, row) => sum + row._count._all, 0);
  const pending = count(...QUEUED);
  if (pending === 0 && !searching) return null;
  const seconds = durations[0]?.seconds ?? null;
  return {
    searching,
    profilesSearched: runs.length,
    profilesTotal,
    scanned: runs.reduce((sum, run) => {
      const stats = parseSourceStats(run.sourceStats);
      return sum + (stats.length > 0 ? stats.reduce((total, stat) => total + stat.found, 0) : run.found);
    }, 0),
    candidates,
    analyzed: candidates - pending,
    analyzing: count("ANALYZING", "PREPARING"),
    etaMinutes: seconds && pending > 0 ? Math.max(1, Math.round((seconds * pending) / 60)) : null,
  };
}
