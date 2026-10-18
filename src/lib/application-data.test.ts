import { describe, expect, it } from "vitest";

import {
  editsSchema,
  extractedSchema,
  matchSchema,
  matchScore,
  unitsSchema,
  type Match,
} from "./application-data";

describe("JSON column schemas", () => {
  it("accepts units in order and rejects duplicate ids", () => {
    const units = [
      { id: "summary", label: "Summary", text: "Product designer…" },
      { id: "experience:e1", label: "Northwind Logistics role", text: "Led…" },
    ];
    expect(unitsSchema.parse(units)).toEqual(units);
    expect(unitsSchema.safeParse([...units, units[0]]).success).toBe(false);
    expect(unitsSchema.safeParse([{ id: "", label: "x", text: "" }]).success).toBe(false);
  });

  it("keeps missing posting details as null and checks the deadline", () => {
    const extracted = {
      title: "Senior Product Designer · Ledgerly Payments",
      company: "Ledgerly",
      role: "Senior Product Designer",
      location: "Amsterdam",
      mode: null,
      salary: null,
      deadline: "2026-10-15",
      requirements: [
        { text: "Has built or maintained a design system", kind: "skill" as const, skill: "Design systems", years: null, language: null, required: false },
        { text: "5+ years of product design", kind: "years" as const, skill: null, years: 5, language: null, required: false },
      ],
      asksForReferences: false,
      language: "English",
      contactName: null,
      contactEmail: null,
    };
    expect(extractedSchema.parse(extracted)).toEqual(extracted);
    expect(extractedSchema.safeParse({ ...extracted, deadline: "15 Oct" }).success).toBe(false);
    expect(extractedSchema.safeParse({ ...extracted, salary: undefined }).success).toBe(false);
    expect(extractedSchema.safeParse({ ...extracted, requirements: ["Figma"] }).success).toBe(false);
  });

  it("scores covered and partial requirements as a match", () => {
    const item = { skill: null, experienceIds: [], note: null };
    const match: Match = {
      items: [
        { ...item, requirement: "Design systems", result: "covered" },
        { ...item, requirement: "Accessibility", result: "partial" },
        { ...item, requirement: "Payments", result: "gap" },
      ],
    };
    expect(matchSchema.parse(match)).toEqual(match);
    expect(matchScore(match)).toEqual({ hit: 2, total: 3 });
    expect(
      matchSchema.safeParse({ items: [{ ...item, requirement: "x", result: "maybe" }] }).success,
    ).toBe(false);
  });

  it("records chat edits with the text they replaced", () => {
    const edits = [{ document: "RESUME", unitId: "summary", text: "New", previousText: "Old" }];
    expect(editsSchema.parse(edits)).toEqual(edits);
    expect(editsSchema.safeParse([{ ...edits[0], document: "LETTER" }]).success).toBe(false);
  });
});
