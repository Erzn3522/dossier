import "server-only";

import { AutomationRunStatus, PostingSource } from "@/generated/prisma/enums";
import type { Prisma } from "@/generated/prisma/client";
import { askSource } from "@/lib/job-search/find";
import { postingKey, searchQuerySchema, type FoundPosting, type SearchQuery } from "@/lib/job-search/search";
import { prepareAutomationCandidateJob, automationCandidateJobKey } from "@/lib/jobs/prepare-automation-candidate";
import { startJob } from "@/lib/jobs/runner";
import { logServerError } from "@/lib/log";
import { postingStates, storePosting } from "@/lib/postings";
import { prisma } from "@/lib/prisma";
import { loadSettings, saveSettings } from "@/lib/settings-data";

import { balancedPostings, postingFingerprints } from "./balance";
import { automationCandidateLimit, type AutomationPagesPerRun, validAutomationPages } from "./pages";

export const AUTOMATION_SOURCES = [
  PostingSource.JSEARCH, PostingSource.REMOTE_OK, PostingSource.REMOTIVE, PostingSource.WE_WORK_REMOTELY,
  PostingSource.HIMALAYAS, PostingSource.JOBICY, PostingSource.ARBEITNOW,
] as const;

export type AutomationSourceStat = { source: (typeof AUTOMATION_SOURCES)[number]; found: number; error: string | null };

export type AutomatedSearchView = {
  id: string;
  name: string;
  enabled: boolean;
  pagesPerRun: AutomationPagesPerRun;
  query: SearchQuery;
  lastRunAt: string | null;
  lastSourceStats: AutomationSourceStat[];
};

export async function listAutomatedSearches(): Promise<AutomatedSearchView[]> {
  const rows = await prisma.automatedSearch.findMany({
    orderBy: { createdAt: "asc" },
    include: { runs: { orderBy: { startedAt: "desc" }, take: 1, select: { sourceStats: true } } },
  });
  return rows.flatMap((row) => {
    const query = searchQuerySchema.safeParse(row.query);
    return query.success ? [{
      id: row.id,
      name: row.name,
      enabled: row.enabled,
      pagesPerRun: validAutomationPages(row.pagesPerRun),
      query: query.data,
      lastRunAt: row.lastRunAt?.toISOString() ?? null,
      lastSourceStats: parseSourceStats(row.runs[0]?.sourceStats),
    }] : [];
  });
}

export async function createAutomatedSearch(name: string, query: SearchQuery, pageCount: AutomationPagesPerRun = 1): Promise<string> {
  const row = await prisma.automatedSearch.create({
    data: { name: name.trim(), pagesPerRun: validAutomationPages(pageCount), query: searchQuerySchema.parse(query) },
    select: { id: true },
  });
  return row.id;
}

export async function setAutomatedSearchEnabled(id: string, enabled: boolean): Promise<void> {
  await prisma.automatedSearch.update({ where: { id }, data: { enabled } });
}

export async function setAutomatedSearchPages(id: string, pageCount: AutomationPagesPerRun): Promise<void> {
  await prisma.automatedSearch.update({ where: { id }, data: { pagesPerRun: validAutomationPages(pageCount) } });
}

export async function deleteAutomatedSearch(id: string): Promise<void> {
  await prisma.automatedSearch.delete({ where: { id } });
}

async function sourcePool(source: (typeof AUTOMATION_SOURCES)[number], query: SearchQuery, pages: AutomationPagesPerRun): Promise<FoundPosting[]> {
  const postings: FoundPosting[] = [];
  let next: string | null = null;
  const calls = pages;
  for (let page = 0; page < calls; page += 1) {
    const result = await askSource(query, { source, next });
    if (!result.ok) throw new Error(result.message);
    postings.push(...result.postings);
    next = result.next;
    if (!next) break;
  }
  return postings;
}

export function parseSourceStats(value: unknown): AutomationSourceStat[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    if (!item || typeof item !== "object") return [];
    const row = item as Record<string, unknown>;
    const source = AUTOMATION_SOURCES.find((candidate) => candidate === row.source);
    return source && typeof row.found === "number" && (typeof row.error === "string" || row.error === null)
      ? [{ source, found: row.found, error: row.error as string | null }] : [];
  });
}

async function findAutomationPostings(query: SearchQuery, pages: AutomationPagesPerRun): Promise<{ postings: FoundPosting[]; stats: AutomationSourceStat[] }> {
  const outcomes = await Promise.allSettled(AUTOMATION_SOURCES.map((source) => sourcePool(source, query, pages)));
  const stats: AutomationSourceStat[] = outcomes.map((outcome, index) => ({
    source: AUTOMATION_SOURCES[index],
    found: outcome.status === "fulfilled" ? outcome.value.length : 0,
    error: outcome.status === "rejected" ? (outcome.reason instanceof Error ? outcome.reason.message : "Search failed.").slice(0, 500) : null,
  }));
  const pools = outcomes.map((outcome, index) => {
    if (outcome.status === "fulfilled") return outcome.value;
    logServerError("automated search source", new Error(`${AUTOMATION_SOURCES[index]}: ${outcome.reason instanceof Error ? outcome.reason.message : "search failed"}`));
    return null;
  });
  return { postings: balancedPostings(pools.map((pool) => pool ?? []), automationCandidateLimit(pages)), stats };
}

/** Runs each selected profile once. An active run is a global lock for this single-server scheduler. */
export async function runAutomatedSearches(options: { searchId?: string; scheduled?: boolean } = {}): Promise<{ started: number; skipped: boolean }> {
  if (automationState.starting) return { started: 0, skipped: true };
  automationState.starting = true;
  try {
    const active = await prisma.automationRun.findFirst({ where: { status: AutomationRunStatus.RUNNING }, select: { id: true } });
    if (active) return { started: 0, skipped: true };
    if (options.scheduled && !(await loadSettings()).automationEnabled) return { started: 0, skipped: false };

    const searches = await prisma.automatedSearch.findMany({
      where: options.searchId ? { id: options.searchId } : { enabled: true },
      orderBy: { createdAt: "asc" },
    });
    let started = 0;
    let lastProblem: string | null = null;
    for (const search of searches) {
      const query = searchQuerySchema.safeParse(search.query);
      if (!query.success) continue;
      const run = await prisma.automationRun.create({ data: { searchId: search.id }, select: { id: true } });
      let runStarted = 0;
      try {
        const { postings, stats } = await findAutomationPostings(query.data, validAutomationPages(search.pagesPerRun));
        await prisma.automationRun.update({ where: { id: run.id }, data: { found: postings.length, sourceStats: stats as unknown as Prisma.InputJsonValue } });
        if (stats.every((stat) => stat.error)) throw new Error("None of the configured job sources answered. Try the search again later.");
        const states = await postingStates(postings);
        const existingFingerprints = new Set(
          (await prisma.posting.findMany({
            where: { OR: [{ automationCandidate: { isNot: null } }, { applicationId: { not: null } }, { dismissedAt: { not: null } }] },
            select: { source: true, externalId: true, url: true, company: true, title: true },
          })).flatMap(postingFingerprints),
        );
        for (const posting of postings) {
          const state = states.get(postingKey(posting));
          const fingerprints = postingFingerprints(posting);
          if (state?.dismissed || state?.applicationId || fingerprints.some((key) => existingFingerprints.has(key))) continue;
          const stored = await storePosting(posting);
          const candidate = await prisma.automationCandidate
            .create({ data: { runId: run.id, postingId: stored.id }, select: { id: true } })
            .catch(() => null);
          if (!candidate) continue;
          fingerprints.forEach((key) => existingFingerprints.add(key));
          await startJob(prepareAutomationCandidateJob, { candidateId: candidate.id }, { key: automationCandidateJobKey(candidate.id) });
          started += 1;
          runStarted += 1;
        }
        await prisma.automatedSearch.update({ where: { id: search.id }, data: { lastRunAt: new Date() } });
        if (runStarted === 0) {
          await prisma.automationRun.update({ where: { id: run.id }, data: { status: AutomationRunStatus.COMPLETE, finishedAt: new Date() } });
        }
      } catch (error) {
        const message = error instanceof Error ? error.message.slice(0, 500) : "The automated search failed.";
        lastProblem = message;
        await prisma.automationRun.update({ where: { id: run.id }, data: { status: AutomationRunStatus.FAILED, error: message, finishedAt: new Date() } });
        logServerError("automated search", error);
      }
    }
    await saveSettings({ automationProblem: lastProblem }).catch(() => {});
    return { started, skipped: false };
  } finally {
    automationState.starting = false;
  }
}

const globalAutomation = globalThis as unknown as { dossierAutomation?: { starting: boolean } };
const automationState = (globalAutomation.dossierAutomation ??= { starting: false });

/** Whether this server is in the middle of looking for postings (before the AI starts on them). */
export const isAutomationSearching = () => automationState.starting;

/** Converts jobs/runs left mid-flight by a restart into visible, retryable failures. */
export async function recoverInterruptedAutomations(): Promise<void> {
  const interrupted = await prisma.automationRun.findMany({ where: { status: AutomationRunStatus.RUNNING }, select: { id: true } });
  if (interrupted.length === 0) return;
  const ids = interrupted.map((run) => run.id);
  await prisma.$transaction([
    prisma.automationCandidate.updateMany({
      where: { runId: { in: ids }, status: { in: ["DISCOVERED", "ANALYZING", "PREPARING"] } },
      data: { status: "FAILED", error: "Dossier restarted before this application was ready. Retry it from Review." },
    }),
    prisma.automationRun.updateMany({
      where: { id: { in: ids } },
      data: { status: AutomationRunStatus.FAILED, error: "Dossier restarted before this run finished.", finishedAt: new Date() },
    }),
  ]);
}
