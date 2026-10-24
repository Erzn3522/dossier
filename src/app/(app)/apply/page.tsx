import type { Metadata } from "next";

import { PageHeader } from "@/components/page-header";
import { isAiConfigured } from "@/lib/ai/config";

import { QuickApplyForm } from "./quick-apply-form";

export const metadata: Metadata = { title: "Quick apply" };

/** A posting the user found themselves: its link or text in, a cover letter, CV advice and a ready email out. */
export default async function QuickApplyPage({ searchParams }: PageProps<"/apply">) {
  const { job } = await searchParams;
  return (
    <>
      <PageHeader
        title="Quick apply"
        description="Found a job yourself? Give me its link or paste the posting. I'll write a cover letter, tell you what to fix in your CV for it, and prepare an email you can send with Gmail."
      />
      <QuickApplyForm aiReady={await isAiConfigured()} jobId={typeof job === "string" ? job : null} />
    </>
  );
}
