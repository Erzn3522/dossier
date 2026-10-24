import { countryName } from "./countries";
import { POSTED_WITHIN, type FoundPosting, type SearchQuery } from "./search";

type Snapshot = { expiresAt: number; value?: unknown; pending?: Promise<unknown> };
const globalFeeds = globalThis as unknown as { dossierJobFeedSnapshots?: Map<string, Snapshot> };
const snapshots = (globalFeeds.dossierJobFeedSnapshots ??= new Map());

/** Shares a provider's whole feed across search profiles and coalesces concurrent downloads. */
export async function feedSnapshot<T>(key: string, load: () => Promise<T>, ttlMs: number): Promise<T> {
  const current = snapshots.get(key);
  if (current?.value !== undefined && current.expiresAt > Date.now()) return current.value as T;
  if (current?.pending) return current.pending as Promise<T>;
  const pending = load()
    .then((value) => {
      snapshots.set(key, { value, expiresAt: Date.now() + ttlMs });
      return value;
    })
    .catch((error) => {
      snapshots.delete(key);
      throw error;
    });
  snapshots.set(key, { expiresAt: 0, pending });
  return pending;
}

export const clearFeedSnapshots = () => snapshots.clear();

const EUROPE = new Set(
  "al ad am at az by be ba bg hr cy cz dk ee fi fr ge de gr hu is ie it kz xk lv li lt lu mt md mc me nl mk no pl pt ro ru sm rs sk si es se ch tr ua gb va".split(" "),
);

const fold = (value: string) =>
  value
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();

const GLOBAL = /\b(worldwide|world wide|anywhere|global|all locations|remote)\b/;

/** Remote feeds describe eligibility in prose; keep global and matching regional roles. */
export function remoteLocationMatches(place: string, country: string, requestedPlace = ""): boolean {
  const location = fold(place);
  if (!location || GLOBAL.test(location)) return true;
  const local = fold(requestedPlace);
  if (local && (` ${location} `).includes(` ${local} `)) return true;
  if (EUROPE.has(country) && /\b(europe|european|eu|eea|emea)\b/.test(location)) return true;
  if (country === "us" && /\b(usa|united states|us only|north america)\b/.test(location)) return true;
  if (country === "ca" && /\b(canada|north america)\b/.test(location)) return true;
  if (country === "gb" && /\b(uk|united kingdom|great britain|england)\b/.test(location)) return true;
  const name = fold(countryName(country));
  return Boolean(name && (` ${location} `).includes(` ${name} `)) || new RegExp(`\\b${country}\\b`).test(location);
}

export function keywordMatches(posting: FoundPosting, keywords: string): boolean {
  const text = fold([posting.title, posting.company, posting.description].join(" "));
  const alternatives = keywords.split(/\s+OR\s+/i).map((term) => fold(term.replace(/^\s*"|"\s*$/g, ""))).filter(Boolean);
  if (alternatives.length > 1) return alternatives.some((phrase) => text.includes(phrase));
  const terms = [...new Set(fold(keywords).split(" ").filter((term) => term.length > 1 && term !== "and" && term !== "or"))];
  if (terms.length === 0) return true;
  return terms.every((term) => text.includes(term));
}

function dateMatches(postedAt: string | null, query: SearchQuery, now: Date): boolean {
  const days = POSTED_WITHIN.find((option) => option.value === query.postedWithin)?.days;
  if (!days || !postedAt) return true;
  return Date.parse(postedAt) >= now.getTime() - days * 86_400_000;
}

/** Applies the filters remote feeds don't consistently provide and puts newest first. */
export function filterRemoteFeed(postings: FoundPosting[], query: SearchQuery, now = new Date()): FoundPosting[] {
  return postings
    .filter((posting) => keywordMatches(posting, query.keywords))
    .filter((posting) => !query.remoteOnly || posting.remote === true)
    .filter((posting) => remoteLocationMatches(posting.place, query.country, query.place))
    .filter((posting) => dateMatches(posting.postedAt, query, now))
    .sort((a, b) => Date.parse(b.postedAt ?? "") - Date.parse(a.postedAt ?? ""));
}
