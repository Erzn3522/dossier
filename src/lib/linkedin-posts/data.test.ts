import { describe, expect, it } from "vitest";
import { DEFAULT_FILTERS, filterPosts, hasHiringSignal, postSearchSchema, type LinkedInPost } from "./data";

const post = (id: string, text: string, extra: Partial<LinkedInPost> = {}): LinkedInPost => ({
  id, text, url: `https://www.linkedin.com/posts/${id}`, postedAt: "2026-10-30T10:00:00Z",
  author: { name: "Example", url: null, type: "person" }, likes: 1, commentsCount: 0, query: "engineer", ...extra,
});
const query = { keywords: ["hiring engineer"], authors: [], postedWithin: "month", since: "", maxPosts: 25 };

describe("LinkedIn post queries and filters", () => {
  it("bounds multiplied keyword/author searches to 200 requested posts", () => {
    expect(postSearchSchema.safeParse(query).success).toBe(true);
    expect(postSearchSchema.safeParse({ ...query, keywords: ["one", "two"], authors: ["a", "b"], maxPosts: 50 }).success).toBe(true);
    expect(postSearchSchema.safeParse({ ...query, keywords: ["one", "two"], authors: ["a", "b"], maxPosts: 51 }).success).toBe(false);
    expect(postSearchSchema.safeParse({ ...query, maxPosts: 0 }).success).toBe(false);
    expect(postSearchSchema.safeParse({ ...query, since: "2026-02-30" }).success).toBe(false);
  });
  it("filters fetched text without treating missing locations as matches", () => {
    const posts = [post("1", "We are hiring React engineers in Ljubljana. Remote."), post("2", "React internship in Ljubljana"), post("3", "Hiring React engineers in Berlin")];
    expect(filterPosts(posts, { ...DEFAULT_FILTERS, text: "REACT", location: "ljubljana", exclude: "internship, unpaid", hiringOnly: true, remoteOnly: true }).map((p) => p.id)).toEqual(["1"]);
  });
  it("recognizes hiring phrases in Turkish, English and Slovenian", () => {
    expect(hasHiringSignal("Ekibimize frontend developer arıyoruz")).toBe(true);
    expect(hasHiringSignal("We're hiring a designer")).toBe(true);
    expect(hasHiringSignal("Zaposlimo razvijalca")).toBe(true);
    expect(hasHiringSignal("Our annual company picnic")).toBe(false);
  });
  it("sorts by date or likes without mutating relevance order", () => {
    const posts = [post("a", "A", { likes: 10, postedAt: null }), post("b", "B")];
    expect(filterPosts(posts, DEFAULT_FILTERS).map((p) => p.id)).toEqual(["b", "a"]);
    expect(filterPosts(posts, { ...DEFAULT_FILTERS, sort: "likes" }).map((p) => p.id)).toEqual(["a", "b"]);
    expect(posts.map((p) => p.id)).toEqual(["a", "b"]);
  });
  it("filters company authors", () => {
    const company = post("company", "Hiring", { author: { name: "Acme", url: null, type: "company" } });
    expect(filterPosts([post("person", "Hiring"), company], { ...DEFAULT_FILTERS, authorType: "company" })).toEqual([company]);
  });
});
