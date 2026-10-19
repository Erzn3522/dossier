import "server-only";

import type { OutreachCampaign } from "@/generated/prisma/client";

import type { OutreachContact } from "./data";
import { publicOutreachPageReader, searxngOutreachSearch, type OutreachPageReader, type OutreachSearchProvider } from "./providers";

const BLOCKED_HOSTS = new Set(["linkedin.com", "facebook.com", "instagram.com", "x.com", "twitter.com", "crunchbase.com", "zoominfo.com", "rocketreach.co", "apollo.io", "hunter.io", "glassdoor.com", "indeed.com", "wikipedia.org", "github.io"]);
const TWO_PART_SUFFIXES = new Set(["co.uk", "org.uk", "com.au", "com.br", "co.jp", "co.nz", "co.za", "com.tr"]);
const PAGE_PATHS = ["/", "/about", "/team", "/careers", "/jobs", "/contact"] as const;
const EMAIL = /[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+/gi;
const REJECTED_MAILBOX = /^(?:no-?reply|donotreply|privacy|security|abuse|billing|invoice|press|media|support|help|legal|compliance|sales|marketing|info|contact|hello|office)(?:[+._-]|$)/i;

export function normalizedDomain(input: string): string | null {
  try {
    const url = new URL(input.includes("://") ? input : `https://${input}`);
    if (!/^https?:$/.test(url.protocol) || url.username || url.password) return null;
    const hostname = url.hostname.toLowerCase().replace(/^www\./, "").replace(/\.$/, "");
    if (!hostname.includes(".")) return null;
    const blocked = [...BLOCKED_HOSTS].some((entry) => hostname === entry || hostname.endsWith(`.${entry}`));
    if (blocked) return null;
    const labels = hostname.split(".");
    const suffix = labels.slice(-2).join(".");
    const size = TWO_PART_SUFFIXES.has(suffix) ? 3 : 2;
    return labels.slice(-size).join(".");
  } catch {
    return null;
  }
}

export function companySearchQueries(campaign: Pick<OutreachCampaign, "keywords" | "countries" | "remote">): string[] {
  const location = campaign.countries.join(" OR ") || "Europe";
  return campaign.keywords.slice(0, 4).map((keyword) => `\"${keyword}\" company ${location}${campaign.remote ? " remote" : ""} -jobs -linkedin`);
}

export async function discoverCompanySites(
  campaign: OutreachCampaign,
  limit: number,
  signal?: AbortSignal,
  provider: OutreachSearchProvider = searxngOutreachSearch,
): Promise<{ domain: string; website: string; title: string }[]> {
  const found = new Map<string, { domain: string; website: string; title: string }>();
  for (const query of companySearchQueries(campaign)) {
    for (const result of await provider.search(query, signal)) {
      const domain = normalizedDomain(result.url);
      if (!domain || found.has(domain)) continue;
      const parsed = new URL(result.url);
      found.set(domain, { domain, website: `${parsed.protocol}//${parsed.host}/`, title: result.title.trim() });
      if (found.size >= limit * 3) return [...found.values()];
    }
  }
  return [...found.values()];
}

type RobotsRules = { disallow: string[] };

export function parseRobots(text: string): RobotsRules {
  const rules: string[] = [];
  let applies = false;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.replace(/#.*$/, "").trim();
    const separator = line.indexOf(":");
    if (separator < 0) continue;
    const key = line.slice(0, separator).trim().toLowerCase();
    const value = line.slice(separator + 1).trim();
    if (key === "user-agent") applies = value === "*" || /dossier/i.test(value);
    else if (key === "disallow" && applies && value.startsWith("/")) rules.push(value);
  }
  return { disallow: rules };
}

export function robotsAllows(pathname: string, rules: RobotsRules): boolean {
  return !rules.disallow.some((path) => path !== "/" && pathname.startsWith(path)) && !rules.disallow.includes("/");
}

export async function readCompanyPages(
  website: string,
  signal?: AbortSignal,
  reader: OutreachPageReader = publicOutreachPageReader,
): Promise<{ url: string; title: string; excerpt: string; collectedAt: string }[]> {
  const origin = new URL(website).origin;
  const robotsPage = await reader.read(`${origin}/robots.txt`, signal);
  const rules = robotsPage.ok ? parseRobots(robotsPage.text) : { disallow: [] };
  const pages: { url: string; title: string; excerpt: string; collectedAt: string }[] = [];
  for (const path of PAGE_PATHS) {
    if (!robotsAllows(path, rules)) continue;
    const page = await reader.read(new URL(path, origin).toString(), signal);
    if (!page.ok || normalizedDomain(page.url) !== normalizedDomain(origin)) continue;
    const excerpt = page.text.replace(/\s+/g, " ").trim().slice(0, 8_000);
    if (!excerpt || pages.some((entry) => entry.excerpt === excerpt)) continue;
    pages.push({ url: page.url, title: path === "/" ? "Home" : path.slice(1), excerpt, collectedAt: new Date().toISOString() });
  }
  return pages;
}

function contactRole(local: string, context: string): OutreachContact["role"] {
  const haystack = `${local} ${context}`.toLowerCase();
  if (/recruit|hiring|talent|people|hr\b/.test(haystack)) return "recruiting";
  if (/cto|chief technology|technical lead|engineering lead|head of (engineering|ai|vision)/.test(haystack)) return "technical-lead";
  if (/founder|co-founder|ceo/.test(haystack)) return "founder";
  if (/computer vision|machine learning|image processing|engineering/.test(haystack)) return "role";
  return "general";
}

/** Extracts only literal addresses present in first-party page text. It never builds address patterns. */
export function extractPublicContacts(
  domain: string,
  pages: readonly { url: string; excerpt: string }[],
): OutreachContact[] {
  const contacts = new Map<string, OutreachContact>();
  for (const page of pages) {
    for (const match of page.excerpt.matchAll(EMAIL)) {
      const email = match[0].toLowerCase().replace(/[.,;:)]+$/, "");
      const [local, emailDomain] = email.split("@");
      if (!local || !emailDomain || REJECTED_MAILBOX.test(local)) continue;
      if (emailDomain !== domain && !emailDomain.endsWith(`.${domain}`)) continue;
      const start = Math.max(0, (match.index ?? 0) - 120);
      const excerpt = page.excerpt.slice(start, (match.index ?? 0) + match[0].length + 120).trim();
      contacts.set(email, {
        email,
        name: null,
        title: null,
        sourceUrl: page.url,
        excerpt,
        role: contactRole(local, excerpt),
        rankReason: "",
      });
    }
  }
  return [...contacts.values()];
}

