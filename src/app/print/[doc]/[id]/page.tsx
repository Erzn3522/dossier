import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { TailoredLetter, TailoredResume } from "@/components/documents/tailored-documents";
import { ResumeDocument } from "@/components/documents/resume-document";
import { unitsSchema } from "@/lib/application-data";
import { loadDocuments } from "@/lib/application-documents";
import { verifyPrintAccess } from "@/lib/pdf/print-access";
import { prisma } from "@/lib/prisma";
import { loadProfile } from "@/lib/profile-data";
import { loadSettings } from "@/lib/settings-data";
import { loadTheme } from "@/lib/theme-data";
import { BUILT_IN_THEMES, printCss } from "@/lib/themes";

export const metadata: Metadata = { title: "Tailored document", robots: { index: false } };

/**
 * An application's tailored resume (/print/resume/{id}) or cover letter
 * (/print/letter/{id}) on its own, for the PDF renderer (E8-8) to print.
 */
export default async function PrintTailoredDocumentPage({ params }: PageProps<"/print/[doc]/[id]">) {
  const { doc, id } = await params;
  if (doc !== "resume" && doc !== "letter" && doc !== "outreach-resume") notFound();
  await verifyPrintAccess(`/print/${doc}/${id}`);
  if (doc === "outreach-resume") {
    const [lead, profile, settings] = await Promise.all([
      prisma.outreachLead.findUnique({ where: { id }, select: { resumeUnits: true, campaign: { select: { language: true } } } }),
      loadProfile(),
      loadSettings(),
    ]);
    const units = unitsSchema.safeParse(lead?.resumeUnits);
    if (!lead || !units.success) notFound();
    const theme = (await loadTheme(settings.baseThemeId)) ?? BUILT_IN_THEMES[0];
    return (
      <>
        <style>{printCss(theme, settings.paper)}</style>
        <ResumeDocument theme={theme} profile={profile} paper={settings.paper} units={units.data} language={lead.campaign.language} includeReferences={false} />
      </>
    );
  }
  const { application, profile, settings, resume, letter, includeReferences, letterDate } = await loadDocuments(id);
  const document = doc === "resume" ? resume : letter;
  if (!document) notFound();

  return (
    <>
      <style>{printCss(document.theme, settings.paper)}</style>
      {doc === "resume" ? (
        <TailoredResume
          resume={document}
          profile={profile}
          paper={settings.paper}
          followThemeLayout={application.followThemeLayout}
          language={application.language}
          includeReferences={includeReferences}
        />
      ) : (
        <TailoredLetter
          letter={document}
          profile={profile}
          paper={settings.paper}
          company={application.company}
          location={application.location}
          tone={application.tone}
          date={letterDate}
          dateFormat={settings.dateFormat}
          language={application.language}
        />
      )}
    </>
  );
}
