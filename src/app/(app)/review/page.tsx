import type { Metadata } from "next";

import { PageHeader } from "@/components/page-header";
import { emailParts } from "@/lib/application-email";
import { extractedSchema, unitsSchema } from "@/lib/application-data";
import { MISSING_APPLICATION_EMAIL } from "@/lib/automation/filter";
import { gmailConnectionView } from "@/lib/gmail/client";
import { prisma } from "@/lib/prisma";

import { ReviewQueue } from "./review-queue";

export const metadata: Metadata = { title: "Review" };

export default async function ReviewPage() {
  const [candidates, gmail] = await Promise.all([
    prisma.automationCandidate.findMany({
      where: {
        posting: { dismissedAt: null },
        OR: [
          { status: { in: ["DISCOVERED", "ANALYZING", "FILTERED", "PREPARING", "FAILED"] } },
          { status: "READY", application: { reviewState: "PENDING_REVIEW" } },
        ],
      },
      include: {
        posting: true,
        run: { include: { search: true } },
        application: { include: { documents: true, emailDelivery: true } },
      },
      orderBy: { createdAt: "desc" },
    }),
    gmailConnectionView(),
  ]);
  const items = candidates.map((candidate) => {
    const email = candidate.application?.documents.find((document) => document.kind === "EMAIL");
    const units = unitsSchema.safeParse(email?.units);
    const parts = units.success ? emailParts(units.data) : { to: "", subject: "", body: "" };
    const extracted = extractedSchema.safeParse(candidate.application?.extracted);
    return {
      id: candidate.id,
      applicationId: candidate.applicationId,
      status: candidate.status,
      score: candidate.matchTotal ? Math.round(((candidate.matchHit ?? 0) / candidate.matchTotal) * 100) : null,
      issue: candidate.error ?? candidate.reason,
      canProvideRecipient: candidate.status === "FILTERED" && candidate.reason === MISSING_APPLICATION_EMAIL,
      recipientOverride: candidate.recipientOverride ?? "",
      company: candidate.posting.company,
      role: candidate.posting.title,
      place: candidate.posting.place,
      remote: candidate.posting.remote,
      postingUrl: candidate.posting.url,
      postingText: candidate.posting.description,
      source: `${candidate.run.search.name} · ${candidate.posting.source}`,
      mandatory: extracted.success ? extracted.data.requirements.filter((requirement) => requirement.required).map((requirement) => requirement.text) : [],
      to: parts.to,
      subject: parts.subject,
      body: parts.body,
      delivery: candidate.application?.emailDelivery?.status ?? null,
    };
  });
  return (
    <>
      <PageHeader title="Review" description="Check each prepared application. Nothing is sent until you approve that email." />
      <ReviewQueue items={items} gmail={gmail} />
    </>
  );
}
