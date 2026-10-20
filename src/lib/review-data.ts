import "server-only";

import { Prisma } from "@/generated/prisma/client";
import { emailParts } from "@/lib/application-email";
import { extractedSchema, unitsSchema } from "@/lib/application-data";
import { MISSING_APPLICATION_EMAIL } from "@/lib/automation/filter";
import { emailDiscoverySchema } from "@/lib/email-discovery-data";
import { prisma } from "@/lib/prisma";
import { REVIEW_PAGE_SIZE, type ReviewCandidateDetails, type ReviewListParams, type ReviewQueueItem } from "@/lib/review-list";

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
  if (params.matchBelow !== null) filters.push({ matchPercent: { lt: params.matchBelow } });
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

