import { beforeEach, describe, expect, it, vi } from "vitest";
import { dismissLinkedInPost, dismissedPostKeys, listDismissedPosts, restoreLinkedInPost } from "./dismissals";
import { linkedInPostKey } from "./post-key";
import type { LinkedInPost } from "./data";

const table = vi.hoisted(() => ({ upsert: vi.fn(), deleteMany: vi.fn(), findMany: vi.fn(), count: vi.fn() }));
vi.mock("@/lib/prisma", () => ({ prisma: { linkedInPostDismissal: table } }));
vi.mock("@/lib/action", () => ({ ActionError: class ActionError extends Error {} }));
const post: LinkedInPost = { id: "7252800593738510337", url: "https://www.linkedin.com/posts/acme_hiring-activity-7252800593738510337-abc?tracking=1", text: "Hiring vision engineers", author: { name: "Acme", url: null, type: "company" }, likes: 0, commentsCount: 0, query: "vision", postedAt: null };
beforeEach(() => vi.resetAllMocks());
describe("persistent LinkedIn post dismissals", () => {
  it("uses one identity across manual, AI and tracking URL variants", () => {
    const key = linkedInPostKey(post);
    expect(key).toBe("https://www.linkedin.com/feed/update/urn:li:activity:7252800593738510337");
    expect(linkedInPostKey({ id: "opaque", url: `${key}/?utm_source=feed` })).toBe(key);
    expect(linkedInPostKey({ id: post.id, url: "https://linkedin.com/posts/different-slug" })).toBe(key);
    expect(linkedInPostKey({ id: "opaque", url: "https://linkedin.com/posts/hello/?tracking=1" })).toBe("https://www.linkedin.com/posts/hello");
    expect(() => linkedInPostKey({ id: "opaque", url: "https://www.linkedin.com/posts/%invalid" })).not.toThrow();
  });
  it("upserts an idempotent dismissal without deleting the original search", async () => {
    expect(await dismissLinkedInPost(post)).toEqual({ key: linkedInPostKey(post) });
    expect(table.upsert).toHaveBeenCalledWith({ where: { key: linkedInPostKey(post) }, create: { key: linkedInPostKey(post), post }, update: { post } });
  });
  it("restores a post idempotently and can reload persisted keys", async () => {
    await restoreLinkedInPost(linkedInPostKey(post));
    expect(table.deleteMany).toHaveBeenCalledWith({ where: { key: linkedInPostKey(post) } });
    table.findMany.mockResolvedValue([{ key: linkedInPostKey(post) }]);
    expect(await dismissedPostKeys()).toEqual([linkedInPostKey(post)]);
  });
  it("paginates dismissed history and clamps pages after a restore", async () => {
    table.count.mockResolvedValue(1);
    table.findMany.mockResolvedValue([{ key: linkedInPostKey(post), post, dismissedAt: new Date("2026-10-30T10:00:00Z") }]);
    expect(await listDismissedPosts(3)).toMatchObject({ total: 1, page: 1, pages: 1, posts: [{ post }] });
    expect(table.findMany).toHaveBeenCalledWith(expect.objectContaining({ skip: 0, take: 20 }));
  });
  it("keeps old results readable before migration and gives a useful message for dismissal", async () => {
    table.findMany.mockRejectedValue({ code: "P2021" });
    table.upsert.mockRejectedValue({ code: "P2021" });
    expect(await dismissedPostKeys()).toEqual([]);
    await expect(dismissLinkedInPost(post)).rejects.toThrow("Restart Dossier");
    table.findMany.mockRejectedValue(new Error("connection lost"));
    await expect(dismissedPostKeys()).rejects.toThrow("connection lost");
  });
});
