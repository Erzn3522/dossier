import { describe, expect, it, vi } from "vitest";
import { baselineQueries, retrievalKey, selectRetrievalQueries, shortAiQueries, topicCores } from "./retrieval";
import { queryAlternatives } from "./queries";
import type { CampaignInput } from "./campaign-data";
import type { AIProvider } from "@/lib/ai/provider";
import { planRound } from "./ai";
import { actorInput } from "./apify";

vi.mock("@/lib/action", () => ({ ActionError: class ActionError extends Error {} }));

export const originalKeywords = ['"Computer Vision" hiring OR recruiting', '"Machine Vision" engineer hiring', '"Perception Engineer" hiring OR recruiting', '"Applied ML" vision hiring', '"Deep Learning" engineer hiring'];
export const failedQueries = [
  "Computer Vision hiring in Turkey OR 3D Perception hiring in Turkey",
  "Edge AI hiring in Turkey OR Computer Vision recruiting in Turkey",
  "3D Perception hiring in Turkey OR Edge AI hiring in Turkey",
  "Computer Vision hiring in Turkey OR Edge AI hiring in Turkey",
];
export const regressionInput: CampaignInput = { keywords: originalKeywords, countries: ["Turkey", "Slovenia"], rounds: 3, budgetUsd: 1, authors: [], maxPosts: 20, postedWithin: "month", since: "" };

// Controlled retrieval corpus, not live LinkedIn results. Models the actor's
// documented AND-of-words / OR-of-alternatives contract, including filler words.
export const corpus = [
  "Hiring Computer Vision specialists.", "Recruiting a Machine Vision engineer.",
  "Perception Engineer hiring now.", "Applied ML vision hiring team.",
  "Deep Learning engineer hiring today.", "Computer Vision recruiting interns.",
  "Machine Vision: join our team and build inspection systems.",
  "Deep Learning vacancy: join us to train vision models.",
  "Perception Engineer opportunity: send your CV to our team.",
];
export function retrieve(queries: string[]) {
  const words = (text: string) => new Set((text.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? []));
  return corpus.filter((post) => {
    const haystack = words(post);
    return queries.some((query) => queryAlternatives(query).some((branch) => [...words(branch)].every((word) => haystack.has(word))));
  });
}
describe("recall-oriented retrieval guards", () => {
  it("passes protected/broadened queries through the real planner and actor adapter even if Ollama repeats the reported bad plan", async () => {
    const complete = vi.fn().mockResolvedValue({ strategy: "Search in Turkey", queries: failedQueries });
    const provider = { complete } as unknown as AIProvider;
    const baseline = await planRound(provider, regressionInput, "Turkey", []);
    expect(complete).not.toHaveBeenCalled();
    const baselineRequest = actorInput({ ...regressionInput, countries: [], keywords: baseline.queries });
    expect(baselineRequest.searchQueries).toEqual(originalKeywords);
    const firstPosts = retrieve(baselineRequest.searchQueries);
    expect(firstPosts).toHaveLength(6);
    const expanded = await planRound(provider, regressionInput, "Turkey", [{ queries: baseline.queries, fetched: firstPosts.length, fresh: firstPosts.length, duplicates: 0, relevant: 4, samples: [] }]);
    expect(complete).toHaveBeenCalledOnce();
    const expandedRequest = actorInput({ ...regressionInput, countries: [], keywords: expanded.queries });
    expect(expandedRequest.searchQueries.some((q) => /\bin\b|\bTurkey\b/i.test(q))).toBe(false);
    expect(retrieve(expandedRequest.searchQueries)).toHaveLength(9);
    expect(expandedRequest.maxPosts * expandedRequest.searchQueries.length).toBeLessThanOrEqual(200);
  });
  it("reproduces the reported zero-vs-six regression and recovers missing topic ads", () => {
    expect(retrieve(failedQueries)).toHaveLength(0);
    expect(retrieve(originalKeywords)).toHaveLength(6);
    const next = selectRetrievalQueries(regressionInput, "Turkey", [{ queries: failedQueries, fetched: 0 }], failedQueries);
    expect(next.noYield).toBe(true);
    expect(next.queries).toHaveLength(5);
    expect(next.queries).toEqual(expect.arrayContaining(["Computer Vision", "Machine Vision", "Perception Engineer", "Applied ML", "Deep Learning"]));
    expect(retrieve(next.queries)).toHaveLength(9);
  });
  it("protects the exact manual baseline in the first campaign round", () => {
    const first = selectRetrievalQueries(regressionInput, "Turkey", [], failedQueries);
    expect(first.baseline).toBe(true);
    expect(first.queries).toEqual(originalKeywords);
    expect(retrieve(first.queries)).toHaveLength(6);
    expect(first.queries.some((q) => /Turkey|Slovenia/.test(q))).toBe(false);
  });
  it("strips bullet prefixes, mandatory geography and filler, and splits overlapping OR plans", () => {
    expect(shortAiQueries(failedQueries.map((q) => `- ${q}`), regressionInput)).toEqual([
      "Computer Vision hiring", "3D Perception hiring", "Edge AI hiring", "Computer Vision recruiting",
    ]);
    expect(shortAiQueries(["Based in Türkiye looking for computer vision engineer job opening opportunities"], regressionInput)).toEqual([]);
    expect(shortAiQueries(["Computer Vision hiring in Istanbul", "Computer Vision hiring near Ljubljana"], regressionInput)).toEqual(["Computer Vision hiring"]);
  });
  it("treats reordered AND words and OR permutations as repeated searches", () => {
    expect(retrievalKey('"Computer Vision" hiring')).toBe(retrievalKey("hiring computer vision"));
    expect(retrievalKey("machine vision OR computer vision")).toBe(retrievalKey("computer vision OR machine vision"));
  });
  it("covers unsearched topics first when authors/result limits leave only two queries", () => {
    const input = { ...regressionInput, authors: ["a", "b"], maxPosts: 50 };
    const first = selectRetrievalQueries(input, "Turkey", [], []);
    const second = selectRetrievalQueries(input, "Turkey", [{ queries: first.queries, fetched: 1 }], failedQueries);
    expect(first.queries).toHaveLength(2);
    expect(second.queries).toEqual(["Perception Engineer", "Applied ML"]);
  });
  it("continues with fresh variants without repeating topic-only or hiring searches", () => {
    const input = { ...regressionInput, keywords: ['"Computer Vision" hiring'] };
    const previous: { queries: string[]; fetched: number }[] = [];
    const all: string[] = [];
    for (let i = 0; i < 3; i++) {
      const selected = selectRetrievalQueries(input, "Turkey", previous, failedQueries);
      expect(selected.queries.length).toBeGreaterThan(0);
      all.push(...selected.queries); previous.push({ queries: selected.queries, fetched: 0 });
    }
    expect(new Set(all.map(retrievalKey)).size).toBe(all.length);
  });
  it("keeps technical topics and ignores malformed optional baselines", () => {
    expect(topicCores(regressionInput)).toEqual(["Computer Vision", "Machine Vision", "Perception Engineer", "Applied ML", "Deep Learning"]);
    expect(baselineQueries({ ...regressionInput, keywords: ['"unclosed', "computer vision hiring"] })).toEqual(["computer vision hiring"]);
  });
});
