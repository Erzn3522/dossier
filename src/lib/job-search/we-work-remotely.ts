import "server-only";

import type { JobSourceAdapter, RequestContext } from "./adapter";
import { jobSearchError } from "./errors";
import { feedSnapshot, filterRemoteFeed } from "./feed";
import { requestText } from "./http";
import { safeLink, type FoundPosting, type SearchPage, type SearchQuery } from "./search";
import { plainText } from "./text";

const BASE = "https://weworkremotely.com/remote-jobs.rss";
const PAGE_SIZE = 50;
const SNAPSHOT_TTL_MS = 60 * 60 * 1000;

function decodeXml(value: string): string {
  return value
    .replace(/^<!\[CDATA\[([\s\S]*)\]\]>$/, "$1")
    .replace(/&#x([\da-f]+);/gi, (_, code: string) => String.fromCodePoint(Number.parseInt(code, 16)))
    .replace(/&#(\d+);/g, (_, code: string) => String.fromCodePoint(Number(code)))
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&");
}

function value(item: string, tag: string): string {
  const escaped = tag.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = item.match(new RegExp(`<${escaped}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${escaped}>`, "i"));
  return match ? decodeXml(match[1].trim()).trim() : "";
}

function postingFromItem(item: string): FoundPosting | null {
  const rawTitle = value(item, "title");
  const url = safeLink(value(item, "link") || value(item, "guid"));
  if (!rawTitle || !url) return null;
  const separator = rawTitle.indexOf(":");
  const company = separator > 0 ? rawTitle.slice(0, separator).trim() : "";
  const title = separator > 0 ? rawTitle.slice(separator + 1).trim() : rawTitle;
  const description = [
    plainText(value(item, "description")),
    value(item, "skills") && `Skills: ${plainText(value(item, "skills"))}`,
    value(item, "category") && `Category: ${plainText(value(item, "category"))}`,
  ].filter(Boolean).join("\n\n");
  const parsed = Date.parse(value(item, "pubDate") || value(item, "pubdate"));
  return {
    source: "WE_WORK_REMOTELY",
    externalId: (value(item, "guid") || url).slice(0, 500),
    title: plainText(title).slice(0, 500),
    company: plainText(company).slice(0, 300),
    // `country` is the actual eligibility list when it conflicts with the broad `region` label.
    place: plainText(value(item, "country") || value(item, "region") || "Worldwide").slice(0, 300),
    remote: true,
    salary: "",
    postedAt: Number.isNaN(parsed) ? null : new Date(parsed).toISOString(),
    url: url.slice(0, 2000),
    via: "We Work Remotely",
    description: description.slice(0, 100_000),
    complete: Boolean(description),
  };
}

async function search(query: SearchQuery, context: RequestContext = {}): Promise<SearchPage> {
  const url = new URL(context.baseUrl ?? BASE);
  const xml = await feedSnapshot(
    `we-work-remotely:${url.href}`,
    () => requestText("WE_WORK_REMOTELY", url, { signal: context.signal, accept: "application/rss+xml, application/xml, text/xml" }),
    SNAPSHOT_TTL_MS,
  );
  const items = [...xml.matchAll(/<item\b[^>]*>([\s\S]*?)<\/item>/gi)].map((match) => match[1]);
  if (items.length === 0 && !/<(?:rss|feed)\b/i.test(xml)) {
    throw jobSearchError("changed", "WE_WORK_REMOTELY", { detail: `${url.pathname}: unexpected answer` });
  }
  const postings = items.flatMap((item) => {
    const posting = postingFromItem(item);
    return posting ? [posting] : [];
  });
  return { postings: filterRemoteFeed(postings, query).slice(0, PAGE_SIZE), next: null };
}

export const weWorkRemotely: JobSourceAdapter<"WE_WORK_REMOTELY"> = {
  source: "WE_WORK_REMOTELY",
  search: (query, _credentials, _next, context) => search(query, context),
  details: async (posting) => posting.description || null,
  test: async (_credentials, context) => {
    await search({ keywords: "developer", place: "", country: "us", radiusKm: 25, remoteOnly: true, postedWithin: "any" }, context);
  },
};
