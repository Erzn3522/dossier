import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { PageHeader } from "@/components/page-header";
import { emailDiscoveryConfigured } from "@/lib/email-discovery/searxng";
import { gmailConnectionView } from "@/lib/gmail/client";
import { loadReviewPage } from "@/lib/review-data";
import { resolveReviewParams, reviewHref } from "@/lib/review-list";

import { ReviewQueue } from "./review-queue";

export const metadata: Metadata = { title: "Review" };

export default async function ReviewPage({ searchParams }: PageProps<"/review">) {
  const params = resolveReviewParams(await searchParams);
  const [queue, gmail] = await Promise.all([loadReviewPage(params), gmailConnectionView()]);
  if (queue.page !== params.page) redirect(reviewHref({ ...params, page: queue.page }));
  return (
    <>
      <PageHeader title="Review" description="Check each prepared application. Nothing is sent until you approve that email." />
      <ReviewQueue
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
