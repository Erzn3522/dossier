import { describe, expect, it } from "vitest";
import { keywordMatches } from "./feed";
import type { FoundPosting } from "./search";

const posting = (title: string, description = ""): FoundPosting => ({
  source: "REMOTE_OK", externalId: title, title, company: "Acme", place: "Worldwide", remote: true,
  salary: "", postedAt: null, url: "", via: "Remote OK", description, complete: true,
});

describe("job-feed keyword matching", () => {
  it("matches any quoted OR phrase without partial false positives", () => {
    const query = '"computer vision" OR "machine learning engineer" OR "robotics engineer"';
    expect(keywordMatches(posting("Senior Machine Learning Engineer"), query)).toBe(true);
    expect(keywordMatches(posting("Computer Engineer", "Work on enterprise vision statements"), query)).toBe(false);
  });

  it("keeps legacy unquoted searches as AND terms", () => {
    expect(keywordMatches(posting("Senior Backend Engineer"), "backend engineer")).toBe(true);
    expect(keywordMatches(posting("Backend Developer"), "backend engineer")).toBe(false);
  });
});
