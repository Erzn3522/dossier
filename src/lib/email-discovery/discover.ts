import "server-only";

import type { AIProvider } from "@/lib/ai";
import { rankApplicationEmails, type EmailEvidence, type TaskOptions } from "@/lib/ai/tasks";
import { isEmailAddress } from "@/lib/application-email";
import {
  emailDiscoverySchema,
  type DiscoveredEmail,
  type EmailConfidence,
  type EmailDiscovery,
} from "@/lib/email-discovery-data";
import { logServerError } from "@/lib/log";
import { fetchPublicPage } from "@/lib/posting-fetch";

import { EmailSearchUnavailable, searchWeb, type WebSearchResult } from "./searxng";

const MAX_RESULTS = 8;
const MAX_CANDIDATES = 8;
const EMAIL = /[A-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Z0-9](?:[A-Z0-9-]{0,61}[A-Z0-9])?(?:\.[A-Z0-9](?:[A-Z0-9-]{0,61}[A-Z0-9])?)+/gi;
const JOB_WORDS = /\b(job|jobs|career|careers|recruit|recruiting|recruitment|talent|hiring|application|apply|vacanc|hr|human resources|people team)\b/i;
const JOB_MAILBOX = /^(job|jobs|career|careers|recruit|recruiting|recruitment|talent|hiring|application|applications|apply|hr|people)([._+-].*)?$/i;
const REFUSED_MAILBOX = /^(no-?reply|do-?not-?reply|privacy|security|abuse|billing|invoice|press|media|sales)([._+-].*)?$/i;
const JOB_BOARD = /(^|\.)(linkedin|indeed|glassdoor|stepstone|xing|monster|adzuna|ziprecruiter|jobrapido|jooble)\./i;

type PageReader = typeof fetchPublicPage;

export type DiscoveryInput = {
  company: string;
  role: string;
  postingUrl: string;
};

type DiscoveryDependencies = {
  search?: typeof searchWeb;
  readPage?: PageReader;
  now?: Date;
};

/** Finds explicit public addresses, then lets the configured model rank only those addresses. */
export async function discoverApplicationEmails(
  provider: AIProvider,
  input: DiscoveryInput,
  options: TaskOptions,
  dependencies: DiscoveryDependencies = {},
): Promise<EmailDiscovery> {
  const searchedAt = (dependencies.now ?? new Date()).toISOString();
  const search = dependencies.search ?? searchWeb;
  const readPage = dependencies.readPage ?? fetchPublicPage;
  const queries = discoveryQueries(input);
  let results: WebSearchResult[];
  try {
    results = uniqueResults((await Promise.all(queries.map((query) => search(query, { signal: options.signal })))).flat()).slice(0, MAX_RESULTS);
  } catch (error) {
    if (options.signal?.aborted) throw error;
    if (!(error instanceof EmailSearchUnavailable)) logServerError("application email search", error);
    return emailDiscoverySchema.parse({
      searchedAt,
      queryCount: queries.length,
      pagesRead: 0,
      rankedWith: null,
      candidates: [],
      error: error instanceof EmailSearchUnavailable ? error.message : "Searching for a public application email failed.",
    });
  }

  const pages = await Promise.all(results.map(async (result) => ({ result, page: await readPage(result.url, { signal: options.signal }) })));
  const employerHost = employerSiteHost(input.postingUrl);
  const evidence = deduplicateEvidence(
    pages.flatMap(({ result, page }) => page.ok ? evidenceFromPage(result, page.text, page.url, employerHost) : []),
  ).slice(0, MAX_CANDIDATES);
  if (evidence.length === 0) {
    return emailDiscoverySchema.parse({
      searchedAt,
      queryCount: queries.length,
      pagesRead: pages.filter(({ page }) => page.ok).length,
      rankedWith: null,
      candidates: [],
      error: null,
    });
  }

  let candidates: DiscoveredEmail[];
  let rankedWith: string | null = null;
  try {
    const ranked = await rankApplicationEmails(provider, { company: input.company, role: input.role, candidates: evidence }, options);
    rankedWith = ranked.promptVersion;
    const used = new Set<number>();
    candidates = ranked.data.map((ranking) => {
      used.add(ranking.candidate);
      const candidate = evidence[ranking.candidate];
      return discovered(candidate, cappedConfidence(ranking.confidence, candidate.suggestedConfidence), ranking.reason);
    });
    evidence.forEach((candidate, index) => {
      if (!used.has(index)) candidates.push(discovered(candidate, candidate.suggestedConfidence, fallbackReason(candidate)));
    });
  } catch (error) {
    if (options.signal?.aborted) throw error;
    logServerError("ranking application emails", error);
    candidates = evidence.map((candidate) => discovered(candidate, candidate.suggestedConfidence, fallbackReason(candidate)));
  }

  return emailDiscoverySchema.parse({
    searchedAt,
    queryCount: queries.length,
    pagesRead: pages.filter(({ page }) => page.ok).length,
    rankedWith,
    candidates,
    error: null,
  });
}

export function discoveryQueries({ company, role, postingUrl }: DiscoveryInput): string[] {
  const name = company.replace(/["\r\n]/g, " ").replace(/\s+/g, " ").trim().slice(0, 120);
  const job = role.replace(/["\r\n]/g, " ").replace(/\s+/g, " ").trim().slice(0, 120);
  if (!name) return [];
  const queries = [
    `"${name}" careers email`,
    `"${name}" recruiting contact email`,
    `"${name}" "${job || "jobs"}" application email`,
  ];
  try {
    const host = new URL(postingUrl).hostname.toLowerCase().replace(/^www\./, "");
    if (host && !JOB_BOARD.test(`${host}.`)) queries.unshift(`site:${host} (careers OR jobs OR recruiting) email`);
  } catch {
    // A missing or non-web posting URL simply cannot provide a site query.
  }
  return [...new Set(queries)];
}

function uniqueResults(results: WebSearchResult[]): WebSearchResult[] {
  const seen = new Set<string>();
  return results.filter((result) => {
    try {
      const url = new URL(result.url);
      url.hash = "";
      const key = url.toString();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    } catch {
      return false;
    }
  });
}

function evidenceFromPage(result: WebSearchResult, text: string, finalUrl: string, employerHost: string | null): EmailEvidence[] {
  const found: EmailEvidence[] = [];
  for (const match of text.matchAll(EMAIL)) {
    const email = match[0].replace(/[),.;:]+$/, "");
    const local = email.split("@", 1)[0];
    if (!isEmailAddress(email) || REFUSED_MAILBOX.test(local)) continue;
    const start = Math.max(0, (match.index ?? 0) - 140);
    const end = Math.min(text.length, (match.index ?? 0) + email.length + 140);
    const context = text.slice(start, end).replace(/\s+/g, " ").trim();
    const official = emailMatchesSource(email, finalUrl);
    const knownEmployerSite = employerHost !== null && sameSite(new URL(finalUrl).hostname, employerHost);
    const jobRelated = JOB_MAILBOX.test(local) || JOB_WORDS.test(`${result.title} ${context}`);
    const suggestedConfidence: EmailConfidence = knownEmployerSite && official && jobRelated ? "HIGH" : official && jobRelated ? "MEDIUM" : "LOW";
    found.push({ email: email.toLowerCase(), sourceUrl: finalUrl, sourceTitle: result.title.trim(), context, suggestedConfidence });
  }
  return found;
}

/** The model may lower heuristic confidence, but it cannot promote weak source evidence. */
function cappedConfidence(ranked: EmailConfidence, ceiling: EmailConfidence): EmailConfidence {
  const confidence = { HIGH: 3, MEDIUM: 2, LOW: 1 } satisfies Record<EmailConfidence, number>;
  return confidence[ranked] <= confidence[ceiling] ? ranked : ceiling;
}

function employerSiteHost(postingUrl: string): string | null {
  try {
    const host = new URL(postingUrl).hostname.toLowerCase().replace(/^www\./, "");
    return host && !JOB_BOARD.test(`${host}.`) ? host : null;
  } catch {
    return null;
  }
}

function sameSite(left: string, right: string): boolean {
  const a = left.toLowerCase().replace(/^www\./, "");
  const b = right.toLowerCase().replace(/^www\./, "");
  return a === b || a.endsWith(`.${b}`) || b.endsWith(`.${a}`);
}

function emailMatchesSource(email: string, sourceUrl: string): boolean {
  try {
    const emailDomain = email.slice(email.lastIndexOf("@") + 1).toLowerCase();
    const host = new URL(sourceUrl).hostname.toLowerCase().replace(/^www\./, "");
    return host === emailDomain || host.endsWith(`.${emailDomain}`) || emailDomain.endsWith(`.${host}`);
  } catch {
    return false;
  }
}

function deduplicateEvidence(candidates: EmailEvidence[]): EmailEvidence[] {
  const confidence = { HIGH: 3, MEDIUM: 2, LOW: 1 } satisfies Record<EmailConfidence, number>;
  const best = new Map<string, EmailEvidence>();
  for (const candidate of candidates) {
    const previous = best.get(candidate.email);
    if (!previous || confidence[candidate.suggestedConfidence] > confidence[previous.suggestedConfidence]) best.set(candidate.email, candidate);
  }
  return [...best.values()].sort((left, right) => confidence[right.suggestedConfidence] - confidence[left.suggestedConfidence]);
}

function discovered(candidate: EmailEvidence, confidence: EmailConfidence, reason: string): DiscoveredEmail {
  return {
    email: candidate.email,
    sourceUrl: candidate.sourceUrl,
    sourceTitle: candidate.sourceTitle || new URL(candidate.sourceUrl).hostname,
    context: candidate.context.slice(0, 320),
    confidence,
    reason: reason.replace(/\s+/g, " ").trim().slice(0, 240) || fallbackReason(candidate),
  };
}

function fallbackReason(candidate: EmailEvidence): string {
  if (candidate.suggestedConfidence === "HIGH") return "The address appears on the same organisation's site in a hiring-related context.";
  if (candidate.suggestedConfidence === "MEDIUM") return "The public page connects this address to the organisation or hiring, but not both clearly.";
  return "The address is public, but its connection to this employer's hiring process is weak.";
}
