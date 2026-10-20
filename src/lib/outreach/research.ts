import "server-only";

import type { OutreachContact } from "./data";
import { publicOutreachPageReader, type OutreachPageReader } from "./providers";

const BLOCKED_HOSTS = new Set(["linkedin.com", "facebook.com", "instagram.com", "x.com", "twitter.com", "crunchbase.com", "zoominfo.com", "rocketreach.co", "apollo.io", "hunter.io", "glassdoor.com", "indeed.com", "wikipedia.org", "github.io"]);
const TWO_PART_SUFFIXES = new Set(["co.uk", "org.uk", "com.au", "com.br", "co.jp", "co.nz", "co.za", "com.tr"]);
// Tried in order until MAX_PAGES are read. Imprint pages are where EU companies must publish a contact address.
const PAGE_PATHS = ["/", "/about", "/contact", "/careers", "/impressum", "/imprint", "/team", "/jobs", "/about-us", "/contact-us", "/kontakt", "/legal-notice"] as const;
const MAX_PAGES = 6;
const EXCERPT_LENGTH = 8_000;
const EMAIL = /[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+/gi;
// General inboxes such as info@ or hello@ are often a small company's only address, so they stay as low-ranked candidates.
const REJECTED_MAILBOX = /^(?:no-?reply|donotreply|privacy|datenschutz|dpo|gdpr|security|abuse|postmaster|webmaster|billing|invoice|rechnung|accounting|buchhaltung|press|presse|media|support|help|service|legal|compliance|sales|vertrieb|marketing|newsletter|orders?)(?:[+._-]|$)/i;

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
    if (pages.length >= MAX_PAGES) break;
    if (!robotsAllows(path, rules)) continue;
    const page = await reader.read(new URL(path, origin).toString(), signal);
    if (!page.ok || normalizedDomain(page.url) !== normalizedDomain(origin)) continue;
    // A redirect (for example /about → /about-us) can land on a page already read.
    if (pages.some((entry) => entry.url === page.url)) continue;
    const excerpt = pageExcerpt(page.text.replace(/\s+/g, " ").trim());
    if (!excerpt || pages.some((entry) => entry.excerpt === excerpt)) continue;
    pages.push({ url: page.url, title: path === "/" ? "Home" : path.slice(1), excerpt, collectedAt: new Date().toISOString() });
  }
  return pages;
}

/**
 * The page's opening text, plus the verbatim surroundings of any address past it. Footers and the
 * page reader's mailto lines come last, so cutting at a fixed length alone would lose them.
 */
export function pageExcerpt(text: string): string {
  const head = text.slice(0, EXCERPT_LENGTH);
  const tail: string[] = [];
  const seen = new Set(Array.from(head.matchAll(EMAIL), (match) => match[0].toLowerCase()));
  for (const match of text.slice(EXCERPT_LENGTH).matchAll(EMAIL)) {
    const email = match[0].toLowerCase();
    if (seen.has(email) || tail.length >= 10) continue;
    seen.add(email);
    const at = EXCERPT_LENGTH + (match.index ?? 0);
    tail.push(text.slice(Math.max(EXCERPT_LENGTH, at - 120), at + match[0].length + 120).trim());
  }
  return tail.length ? `${head} … ${tail.join(" … ")}` : head;
}

function contactRole(local: string, context: string): OutreachContact["role"] {
  const haystack = `${local} ${context}`.toLowerCase();
  if (/^(?:jobs?|careers?|karriere|bewerbung|candidature)(?:[+._-]|$)/i.test(local) || /recruit|hiring|talent|people|hr\b/.test(haystack)) return "recruiting";
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

