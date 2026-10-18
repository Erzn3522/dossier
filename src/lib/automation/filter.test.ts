import { describe, expect, it } from "vitest";

import type { Extracted, Match } from "@/lib/application-data";

import { automationEligibility } from "./filter";

const extracted = (requirements: Extracted["requirements"], contactEmail: string | null = "jobs@example.com"): Extracted => ({
  title: null,
  company: null,
  role: null,
  location: null,
  mode: null,
  salary: null,
  deadline: null,
  requirements,
  asksForReferences: false,
  language: "English",
  contactName: null,
  contactEmail,
});
const requirement = (required = false, kind: Extracted["requirements"][number]["kind"] = "skill") => ({
  text: "Requirement",
  kind,
  skill: null,
  years: kind === "years" ? 5 : null,
  language: kind === "language" ? "German" : null,
  required,
});
const match = (...results: ("covered" | "partial" | "gap")[]): Match => ({
  items: results.map((result) => ({ requirement: "Requirement", result, skill: null, experienceIds: [], note: null })),
});

describe("automationEligibility", () => {
  it("accepts the 70% boundary and rejects 69%", () => {
    expect(automationEligibility(extracted(Array.from({ length: 10 }, () => requirement())), match(...Array(7).fill("covered"), ...Array(3).fill("gap"))).eligible).toBe(true);
    expect(automationEligibility(extracted(Array.from({ length: 100 }, () => requirement())), match(...Array(69).fill("covered"), ...Array(31).fill("gap"))).eligible).toBe(false);
  });

  it("rejects empty requirements, mandatory critical gaps and missing recipients", () => {
    const empty = automationEligibility(extracted([]), match());
    const mandatory = automationEligibility(extracted([requirement(true, "language")]), match("gap"));
    const recipient = automationEligibility(extracted([requirement()], null), match("covered"));
    expect(empty.eligible ? "" : empty.reason).toMatch(/No requirements/);
    expect(mandatory.eligible ? "" : mandatory.reason).toMatch(/mandatory/);
    expect(recipient.eligible ? "" : recipient.reason).toMatch(/email/);
  });

  it("accepts a valid recipient explicitly supplied by the user", () => {
    const result = automationEligibility(extracted([requirement()], null), match("covered"), {
      recipientOverride: "applications@example.com",
    });
    expect(result).toEqual({ eligible: true, score: 100, recipient: "applications@example.com" });
  });
});
