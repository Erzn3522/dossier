import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { PageHeader } from "@/components/page-header";
import { DocumentKind } from "@/generated/prisma/enums";
import { matchSchema, matchScore, unitsSchema } from "@/lib/application-data";
import { readJson } from "@/lib/application-documents";
import { emailParts } from "@/lib/application-email";
import { gmailConnectionView } from "@/lib/gmail/client";
import { isParagraph } from "@/lib/letter-frame";
import { prisma } from "@/lib/prisma";
import { resumeAdviceSchema } from "@/lib/resume-advice";

import { QuickApplyResult } from "./quick-apply-result";

export const metadata: Metadata = { title: "Quick apply" };

/** Quick apply's result: what to fix in the CV, the cover letter, and the email to send with Gmail. */
export default async function QuickApplyResultPage({ params }: PageProps<"/apply/[id]">) {
  const { id } = await params;
  const [application, gmail] = await Promise.all([
    prisma.application.findUnique({
      where: { id },
      select: {
        id: true, title: true, company: true, role: true, postingUrl: true, match: true, resumeAdvice: true,
        documents: { select: { kind: true, units: true } },
        emailDelivery: { select: { status: true, recipient: true, sentAt: true, error: true } },
      },
    }),
    gmailConnectionView(),
  ]);
  if (!application) notFound();
  const units = (kind: DocumentKind) => readJson(unitsSchema, application.documents.find((document) => document.kind === kind)?.units) ?? [];
  const match = readJson(matchSchema, application.match);
  const score = match ? matchScore(match) : null;
  const heading = [application.role, application.company].filter(Boolean).join(" at ") || application.title || "Your application";

  return (
    <>
      <PageHeader title={heading} description="Check what to fix in your CV, read the cover letter, then send it with Gmail when it's right." />
      <QuickApplyResult
        applicationId={application.id}
        postingUrl={application.postingUrl}
        score={score && score.total > 0 ? { ...score, percent: Math.round((score.hit / score.total) * 100) } : null}
        gaps={match?.items.filter((item) => item.result === "gap").length ?? 0}
        advice={readJson(resumeAdviceSchema, application.resumeAdvice) ?? []}
        letter={units(DocumentKind.COVER_LETTER).filter(isParagraph).map((unit) => unit.text)}
        email={emailParts(units(DocumentKind.EMAIL))}
        delivery={application.emailDelivery && { ...application.emailDelivery, sentAt: application.emailDelivery.sentAt?.toISOString() ?? null }}
        gmail={{ configured: gmail.configured, email: gmail.email }}
      />
    </>
  );
}
