import "server-only";

import type { OutreachCampaign } from "@/generated/prisma/client";
import type { WebSearchResult } from "@/lib/email-discovery/searxng";

import { searxngOutreachSearch, type OutreachSearchProvider } from "./providers";
import { normalizedDomain } from "./research";

/** Queries tried per run; the plan rotates so each run continues where the last one stopped. */
export const QUERIES_PER_RUN = 8;

type Country = { name: string; local?: string; languages: Language[]; cities: string[] };
type Language = "de" | "fr" | "nl" | "es" | "it" | "pt" | "pl" | "sv" | "cs";
type Place = { name: string; local?: string; languages: Language[] };

// Ordered roughly by the size of each country's computer-vision industry, so early runs search the richest markets.
const COUNTRIES: Country[] = [
  { name: "Germany", local: "Deutschland", languages: ["de"], cities: ["Munich", "Berlin", "Stuttgart", "Hamburg", "Karlsruhe", "Dresden"] },
  { name: "Netherlands", local: "Nederland", languages: ["nl"], cities: ["Eindhoven", "Amsterdam", "Delft"] },
  { name: "France", languages: ["fr"], cities: ["Paris", "Lyon", "Grenoble", "Toulouse"] },
  { name: "United Kingdom", languages: [], cities: ["London", "Cambridge", "Oxford", "Edinburgh"] },
  { name: "Switzerland", local: "Schweiz", languages: ["de", "fr"], cities: ["Zurich", "Lausanne"] },
  { name: "Spain", local: "España", languages: ["es"], cities: ["Barcelona", "Madrid", "Valencia"] },
  { name: "Italy", local: "Italia", languages: ["it"], cities: ["Milan", "Turin", "Bologna"] },
  { name: "Sweden", local: "Sverige", languages: ["sv"], cities: ["Stockholm", "Gothenburg", "Linköping"] },
  { name: "Denmark", languages: [], cities: ["Copenhagen", "Aarhus", "Odense"] },
  { name: "Austria", local: "Österreich", languages: ["de"], cities: ["Vienna", "Graz", "Linz"] },
  { name: "Belgium", languages: ["nl", "fr"], cities: ["Leuven", "Ghent", "Brussels"] },
  { name: "Finland", languages: [], cities: ["Helsinki", "Tampere", "Oulu"] },
  { name: "Norway", languages: [], cities: ["Oslo", "Trondheim"] },
  { name: "Poland", local: "Polska", languages: ["pl"], cities: ["Warsaw", "Kraków", "Wrocław"] },
  { name: "Ireland", languages: [], cities: ["Dublin", "Cork"] },
  { name: "Portugal", languages: ["pt"], cities: ["Lisbon", "Porto"] },
  { name: "Czechia", local: "Česko", languages: ["cs"], cities: ["Prague", "Brno"] },
  { name: "Estonia", languages: [], cities: ["Tallinn"] },
  { name: "Slovenia", languages: [], cities: ["Ljubljana"] },
  { name: "Lithuania", languages: [], cities: ["Vilnius"] },
  { name: "Hungary", languages: [], cities: ["Budapest"] },
  { name: "Romania", languages: [], cities: ["Bucharest", "Cluj-Napoca"] },
  { name: "Croatia", languages: [], cities: ["Zagreb"] },
  { name: "Greece", languages: [], cities: ["Athens"] },
  { name: "Luxembourg", languages: [], cities: [] },
  { name: "Latvia", languages: [], cities: ["Riga"] },
  { name: "Slovakia", languages: [], cities: ["Bratislava"] },
];

const REGIONS: Record<string, string[]> = {
  europe: COUNTRIES.map((country) => country.name),
  eu: COUNTRIES.map((country) => country.name),
  dach: ["Germany", "Austria", "Switzerland"],
  benelux: ["Netherlands", "Belgium", "Luxembourg"],
  nordics: ["Sweden", "Denmark", "Finland", "Norway"],
  scandinavia: ["Sweden", "Denmark", "Norway"],
  baltics: ["Estonia", "Lithuania", "Latvia"],
  "uk": ["United Kingdom"],
};

// Companies often describe themselves only in their own language, so known keywords are also searched locally.
const LOCAL: Record<Language, { company: string; terms: Record<string, string> }> = {
  de: { company: "Unternehmen", terms: { "computer vision": "Computer Vision", "machine vision": "industrielle Bildverarbeitung", "image processing": "Bildverarbeitung", "visual inspection": "optische Inspektion", "3d vision": "3D-Bildverarbeitung", "video analytics": "Videoanalyse" } },
  fr: { company: "entreprise", terms: { "computer vision": "vision par ordinateur", "machine vision": "vision industrielle", "image processing": "traitement d'images", "visual inspection": "contrôle qualité par vision", "3d vision": "vision 3D" } },
  nl: { company: "bedrijf", terms: { "image processing": "beeldverwerking", "visual inspection": "visuele inspectie", "machine vision": "machine vision" } },
  es: { company: "empresa", terms: { "computer vision": "visión artificial", "machine vision": "visión artificial industrial", "image processing": "procesamiento de imágenes", "visual inspection": "inspección visual" } },
  it: { company: "azienda", terms: { "computer vision": "visione artificiale", "machine vision": "visione industriale", "image processing": "elaborazione immagini" } },
  pt: { company: "empresa", terms: { "computer vision": "visão computacional", "machine vision": "visão industrial", "image processing": "processamento de imagem" } },
  pl: { company: "firma", terms: { "computer vision": "wizja komputerowa", "machine vision": "wizja maszynowa", "image processing": "przetwarzanie obrazu" } },
  sv: { company: "företag", terms: { "machine vision": "maskinseende", "image processing": "bildbehandling", "computer vision": "datorseende" } },
  cs: { company: "firma", terms: { "machine vision": "strojové vidění", "image processing": "zpracování obrazu", "computer vision": "počítačové vidění" } },
};

/** The places to search in tiers: every country first, then each country's first city, then its second, and so on. */
function placesFor(regions: readonly string[]): Place[][] {
  const countries: Place[] = [];
  const cities: Place[][] = [];
  const add = (country: Country) => {
    if (countries.some((place) => place.name === country.name)) return;
    countries.push({ name: country.name, local: country.local, languages: country.languages });
    cities.push(country.cities.map((city) => ({ name: city, languages: country.languages })));
  };
  for (const raw of regions.length ? regions : ["Europe"]) {
    const value = raw.trim();
    const region = REGIONS[value.toLowerCase()];
    const country = COUNTRIES.find((entry) => [entry.name, entry.local].some((name) => name?.toLowerCase() === value.toLowerCase()));
    const city = COUNTRIES.find((entry) => entry.cities.some((name) => name.toLowerCase() === value.toLowerCase()));
    if (region) for (const name of region) add(COUNTRIES.find((entry) => entry.name === name)!);
    else if (country) add(country);
    else if (city) countries.push({ name: value, languages: city.languages });
    else if (value) countries.push({ name: value, languages: [] });
  }
  const rounds = Math.max(0, ...cities.map((list) => list.length));
  return [countries, ...Array.from({ length: rounds }, (_, index) => cities.flatMap((list) => list[index] ?? []))];
}

/** The countries (or places as typed) a campaign's regions cover, for searching one at a time. */
export function campaignCountries(regions: readonly string[]): string[] {
  return placesFor(regions)[0].map((place) => place.name);
}

function placeQueries(keyword: string, place: Place): string[] {
  const queries = [`"${keyword}" company ${place.name}`];
  for (const language of place.languages) {
    const local = LOCAL[language].terms[keyword.toLowerCase()];
    if (local) queries.push(`${local} ${LOCAL[language].company} ${place.local ?? place.name}`);
  }
  return queries;
}

/**
 * Every query a campaign can run: the first keyword in every country (in English and the local
 * language side by side), then the next keyword, and only then the same again city by city.
 */
export function campaignSearchPlan(campaign: Pick<OutreachCampaign, "keywords" | "countries" | "remote">): string[] {
  const [countries, ...cityRounds] = placesFor(campaign.countries);
  const tier = (places: Place[]) => campaign.keywords.flatMap((keyword) => places.flatMap((place) => placeQueries(keyword, place)));
  const plan = [
    ...tier(countries),
    ...(campaign.remote ? campaign.keywords.map((keyword) => `"${keyword}" remote-first company`) : []),
    ...cityRounds.flatMap(tier),
  ];
  return [...new Set(plan)];
}

/** The queries for one run: the slice of the plan after the one the previous run used. */
export function companySearchQueries(
  campaign: Pick<OutreachCampaign, "keywords" | "countries" | "remote">,
  cursor = 0,
  count = QUERIES_PER_RUN,
): string[] {
  const plan = campaignSearchPlan(campaign);
  if (plan.length <= count) return plan;
  const start = (cursor * count) % plan.length;
  return Array.from({ length: count }, (_, index) => plan[(start + index) % plan.length]);
}

// Directories, rankings, job boards, data brokers, media and code/research hosts: never the company itself.
const NOT_COMPANY_DOMAINS = new Set([
  "dealroom.co", "vendorland.com", "techbehemoths.com", "ensun.io", "f6s.com", "tracxn.com", "revenuebase.ai", "inven.ai",
  "clutch.co", "goodfirms.co", "themanifest.com", "designrush.com", "sortlist.com", "seedtable.com", "startupintros.com",
  "eu-startups.com", "startupblink.com", "wellfound.com", "angel.co", "ycombinator.com", "builtin.com", "g2.com", "capterra.com",
  "producthunt.com", "globalspec.com", "pappers.fr", "societe.com", "northdata.com", "northdata.de", "owler.com", "cbinsights.com",
  "pitchbook.com", "lusha.com", "aidevshops.com", "wlw.de", "chemie.de", "lyon-entreprises.com", "businessinsider.com",
  "fortunebusinessinsights.com", "marketsandmarkets.com", "grandviewresearch.com", "mordorintelligence.com", "statista.com",
  "medium.com", "substack.com", "forbes.com", "techcrunch.com", "photonics.com", "reuters.com", "bloomberg.com", "venturebeat.com",
  "wired.com", "towardsdatascience.com", "analyticsvidhya.com", "youtube.com", "reddit.com", "quora.com", "github.com",
  "gitlab.com", "researchgate.net", "arxiv.org", "sciencedirect.com", "springer.com", "ieee.org", "mdpi.com", "join.com",
  "wearedevelopers.com", "berlinstartupjobs.com", "welcometothejungle.com", "jobteaser.com", "honeypot.io", "otta.com",
  "arbeitnow.com", "studysmarter.co.uk", "euraxess.ec.europa.eu",
]);
// Sites with a registration in many countries, matched by name whatever the ending.
// News and trade media are included here because they publish under a domain per country (forbes.cz, heise.de…).
const NOT_COMPANY_NAMES = new Set([
  "indeed", "glassdoor", "stepstone", "monster", "xing", "linkedin", "europages", "kompass", "wikipedia", "jobs", "amazon", "google",
  "forbes", "techcrunch", "reuters", "bloomberg", "wired", "medium", "businessinsider", "theverge", "zdnet", "venturebeat", "sifted",
  "siliconangle", "eetimes", "photonics", "imveurope", "automate", "prnewswire", "businesswire", "globenewswire", "euronews", "bbc",
  "cnn", "theguardian", "ft", "economist", "heise", "golem", "t3n", "handelsblatt", "computerwoche", "lesechos", "usinenouvelle",
  "lemondeinformatique", "elpais", "expansion", "ilsole24ore", "corriere", "idnes", "seznam", "novinky", "lidovky", "ihned", "aktualne",
  "denik", "czechcrunch", "rtvslo", "delo", "computerworld", "techradar", "thenextweb", "eu-startups", "startupticker", "tweakers",
]);
// Research bodies the search engines rank highly for these topics.
const RESEARCH_DOMAINS = new Set(["fraunhofer.de", "mpg.de", "dlr.de", "tno.nl", "cnrs.fr", "inria.fr", "csic.es", "cnr.it", "fbk.eu", "vtt.fi", "sintef.no", "dti.dk", "csem.ch", "ethz.ch", "epfl.ch", "cost.eu", "europa.eu", "eism.eu", "enlight-eu.org", "vicomtech.org"]);

const LISTING_TITLE = /\b(?:top|best|leading)\s+\d+|\b\d+\+?\s+(?:top|best|leading)\b|\b(?:companies|startups|firms|unternehmen|entreprises|empresas|aziende|suppliers)\s+(?:in|based in|from|aus)\b|\branked\b|\branking\b|\bcompared\b|\bmarket (?:size|share|report|research)\b|\bwhat is\b|\bwas ist\b|\bguide\b|\bnews\b|\bpress release\b|\bwebinar\b|\bconference\b|\bcourse\b|\btutorial\b|\bfunding, team\b|chiffre d'affaires/i;
const JOB_TITLE = /\bjobs?\b|\bvacanc|\bstellen(?:angebot|anzeige)?\b|\bemplois?\b|\bofertas? de empleo\b|\bworking student\b|\binternship\b|\bfor hire\b|\(m\/f\/d\)|\(m\/w\/d\)/i;
const ACADEMIC_TITLE = /\b(?:universit\w*|hochschule|fachhochschule|faculty|department of|research (?:group|centre|center|institute)|learning group|laborator\w*|fraunhofer|max[- ]planck|institut\w*|technological cent(?:re|er))\b/i;
const ASSOCIATION = /\b(?:asociace|association|verband|vereniging|associazione|asociaci[oó]n|associação|stowarzyszenie|cluster|alliance|chamber|kammer)\b|^(?:asociace|association|verband|cluster)/i;
// A truncated sentence or a headline with a sentence break reads like an article, not a company name.
// The word before the break must be lowercase, so legal forms such as "B.V. Vision" don't count.
const HEADLINE = /(?:\.\.\.|…)\s*$|\p{Ll}{3,}[.!?]\s+\p{Lu}/u;
// Dated snippets ("12. 3. 2024 —", "Oct 3, 2024 —") come from articles and posts.
const DATED_SNIPPET = /^\s*(?:\d{1,2}\.?\s*\d{1,2}\.?\s*\d{4}|\d{1,2}\.?\s+\p{L}+\.?\s+\d{4}|\p{L}{3,9}\.?\s+\d{1,2},\s+\d{4})\s*[—–-]/u;
const ARTICLE_PATH = /\/(?:20\d\d|19\d\d)\/|\/(?:clanek|clanky|artikel|article|articles|nachrichten|aktuality|aktualno|zpravy|novinky|novice|story|stories|magazine|magazin|actualites|noticias|notizie|press-release|pressemitteilung)\b/i;
const LAB_TITLE = /\blabs?\b/i;
const LEGAL_FORM =/\b(?:GmbH|AG|B\.?V\.?|N\.?V\.?|Ltd|Limited|SAS|SARL|S\.L\.|S\.r\.l\.|SpA|A\/S|ApS|AB|Oy|AS|sp\. z o\.o\.|s\.r\.o\.|d\.o\.o\.|Inc)\b/;
const NOT_COMPANY_PATH = /\/(?:blog|news|articles?|press|wiki|jobs?|stellenangebote)\b/i;

function academicOrPublic(hostname: string, domain: string): boolean {
  const labels = hostname.split(".");
  const tld = labels.at(-1)!;
  const second = labels.at(-2);
  if (["edu", "gov", "int", "mil"].includes(tld) || second === "ac" || second === "edu" || second === "gov" || second === "gouv") return true;
  if (RESEARCH_DOMAINS.has(domain) || [...RESEARCH_DOMAINS].some((entry) => hostname.endsWith(`.${entry}`))) return true;
  return /^(?:uni|tu|fh|hs)-|univ|hochschule/.test(domain);
}

export type CompanyCandidate = { domain: string; website: string; title: string; score: number };

/** Turns a search result into a company candidate, or null when it is clearly not a company's own site. */
export function companyCandidate(result: WebSearchResult, terms: readonly string[]): CompanyCandidate | null {
  const domain = normalizedDomain(result.url);
  if (!domain) return null;
  const url = new URL(result.url);
  const hostname = url.hostname.toLowerCase().replace(/^www\./, "");
  if (NOT_COMPANY_DOMAINS.has(domain) || [...NOT_COMPANY_DOMAINS].some((entry) => hostname === entry || hostname.endsWith(`.${entry}`))) return null;
  if (NOT_COMPANY_NAMES.has(domain.split(".")[0])) return null;
  if (academicOrPublic(hostname, domain)) return null;
  const title = result.title.trim();
  if (LISTING_TITLE.test(title) || JOB_TITLE.test(title) || ACADEMIC_TITLE.test(title)) return null;
  if (ASSOCIATION.test(title) || ASSOCIATION.test(domain.split(".")[0])) return null;
  if (HEADLINE.test(title) || DATED_SNIPPET.test(result.content) || ARTICLE_PATH.test(url.pathname)) return null;
  // "Lab" alone is usually a university group; a company lab names its legal form ("AI Lab ApS").
  if (LAB_TITLE.test(title) && !LEGAL_FORM.test(title)) return null;
  if (/\.pdf$/i.test(url.pathname)) return null;

  const text = `${title} ${result.content}`.toLowerCase();
  const depth = url.pathname.split("/").filter(Boolean).length;
  let score = 1;
  if (depth <= 1) score += 2;
  if (NOT_COMPANY_PATH.test(url.pathname)) score -= 2;
  if (terms.some((term) => text.includes(term))) score += 2;
  if (LEGAL_FORM.test(`${title} ${result.content}`)) score += 1;
  if (/\b(?:we|our|wir|unser|nous|notre)\b/.test(text)) score += 1;
  return { domain, website: `${url.protocol}//${url.host}/`, title, score };
}

function searchTerms(keywords: readonly string[]): string[] {
  const terms = keywords.map((keyword) => keyword.toLowerCase());
  for (const language of Object.values(LOCAL)) {
    for (const keyword of terms.slice()) if (language.terms[keyword]) terms.push(language.terms[keyword].toLowerCase());
  }
  return [...new Set(terms)];
}

/**
 * Searches one slice of the campaign's plan and returns at most `limit` likely company sites, best first.
 * Domains in `skip` (already researched or suppressed) are never returned.
 */
export async function discoverCompanySites(
  campaign: Pick<OutreachCampaign, "keywords" | "countries" | "remote">,
  limit: number,
  {
    skip = new Set<string>(),
    cursor = 0,
    signal,
    provider = searxngOutreachSearch,
  }: { skip?: ReadonlySet<string>; cursor?: number; signal?: AbortSignal; provider?: OutreachSearchProvider } = {},
): Promise<CompanyCandidate[]> {
  const terms = searchTerms(campaign.keywords);
  const found = new Map<string, CompanyCandidate>();
  let failure: unknown = null;
  let answered = 0;
  for (const query of companySearchQueries(campaign, cursor)) {
    let results: WebSearchResult[];
    try {
      results = await provider.search(query, signal);
      answered++;
    } catch (error) {
      if (signal?.aborted) throw error;
      failure = error;
      continue;
    }
    for (const result of results) {
      const candidate = companyCandidate(result, terms);
      if (!candidate || skip.has(candidate.domain)) continue;
      const known = found.get(candidate.domain);
      // A domain that several queries return is more likely to be a real company in the field.
      if (known) found.set(candidate.domain, { ...known, score: Math.max(known.score, candidate.score) + 2 });
      else found.set(candidate.domain, candidate);
    }
    if (found.size >= limit * 3) break;
  }
  if (!answered && failure) throw failure;
  return [...found.values()].sort((a, b) => b.score - a.score).slice(0, limit);
}
