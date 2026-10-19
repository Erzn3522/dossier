import "server-only";

import { searchWeb, type WebSearchResult } from "@/lib/email-discovery/searxng";
import { fetchPublicPage } from "@/lib/posting-fetch";

export interface OutreachSearchProvider {
  search(query: string, signal?: AbortSignal): Promise<WebSearchResult[]>;
}

export interface OutreachPageReader {
  read(url: string, signal?: AbortSignal): Promise<{ ok: true; url: string; text: string } | { ok: false; error: string }>;
}

export const searxngOutreachSearch: OutreachSearchProvider = {
  search: (query, signal) => searchWeb(query, { signal }),
};

export const publicOutreachPageReader: OutreachPageReader = {
  async read(url, signal) {
    const result = await fetchPublicPage(url, { signal });
    return result.ok ? { ok: true, url: result.url, text: result.text } : result;
  },
};

