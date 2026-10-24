import type { JobSource, JSearchHost } from "./search";

/** What Settings → Job search may know about a source's key: never the key itself. "env" means it comes from the environment. */
export type JobKeyState = "none" | "set" | "unreadable" | "env";

/** What the Job search section starts from (E14-4). */
export type JobSearchSettingsView = {
  source: JobSource | "OFF";
  jsearch: { host: JSearchHost; keyState: JobKeyState };
  adzuna: { appId: string; keyState: JobKeyState };
};

export const JOB_KEY_UNREADABLE = "Your saved key can't be read. Please enter it again.";

/** Where to get a JSearch key, by where it's from. */
export const JSEARCH_KEY_URLS: Record<JSearchHost, string> = {
  openwebninja: "https://www.openwebninja.com/api/jsearch",
  rapidapi: "https://rapidapi.com/letscrape-6bRBa3QguO5/api/jsearch",
};

/** How Settings → Job search and the Find jobs screen describe each source (E14). */
export type SourceInfo = {
  name: string;
  /** What it covers, in a line. */
  description: string;
  /** Cost and reach at a glance. */
  tag: string;
  /** Where to get a key; null when none is needed. */
  keyUrl: string | null;
  /** When used-up searches come back: "this month", "today"; null when there's no quota. */
  quotaPeriod: string | null;
  /** Shown with its results, as the source's terms ask. */
  attribution: string | null;
  attributionUrl: string | null;
  /** The countries it lists jobs in (ISO codes); null for every country. */
  countries: readonly string[] | null;
};

export const SOURCE_INFO: Record<JobSource, SourceInfo> = {
  JSEARCH: {
    name: "JSearch",
    description: "Postings from LinkedIn, Indeed, Glassdoor and company sites, through Google for Jobs.",
    tag: "Most countries · free key with 200 searches a month",
    keyUrl: "https://www.openwebninja.com/api/jsearch",
    quotaPeriod: "this month",
    attribution: null,
    attributionUrl: null,
    countries: null,
  },
  ADZUNA: {
    name: "Adzuna",
    description: "Adzuna's own job index in 19 countries. It only shares the start of each posting.",
    tag: "19 countries · free key, about 250 searches a day",
    keyUrl: "https://developer.adzuna.com/signup",
    quotaPeriod: "today",
    attribution: "Jobs by Adzuna",
    attributionUrl: "https://www.adzuna.com/",
    countries: ["at", "au", "be", "br", "ca", "ch", "de", "es", "fr", "gb", "in", "it", "mx", "nl", "nz", "pl", "sg", "us", "za"],
  },
  ARBEITSAGENTUR: {
    name: "Bundesagentur für Arbeit",
    description: "Germany's federal job board, with full postings.",
    tag: "Germany only · free, no key",
    keyUrl: null,
    quotaPeriod: null,
    attribution: "Source: Bundesagentur für Arbeit",
    attributionUrl: "https://www.arbeitsagentur.de/jobsuche/",
    countries: ["de"],
  },
  REMOTE_OK: {
    name: "Remote OK",
    description: "Remote jobs from Remote OK's public JSON feed, filtered locally by Dossier.",
    tag: "Worldwide remote · free, no key",
    keyUrl: null,
    quotaPeriod: null,
    attribution: "Jobs by Remote OK",
    attributionUrl: "https://remoteok.com/",
    countries: null,
  },
  REMOTIVE: {
    name: "Remotive",
    description: "Curated remote jobs from Remotive's public API, delayed by about 24 hours.",
    tag: "Worldwide remote · free, no key",
    keyUrl: null,
    quotaPeriod: null,
    attribution: "Jobs by Remotive",
    attributionUrl: "https://remotive.com/",
    countries: null,
  },
  WE_WORK_REMOTELY: {
    name: "We Work Remotely",
    description: "Remote jobs from We Work Remotely's public RSS feed.",
    tag: "Worldwide remote · free, no key",
    keyUrl: null,
    quotaPeriod: null,
    attribution: "Jobs by We Work Remotely",
    attributionUrl: "https://weworkremotely.com/",
    countries: null,
  },
  HIMALAYAS: {
    name: "Himalayas",
    description: "Remote jobs from Himalayas' public jobs API, filtered locally by Dossier.",
    tag: "Worldwide remote · free, no key",
    keyUrl: null,
    quotaPeriod: null,
    attribution: "Jobs by Himalayas",
    attributionUrl: "https://himalayas.app/jobs",
    countries: null,
  },
  JOBICY: {
    name: "Jobicy",
    description: "Remote jobs from Jobicy's public API, synchronized at most hourly.",
    tag: "Worldwide remote · free, no key",
    keyUrl: null,
    quotaPeriod: null,
    attribution: "Jobs by Jobicy",
    attributionUrl: "https://jobicy.com/",
    countries: null,
  },
  ARBEITNOW: {
    name: "Arbeitnow",
    description: "European jobs from Arbeitnow's public job board API.",
    tag: "Europe · free, no key",
    keyUrl: null,
    quotaPeriod: null,
    attribution: "Jobs by Arbeitnow",
    attributionUrl: "https://www.arbeitnow.com/",
    countries: ["al", "ad", "am", "at", "az", "by", "be", "ba", "bg", "hr", "cy", "cz", "dk", "ee", "fi", "fr", "ge", "de", "gr", "hu", "is", "ie", "it", "xk", "lv", "li", "lt", "lu", "mt", "md", "mc", "me", "nl", "mk", "no", "pl", "pt", "ro", "sm", "rs", "sk", "si", "es", "se", "ch", "tr", "ua", "gb"],
  },
};

/** Whether a source lists jobs in a country ("de"). */
export function sourceCovers(source: JobSource, country: string): boolean {
  const countries = SOURCE_INFO[source].countries;
  return countries === null || countries.includes(country);
}
