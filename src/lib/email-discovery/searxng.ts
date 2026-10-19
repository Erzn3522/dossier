import "server-only";

import { z } from "zod";

import { env } from "@/lib/env";

const resultSchema = z.object({
  url: z.string(),
  title: z.string().catch(""),
  content: z.string().catch(""),
});
const answerSchema = z.object({ results: z.array(resultSchema) });

const TIMEOUT_MS = 12_000;
const MAX_BYTES = 1024 * 1024;

export type WebSearchResult = z.infer<typeof resultSchema>;

export class EmailSearchUnavailable extends Error {
  override name = "EmailSearchUnavailable";
}

export function emailDiscoveryConfigured(baseUrl = env.DOSSIER_SEARXNG_URL): boolean {
  return Boolean(baseUrl);
}

/** Searches the configured private SearXNG instance and returns only web URLs. */
export async function searchWeb(
  query: string,
  {
    baseUrl = env.DOSSIER_SEARXNG_URL,
    signal,
    fetcher = fetch,
  }: { baseUrl?: string; signal?: AbortSignal; fetcher?: typeof fetch } = {},
): Promise<WebSearchResult[]> {
  if (!baseUrl) throw new EmailSearchUnavailable("Email discovery is not configured.");
  const url = new URL(baseUrl);
  url.pathname = `${url.pathname.replace(/\/+$/, "")}/search`;
  url.search = "";
  url.hash = "";
  url.searchParams.set("q", query);
  url.searchParams.set("format", "json");
  url.searchParams.set("categories", "general");
  url.searchParams.set("safesearch", "1");

  const timeout = AbortSignal.timeout(TIMEOUT_MS);
  let response: Response;
  try {
    response = await fetcher(url, {
      headers: { accept: "application/json" },
      signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
      cache: "no-store",
    });
  } catch (error) {
    if (signal?.aborted) throw error;
    throw new EmailSearchUnavailable("The email search service could not be reached.");
  }
  if (!response.ok) throw new EmailSearchUnavailable(`The email search service answered with HTTP ${response.status}.`);
  const length = Number(response.headers.get("content-length") ?? "0");
  if (length > MAX_BYTES) throw new EmailSearchUnavailable("The email search answer was unexpectedly large.");
  const text = await readLimited(response);
  if (text === null) throw new EmailSearchUnavailable("The email search answer was unexpectedly large.");
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    throw new EmailSearchUnavailable("The email search service returned an answer Dossier could not read.");
  }
  const parsed = answerSchema.safeParse(json);
  if (!parsed.success) throw new EmailSearchUnavailable("The email search service returned an answer Dossier could not read.");
  return parsed.data.results.filter((result) => {
    try {
      const found = new URL(result.url);
      return found.protocol === "http:" || found.protocol === "https:";
    } catch {
      return false;
    }
  });
}

async function readLimited(response: Response): Promise<string | null> {
  if (!response.body) return "";
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > MAX_BYTES) {
      await reader.cancel();
      return null;
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks).toString("utf8");
}
