import "server-only";

import { Prisma, type LinkedInPostSearch } from "@/generated/prisma/client";
import { ActionError } from "@/lib/action";
import { prisma } from "@/lib/prisma";
import { APIFY_API_KEY, decryptSecret, secretState } from "@/lib/secrets";
import { loadSettings } from "@/lib/settings-data";
import { ACTOR, actorInput, apifyRequest, parsePosts, parseRun } from "./apify";
import { isSearching, linkedInPostSchema, postSearchSchema, type PostSearchQuery, type PostSearchView } from "./data";

export async function apifyKeyState() {
  return secretState(APIFY_API_KEY, (await loadSettings()).apifyKeyEnc);
}
export async function loadApifyKey() {
  const stored = (await loadSettings()).apifyKeyEnc;
  if (!stored) throw new ActionError("Add an Apify API token in Settings → LinkedIn posts first.");
  try { return decryptSecret(APIFY_API_KEY, stored); }
  catch { throw new ActionError("Your saved Apify token could not be read. Enter it again in Settings → LinkedIn posts."); }
}
export function searchView(row: LinkedInPostSearch): PostSearchView {
  return {
    id: row.id, query: postSearchSchema.parse(row.query), posts: linkedInPostSchema.array().parse(row.posts),
    status: row.status, error: row.error, createdAt: row.createdAt.toISOString(),
  };
}
export async function listPostSearches() {
  // History summaries don't send every search's full post text to the browser.
  const rows = await prisma.linkedInPostSearch.findMany({ orderBy: { createdAt: "desc" }, take: 50 });
  return rows.map((row) => ({ ...searchView({ ...row, posts: [] }), count: Array.isArray(row.posts) ? row.posts.length : 0 }));
}
export async function getPostSearch(id: string) {
  const row = await prisma.linkedInPostSearch.findUnique({ where: { id } });
  if (!row) throw new ActionError("That post search no longer exists.");
  return row;
}
export async function startPostSearch(query: PostSearchQuery): Promise<PostSearchView> {
  const key = await loadApifyKey();
  // Serialize starts across requests/processes: a double-click cannot create two paid runs.
  const row = await prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(710301)`;
    const active = await tx.linkedInPostSearch.findFirst({ where: { status: { in: ["STARTING", "RUNNING"] } } });
    if (active) throw new ActionError("A post search is already running. Open it in Search history before starting another.");
    if (await tx.linkedInCampaign.count({ where: { status: { in: ["RUNNING", "CANCELLING"] } } })) throw new ActionError("An AI search campaign is running. Finish or cancel it first.");
    return tx.linkedInPostSearch.create({ data: { query } });
  });
  try {
    const run = parseRun(await apifyRequest(key, `/actors/${ACTOR}/runs?timeout=600&maxItems=200&maxTotalChargeUsd=1&restartOnError=false`, actorInput(query)));
    return searchView(await prisma.linkedInPostSearch.update({ where: { id: row.id }, data: { runId: run.id, status: "RUNNING" } }));
  } catch (error) {
    await prisma.linkedInPostSearch.update({ where: { id: row.id }, data: {
      status: "FAILED", error: error instanceof ActionError ? error.message : "The search could not start. Check Apify Console before retrying.",
    } });
    throw error;
  }
}

/** Polling only checks a previously created run; it never starts or retries a paid run. */
export async function refreshPostSearch(id: string): Promise<PostSearchView> {
  const row = await getPostSearch(id);
  if (!isSearching(row.status)) return searchView(row);
  if (!row.runId) {
    if (Date.now() - row.createdAt.getTime() < 60_000) return searchView(row);
    return searchView(await prisma.linkedInPostSearch.update({ where: { id }, data: {
      status: "FAILED", error: "Apify did not confirm this run. Check Apify Console before starting another search.",
    } }));
  }
  const key = await loadApifyKey();
  const run = parseRun(await apifyRequest(key, `/actor-runs/${encodeURIComponent(row.runId)}`));
  if (["READY", "RUNNING", "TIMING-OUT", "ABORTING"].includes(run.status)) return searchView(row);
  const succeeded = run.status === "SUCCEEDED";
  const posts = run.defaultDatasetId
    ? parsePosts(await apifyRequest(key, `/datasets/${encodeURIComponent(run.defaultDatasetId)}/items?format=json&clean=true&limit=200`)) : [];
  if (succeeded && !run.defaultDatasetId) throw new ActionError("Apify finished without a results dataset. Check the run in Apify Console.");
  return searchView(await prisma.linkedInPostSearch.update({ where: { id }, data: {
    status: succeeded ? "SUCCEEDED" : run.status === "ABORTED" ? "ABORTED" : "FAILED",
    posts: posts as unknown as Prisma.InputJsonValue,
    error: succeeded ? null : `Apify ended this run (${run.status}). Any available partial results are shown.`,
  } }));
}

export async function cancelPostSearch(id: string) {
  const row = await getPostSearch(id);
  if (!isSearching(row.status)) return searchView(row);
  if (row.runId) {
    await apifyRequest(await loadApifyKey(), `/actor-runs/${encodeURIComponent(row.runId)}/abort`, {});
    return refreshPostSearch(id);
  }
  if (Date.now() - row.createdAt.getTime() < 60_000) throw new ActionError("The search is still starting. Wait a moment before cancelling.");
  return refreshPostSearch(id);
}
