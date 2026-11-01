import type { Metadata } from "next";
import { userTimeZone } from "@/lib/time-zone";
import { PageHeader } from "@/components/page-header";
import { apifyKeyState, listPostSearches } from "@/lib/linkedin-posts/searches";
import { LinkedInPostsScreen } from "./posts-screen";
import { dismissedPostKeys } from "@/lib/linkedin-posts/dismissals";
import { listCampaigns } from "@/lib/linkedin-posts/campaigns";

export const metadata: Metadata = { title: "LinkedIn posts" };
export default async function LinkedInPostsPage() {
  const [keyState, searches, campaigns, preferredTimeZone, dismissedKeys] = await Promise.all([apifyKeyState(), listPostSearches(), listCampaigns(), userTimeZone(), dismissedPostKeys()]);
  const timeZone = preferredTimeZone ?? Intl.DateTimeFormat().resolvedOptions().timeZone;
  return <>
    <PageHeader title="LinkedIn posts" description="Find opportunities announced in posts by companies, recruiters and hiring managers." />
    <LinkedInPostsScreen keyState={keyState} initialSearches={searches} initialCampaigns={campaigns} initialDismissedKeys={dismissedKeys} timeZone={timeZone} />
  </>;
}
