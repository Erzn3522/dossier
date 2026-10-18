import "server-only";

import { AutomationRunStatus, PostingSource } from "@/generated/prisma/enums";
import { askSource } from "@/lib/job-search/find";
import { linkKey, postingKey, searchQuerySchema, type FoundPosting, type SearchQuery } from "@/lib/job-search/search";
import { prepareAutomationCandidateJob, automationCandidateJobKey } from "@/lib/jobs/prepare-automation-candidate";
import { startJob } from "@/lib/jobs/runner";
import { logServerError } from "@/lib/log";
import { postingStates, storePosting } from "@/lib/postings";
import { prisma } from "@/lib/prisma";
import { loadSettings, saveSettings } from "@/lib/settings-data";

import { type AutomationPagesPerRun, validAutomationPages } from "./pages";

export type AutomatedSearchView = {
  id: string;
  name: string;
  enabled: boolean;
  pagesPerRun: AutomationPagesPerRun;
  query: SearchQuery;
  lastRunAt: string | null;
};

export async function listAutomatedSearches(): Promise<AutomatedSearchView[]> {
  const rows = await prisma.automatedSearch.findMany({ orderBy: { createdAt: "asc" } });
  return rows.flatMap((row) => {
    const query = searchQuerySchema.safeParse(row.query);
    return query.success ? [{
      id: row.id,
      name: row.name,
      enabled: row.enabled,
      pagesPerRun: validAutomationPages(row.pagesPerRun),
      query: query.data,
      lastRunAt: row.lastRunAt?.toISOString() ?? null,
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
        const postings: FoundPosting[] = [];
        let next: string | null = null;
        for (let page = 0; page < validAutomationPages(search.pagesPerRun); page += 1) {
          const result = await askSource(query.data, { source: PostingSource.JSEARCH, next });
          if (!result.ok) throw new Error(result.message);
          postings.push(...result.postings);
          next = result.next;
          if (!next) break;
        }
        await prisma.automationRun.update({ where: { id: run.id }, data: { found: postings.length } });
        const states = await postingStates(postings);
        const existingLinks = new Set(
          (await prisma.posting.findMany({ where: { automationCandidate: { isNot: null } }, select: { url: true } }))
            .map((posting) => linkKey(posting.url))
            .filter(Boolean),
        );
        for (const posting of postings) {
          const state = states.get(postingKey(posting));
          const normalized = linkKey(posting.url);
          if (state?.dismissed || state?.applicationId || (normalized && existingLinks.has(normalized))) continue;
          const stored = await storePosting(posting);
          const candidate = await prisma.automationCandidate
            .create({ data: { runId: run.id, postingId: stored.id }, select: { id: true } })
            .catch(() => null);
          if (!candidate) continue;
          if (normalized) existingLinks.add(normalized);
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
