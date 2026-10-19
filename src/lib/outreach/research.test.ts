import { describe, expect, it } from "vitest";

import { companySearchQueries, extractPublicContacts, normalizedDomain, parseRobots, robotsAllows } from "./research";

describe("outreach research boundaries", () => {
  it("normalizes subdomains to one company domain and rejects directories/social sites", () => {
    expect(normalizedDomain("https://www.vision.example.com/careers")).toBe("example.com");
    expect(normalizedDomain("https://careers.example.co.uk/jobs")).toBe("example.co.uk");
    expect(normalizedDomain("https://linkedin.com/company/example")).toBeNull();
    expect(normalizedDomain("http://localhost:8080")).toBeNull();
  });

  it("builds region and remote terms into bounded campaign queries", () => {
    const queries = companySearchQueries({ keywords: ["computer vision", "OCR", "3D vision", "video analytics", "ignored"], countries: ["Europe"], remote: true });
    expect(queries).toHaveLength(4);
    expect(queries[0]).toContain('"computer vision" company Europe remote');
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
});

