import type { CampaignInput } from "./campaign-data";
import { queryAlternatives, queryKey } from "./queries";

// This scraper ANDs every word in a branch. Geography and prose belong in
// assessment, not in every retrieval query. Keep this guard outside the LLM.
const HIRING = new Set(["hiring", "recruiting", "recruitment", "jobs", "job", "vacancies", "vacancy", "opening", "openings", "career", "careers", "looking", "seeking", "we", "are", "a", "an", "the", "for", "in", "at", "near", "based", "located", "and", "or"]);
const fold = (value: string) => value.normalize("NFKD").replace(/\p{M}/gu, "").toLowerCase();
const tokens = (value: string) => value.match(/[\p{L}\p{N}+#.]+/gu) ?? [];
const clean = (value: string) => value.trim().replace(/^(?:[-*•]+\s*|\d+[.)]\s*)/, "").replace(/`/g, "").trim();

export function retrievalKey(value: string) {
  // Permuting OR branches, adding quotes or reordering AND words does not
  // create a new search. The upstream requires the same set of words.
  try { return queryAlternatives(clean(value)).map((branch) => [...new Set(tokens(branch).map(fold))].sort().join(" ")).sort().join(" OR "); }
  catch { return queryKey(value); }
}
function countryWords(input: CampaignInput) {
  const words = input.countries.flatMap(tokens).map(fold);
  if (words.some((w) => ["turkey", "turkiye", "turkei"].includes(w))) words.push("turkey", "turkiye", "turkish", "türkiye");
  if (words.some((w) => ["slovenia", "slovenija", "slovenya"].includes(w))) words.push("slovenia", "slovenija", "slovenya", "slovenian");
  return new Set(words);
}
export function topicCores(input: CampaignInput): string[] {
  const countries = countryWords(input);
  return [...new Map(input.keywords.flatMap((keyword) => {
    // Quoted technical phrases are a stronger seed than an LLM's invented
    // synonym. Keep the exact vocabulary that the user searched manually.
    const quoted = [...keyword.matchAll(/"([^"\n]+)"/g)].map((match) => match[1]);
    const candidates = quoted.length ? quoted : [keyword.split(/\s+OR\s+/)[0]];
    return candidates.map((candidate) => tokens(candidate).filter((word) => !HIRING.has(fold(word)) && !countries.has(fold(word))).slice(0, 4).join(" ")).filter((q) => q.length >= 2);
  }).map((q) => [retrievalKey(q), q])).values()];
}

/** Turn verbose/overlapping OR combinations into short independent queries. */
export function shortAiQueries(values: string[], input: CampaignInput): string[] {
  const countries = countryWords(input);
  const candidates = values.flatMap((value) => {
    try { return queryAlternatives(clean(value)); } catch { return []; }
  }).map((branch) => tokens(branch.replace(/\b(?:based\s+in|located\s+in|in|near|at)\s+.*$/iu, ""))
    .filter((word) => !["in", "at", "near", "based", "located", "for", "the", "and"].includes(fold(word)) && !countries.has(fold(word))).join(" "))
    .filter((branch) => tokens(branch).length >= 2 && tokens(branch).length <= 4 && branch.length <= 200);
  return [...new Map(candidates.map((q) => [retrievalKey(q), q])).values()];
}
export function baselineQueries(input: CampaignInput): string[] {
  return [...new Map(input.keywords.map(clean).filter((query) => {
    try { queryAlternatives(query); return query.length >= 2 && query.length <= 200; } catch { return false; }
  }).map((q) => [retrievalKey(q), q])).values()];
}
export function retrievalLimit(input: CampaignInput) {
  return Math.min(5, Math.floor(200 / (Math.max(1, input.authors.length) * input.maxPosts)));
}
export function selectRetrievalQueries(input: CampaignInput, country: string, previous: { queries: string[]; fetched: number }[], suggestions: string[]) {
  const used = new Set(previous.flatMap((round) => round.queries.flatMap((q) => {
    try { return [retrievalKey(q), ...queryAlternatives(q).map(retrievalKey)]; } catch { return [retrievalKey(q)]; }
  })));
  const previousWords = previous.flatMap((round) => round.queries.map((query) => new Set(tokens(query).map(fold))));
  const covered = (core: string) => previousWords.some((words) => tokens(core).every((word) => words.has(fold(word))));
  const cores = topicCores(input).sort((a, b) => Number(covered(a)) - Number(covered(b)));
  const ai = shortAiQueries(suggestions, input);
  const originals = baselineQueries(input);
  const noYield = previous.length > 0 && previous.every((round) => round.fetched === 0);
  const baseline = previous.length === 0 && country === input.countries[0];
  const local = /turk|türk|turkiye|türkiye/i.test(country) ? ["arıyoruz", "iş ilanı", "işe alım"] : /sloven/i.test(country) ? ["zaposlimo", "zaposlitev", "iščemo"] : [];
  // One new hiring cue at a time, not all cues ANDed together. Short queries
  // without hiring/location remain intentional: the evaluator identifies ads.
  const expansions = ["hiring", "recruiting", "jobs", ...local].flatMap((cue) => cores.map((core) => `${core} ${cue}`));
  const pool = baseline ? (originals.length ? originals : cores)
    : noYield ? [...cores, ...expansions, ...ai, ...originals]
      : [...cores, ...ai, ...originals, ...expansions];
  const selected: string[] = [];
  for (const query of pool) {
    if (!query || query.length > 200 || used.has(retrievalKey(query))) continue;
    selected.push(query); used.add(retrievalKey(query));
    if (selected.length >= retrievalLimit(input)) break;
  }
  return { queries: selected, baseline, noYield };
}
