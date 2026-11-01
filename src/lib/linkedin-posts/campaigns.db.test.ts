import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createTestClient, resetDatabase } from "@/test/db";
import { buildExport } from "@/lib/data-export";
import { importExport, parseExport } from "@/lib/data-import";
import { campaignView, resumeCampaign, startCampaign } from "./campaigns";
import { DEFAULT_CAMPAIGN_FILTERS, type CampaignInput } from "./campaign-data";
import { dismissLinkedInPost, listDismissedPosts, restoreLinkedInPost } from "./dismissals";
import { linkedInPostSchema } from "./data";
import { fitSnapshot } from "./profile-fit-store";
import { postContentHash } from "./profile-fit-ai";
import { linkedInPostKey } from "./post-key";

vi.mock("@/lib/env", () => ({ env: { DOSSIER_SECRET: "s".repeat(32) } }));
vi.mock("@/lib/prisma", () => ({ get prisma() { return client; } }));
vi.mock("@/lib/ai/config", () => ({ loadAiConfig: async () => ({ provider: "LOCAL", model: "test-ollama", apiKeyProblem: null }) }));
vi.mock("./searches", () => ({ loadApifyKey: async () => "fake-apify-token" }));
vi.mock("./coordinator", () => ({ startCampaignSchedule: vi.fn() }));
const client = createTestClient();
const input: CampaignInput = { keywords: ["Computer Vision"], countries: ["Türkiye", "Slovenia"], rounds: 3, budgetUsd: 1, authors: [], maxPosts: 20, postedWithin: "month", since: "" };
beforeEach(async () => { await resetDatabase(client); });
afterAll(() => client.$disconnect());

describe("persistent LinkedIn AI campaigns", () => {
  it("filters only current profile/content matches and exports reviews without restarting them", async () => {
    const { id } = await startCampaign(input);
    const snapshot = await fitSnapshot();
    const posts = Array.from({ length: 3 }, (_, i) => linkedInPostSchema.parse({ id: String(100 + i), url: `https://www.linkedin.com/posts/${100 + i}`, text: `Hiring engineer ${i}`, author: { name: "Acme", type: "company", url: null }, postedAt: null, likes: 0, commentsCount: 0, query: "vision" }));
    for (const post of posts) {
      await client.linkedInCampaignPost.create({ data: { campaignId: id, url: post.url, text: post.text, contentHash: postContentHash(post.text), post, authorName: "Acme", authorType: "company" } });
    }
    for (let i = 0; i < posts.length; i++) {
      await client.linkedInProfileFit.create({ data: { key: linkedInPostKey(posts[i]), profileHash: i === 2 ? "old-profile" : snapshot.hash, postHash: i === 1 ? "old-text" : postContentHash(posts[i].text), verdict: "not_suitable", result: { verdict: "not_suitable", summary: "Documented mismatch", requirements: [] }, provider: "LOCAL", model: "test-ollama" } });
    }
    expect((await campaignView(id, { ...DEFAULT_CAMPAIGN_FILTERS, profileFit: "hide_unsuitable" })).filtered).toBe(2);
    const unsuitable = await campaignView(id, { ...DEFAULT_CAMPAIGN_FILTERS, profileFit: "not_suitable" });
    expect(unsuitable.filtered).toBe(1);
    expect(unsuitable.posts[0].profileFit?.verdict).toBe("not_suitable");
    await client.linkedInProfileReview.create({ data: { scope: `campaign:${id}`, profileHash: snapshot.hash, provider: "LOCAL", model: "test-ollama", total: 3, processed: 1, status: "RUNNING", jobId: "foreign-job" } });
    const parsed = parseExport(JSON.stringify(await buildExport(client)));
    if (!parsed.ok) throw new Error(parsed.error);
    expect(parsed.data.linkedInProfileFits).toHaveLength(3);
    await importExport(client, parsed.data);
    expect(await client.linkedInProfileReview.findUniqueOrThrow({ where: { scope: `campaign:${id}` } })).toMatchObject({ status: "IMPORTED", jobId: null, processed: 1 });
    expect((await campaignView(id, { ...DEFAULT_CAMPAIGN_FILTERS, profileFit: "hide_unsuitable" })).filtered).toBe(2);
  });
  it("serializes simultaneous starts and allocates exactly six bounded country rounds", async () => {
    const results = await Promise.allSettled([startCampaign(input), startCampaign(input)]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(await client.linkedInCampaign.count()).toBe(1);
    const attempts = await client.linkedInAttempt.findMany({ orderBy: { position: "asc" } });
    expect(attempts.map((a) => a.country)).toEqual(["Türkiye", "Slovenia", "Türkiye", "Slovenia", "Türkiye", "Slovenia"]);
    expect(attempts.reduce((sum, a) => sum + Number(a.capUsd), 0)).toBeLessThanOrEqual(1);
    expect(JSON.stringify(await client.linkedInCampaign.findMany())).not.toContain("fake-apify-token");
  });
  it("paginates and filters merged posts in the database", async () => {
    const { id } = await startCampaign(input);
    await client.linkedInCampaignPost.createMany({ data: Array.from({ length: 25 }, (_, i) => ({
      campaignId: id, url: `https://www.linkedin.com/posts/${i}`, text: `Hiring vision engineer ${i} in Ljubljana`, authorName: "Acme", authorType: "company",
      relevant: true, hiring: true, confidence: i === 0 ? "confirmed" : "uncertain",
      post: { id: String(i), url: `https://www.linkedin.com/posts/${i}`, text: `Hiring vision engineer ${i} in Ljubljana`, author: { name: "Acme", type: "company", url: null }, postedAt: null, likes: 0, commentsCount: 0, query: "vision" },
      assessments: [], occurrences: [],
    })) });
    const page = await campaignView(id, DEFAULT_CAMPAIGN_FILTERS);
    expect(page).toMatchObject({ found: 25, filtered: 25, page: 1, pages: 2 }); expect(page.posts).toHaveLength(20);
    expect((await campaignView(id, DEFAULT_CAMPAIGN_FILTERS, 2)).posts).toHaveLength(5);
    expect((await campaignView(id, { ...DEFAULT_CAMPAIGN_FILTERS, confidence: "confirmed", relevantOnly: true })).filtered).toBe(1);
    expect((await campaignView(id, { ...DEFAULT_CAMPAIGN_FILTERS, exclude: "Ljubljana" })).filtered).toBe(0);
  });
  it("preserves results through export/import without resuming foreign runs", async () => {
    const { id } = await startCampaign(input);
    const attempt = await client.linkedInAttempt.findFirstOrThrow({ where: { campaignId: id } });
    await client.linkedInAttempt.update({ where: { id: attempt.id }, data: { status: "SEARCHING", runId: "foreign-run", jobId: "old-job" } });
    const parsed = parseExport(JSON.stringify(await buildExport(client)));
    if (!parsed.ok) throw new Error(parsed.error);
    await importExport(client, parsed.data);
    expect(await client.linkedInCampaign.findUniqueOrThrow({ where: { id } })).toMatchObject({ status: "IMPORTED" });
    expect(await client.linkedInAttempt.findUniqueOrThrow({ where: { id: attempt.id } })).toMatchObject({ status: "IMPORTED", runId: null, jobId: null });
    await expect(resumeCampaign(id)).rejects.toThrow("paused or failed");
  });
  it("blocks replaying an unconfirmed paid request after restart", async () => {
    const { id } = await startCampaign(input);
    await client.linkedInCampaign.update({ where: { id }, data: { status: "PAUSED" } });
    await client.linkedInAttempt.updateMany({ where: { campaignId: id, position: 0 }, data: { status: "STARTING" } });
    await expect(resumeCampaign(id)).rejects.toThrow("not confirmed");
  });
  it("hides a dismissed post from old and future campaigns while retaining history and restoring through export/import", async () => {
    const { id } = await startCampaign(input);
    const post = linkedInPostSchema.parse({ id: "123", url: "https://www.linkedin.com/posts/example", text: "Hiring vision engineers", postedAt: null, likes: 0, commentsCount: 0, query: "vision", author: { name: "Acme", type: "company", url: null } });
    // Legacy/imported histories may store the original URL rather than a canonical activity URL.
    await client.linkedInCampaignPost.create({ data: { campaignId: id, url: post.url, post, text: post.text, authorName: "Acme", authorType: "company" } });
    const { key } = await dismissLinkedInPost(post);
    expect(await campaignView(id, DEFAULT_CAMPAIGN_FILTERS)).toMatchObject({ found: 1, filtered: 0, posts: [] });
    expect(await listDismissedPosts(1)).toMatchObject({ total: 1 });
    const parsed = parseExport(JSON.stringify(await buildExport(client)));
    if (!parsed.ok) throw new Error(parsed.error);
    expect(parsed.data.linkedInDismissals).toHaveLength(1);
    await importExport(client, parsed.data);
    expect(await campaignView(id, DEFAULT_CAMPAIGN_FILTERS)).toMatchObject({ filtered: 0 });
    await restoreLinkedInPost(key);
    expect(await campaignView(id, DEFAULT_CAMPAIGN_FILTERS)).toMatchObject({ found: 1, filtered: 1 });
  });
});
