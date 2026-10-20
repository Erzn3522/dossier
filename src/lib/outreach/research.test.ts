import { describe, expect, it } from "vitest";

import { extractPublicContacts, normalizedDomain, pageExcerpt, parseRobots, robotsAllows } from "./research";

describe("outreach research boundaries", () => {
  it("normalizes subdomains to one company domain and rejects directories/social sites", () => {
    expect(normalizedDomain("https://www.vision.example.com/careers")).toBe("example.com");
    expect(normalizedDomain("https://careers.example.co.uk/jobs")).toBe("example.co.uk");
    expect(normalizedDomain("https://linkedin.com/company/example")).toBeNull();
    expect(normalizedDomain("http://localhost:8080")).toBeNull();
  });

  it("keeps addresses that only appear after the excerpt limit, with their verbatim surroundings", () => {
    const text = `${"About our vision products. ".repeat(400)}Footer: write to careers@example.com today.\nEmail link: careers@example.com`;
    const excerpt = pageExcerpt(text);
    expect(excerpt.length).toBeLessThan(text.length);
    expect(excerpt).toContain("Footer: write to careers@example.com today.");
    expect(excerpt.split(" … ")).toHaveLength(2);
  });

  it("respects wildcard robots exclusions", () => {
    const rules = parseRobots("User-agent: *\nDisallow: /team\nDisallow: /private");
    expect(robotsAllows("/about", rules)).toBe(true);
    expect(robotsAllows("/team", rules)).toBe(false);
    expect(robotsAllows("/private/contact", rules)).toBe(false);
  });

  it("keeps only exact company-domain professional addresses and rejects unsuitable mailboxes", () => {
    const contacts = extractPublicContacts("example.com", [{
      url: "https://example.com/team",
      excerpt: "Hiring team: talent@example.com. Privacy: privacy@example.com. Directory copy: recruiter@elsewhere.test.",
    }]);
    expect(contacts.map((contact) => contact.email)).toEqual(["talent@example.com"]);
    expect(contacts[0]).toMatchObject({ role: "recruiting", sourceUrl: "https://example.com/team" });
  });

  it("keeps a small company's general inbox as a low-priority candidate", () => {
    const contacts = extractPublicContacts("example.com", [{
      url: "https://example.com/join-us",
      excerpt: "Want to join? Send your CV to hello@example.com. Jobs: jobs@example.com. Newsletter: newsletter@example.com.",
    }]);
    expect(contacts.map((contact) => [contact.email, contact.role])).toEqual([["hello@example.com", "general"], ["jobs@example.com", "recruiting"]]);
  });
});

