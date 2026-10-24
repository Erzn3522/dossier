import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { PageHeader } from "@/components/page-header";
import { emailDiscoveryConfigured } from "@/lib/email-discovery/searxng";
import { gmailConnectionView } from "@/lib/gmail/client";
import { loadReviewFilterOptions, loadReviewPage, loadReviewProgress } from "@/lib/review-data";
import { resolveReviewParams, reviewHref } from "@/lib/review-list";

import { ReviewProgressPanel } from "./review-progress";
import { ReviewQueue } from "./review-queue";

export const metadata: Metadata = { title: "Review" };

export default async function ReviewPage({ searchParams }: PageProps<"/review">) {
  const params = resolveReviewParams(await searchParams);
  const [queue, gmail, options, progress] = await Promise.all([loadReviewPage(params), gmailConnectionView(), loadReviewFilterOptions(), loadReviewProgress()]);
  if (queue.page !== params.page) redirect(reviewHref({ ...params, page: queue.page }));
  return (
    <>
      <PageHeader title="Review" description="Check each prepared application. Nothing is sent until you approve that email." />
      <ReviewProgressPanel progress={progress} />
      <ReviewQueue
        options={options}
        items={queue.items}
        params={params}
        total={queue.total}
        filtered={queue.filtered}
        page={queue.page}
        pages={queue.pages}
        pageSize={queue.pageSize}
        gmail={gmail}
        emailSearchConfigured={emailDiscoveryConfigured()}
      />
    </>
  );
}
