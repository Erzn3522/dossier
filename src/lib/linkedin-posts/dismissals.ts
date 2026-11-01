import "server-only";

import { prisma } from "@/lib/prisma";
import type { Prisma } from "@/generated/prisma/client";
import { ActionError } from "@/lib/action";
import { linkedInPostSchema, type LinkedInPost } from "./data";
import { linkedInPostKey } from "./post-key";

const missingTable = (error: unknown) => error !== null && typeof error === "object" && "code" in error && error.code === "P2021";
async function writeDismissal<T>(run: () => Promise<T>): Promise<T> {
  if (!prisma.linkedInPostDismissal) throw new ActionError("Restart Dossier to generate the updated database client and enable post dismissal.");
  try { return await run(); } catch (error) {
    if (missingTable(error)) throw new ActionError("Restart Dossier to apply the post-dismissal database update, then try again.");
    throw error;
  }
}

export async function dismissedPostKeys(): Promise<string[]> {
  if (!prisma.linkedInPostDismissal) return [];
  try { return (await prisma.linkedInPostDismissal.findMany({ select: { key: true } })).map((row) => row.key); }
  catch (error) {
    // Existing searches remain readable until the container applies the new migration.
    if (missingTable(error)) return [];
    throw error;
  }
}
/** Also match histories created/imported before campaign URLs were canonicalized. */
export function campaignDismissalFilter(keys: string[]): Prisma.LinkedInCampaignPostWhereInput {
  const matches: Prisma.LinkedInCampaignPostWhereInput[] = [{ url: { in: keys } }];
  for (const key of keys) {
    const id = key.match(/activity:(\d+)$/)?.[1];
    if (id) {
      matches.push({ post: { path: ["id"], equals: id } });
      matches.push({ post: { path: ["url"], string_contains: `activity-${id}-` } });
    }
    for (const url of [key, key.replace("www.linkedin.com", "linkedin.com")]) {
      matches.push({ url: { equals: `${url}/` } });
      matches.push({ post: { path: ["url"], equals: url } });
      matches.push({ post: { path: ["url"], string_starts_with: `${url}?` } });
      matches.push({ post: { path: ["url"], string_starts_with: `${url}/` } });
    }
  }
  return { NOT: { OR: matches } };
}
export async function dismissLinkedInPost(post: LinkedInPost) {
  const key = linkedInPostKey(post);
  await writeDismissal(() => prisma.linkedInPostDismissal.upsert({ where: { key }, create: { key, post }, update: { post } }));
  return { key };
}
export async function restoreLinkedInPost(key: string) {
  await writeDismissal(() => prisma.linkedInPostDismissal.deleteMany({ where: { key } }));
  return { key };
}
export async function listDismissedPosts(page: number) {
  const total = await writeDismissal(() => prisma.linkedInPostDismissal.count());
  const pages = Math.max(1, Math.ceil(total / 20));
  page = Math.min(page, pages);
  const rows = await prisma.linkedInPostDismissal.findMany({ orderBy: [{ dismissedAt: "desc" }, { key: "asc" }], skip: (page - 1) * 20, take: 20 });
  return { total, page, pages, posts: rows.map((row) => ({ key: row.key, post: linkedInPostSchema.parse(row.post), dismissedAt: row.dismissedAt.toISOString() })) };
}
