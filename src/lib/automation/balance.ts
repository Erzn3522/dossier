import { linkKey, type FoundPosting } from "@/lib/job-search/search";

const words = (value: string) => value.toLocaleLowerCase("en").replace(/[^\p{L}\p{N}]+/gu, " ").trim();

export const postingFingerprints = (posting: Pick<FoundPosting, "source" | "externalId" | "url" | "company" | "title">): string[] => {
  const keys: string[] = [];
  const link = linkKey(posting.url);
  if (link) keys.push(`link:${link}`);
  const company = words(posting.company);
  const title = words(posting.title);
  if (company && title) keys.push(`role:${company}:${title}`);
  return keys.length > 0 ? keys : [`source:${posting.source}:${posting.externalId}`];
};

/** Fairly interleaves sources; an empty source's share is automatically used by the others. */
export function balancedPostings(pools: readonly FoundPosting[][], limit: number): FoundPosting[] {
  const positions = pools.map(() => 0);
  const seen = new Set<string>();
  const selected: FoundPosting[] = [];
  while (selected.length < limit) {
    let advanced = false;
    for (let source = 0; source < pools.length && selected.length < limit; source += 1) {
      while (positions[source] < pools[source].length) {
        const posting = pools[source][positions[source]++];
        advanced = true;
        const keys = postingFingerprints(posting);
        if (keys.some((key) => seen.has(key))) continue;
        keys.forEach((key) => seen.add(key));
        selected.push(posting);
        break;
      }
    }
    if (!advanced) break;
  }
  return selected;
}
