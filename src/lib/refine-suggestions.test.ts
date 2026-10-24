import { describe, expect, it } from "vitest";

import type { Match, Requirement } from "@/lib/application-data";

import { refineSuggestions } from "./refine-suggestions";

const requirement = (text: string, extra: Partial<Requirement> = {}): Requirement => ({
  text,
  kind: "other",
  skill: null,
  years: null,
  language: null,
  required: false,
  ...extra,
});
const item = (requirement: string, result: "covered" | "partial" | "gap", skill: string | null = null) => ({
  requirement,
  result,
  skill,
  experienceIds: [],
  note: null,
});

describe("refineSuggestions (E8-5)", () => {
  it("builds chips from the strongest match and the first gap", () => {
    const requirements = [
      requirement("5+ years of product design", { kind: "years", years: 5 }),
      requirement("Design systems experience", { kind: "skill", skill: "Design systems" }),
      requirement("Experience with Kubernetes", { kind: "skill", skill: "Kubernetes" }),
    ];
    const match: Match = {
      items: [item(requirements[0].text, "covered"), item(requirements[1].text, "covered", "Design systems"), item(requirements[2].text, "gap")],
    };
    expect(refineSuggestions({ match, requirements, tone: "WARM", hasSummary: true })).toEqual({
      resume: ["Make the summary shorter", "Emphasize Design systems", "Mention Kubernetes"],
      letter: ["Make it more formal", "Shorter, under 200 words", "Handle the Kubernetes gap differently", "Answer the application questions"],
      email: ["Shorter, under 100 words", "Make it more formal", "Lead with Design systems"],
      posting: ["Answer the application questions", "What will they ask in the interview?", "What matters most for this role?"],
    });
  });

  it("names a short gap by its text, and skips a long one", () => {
    const requirements = [requirement("Fintech experience"), requirement("Experience shipping payments products at scale")];
    const short = { items: [item(requirements[0].text, "gap")] };
    expect(refineSuggestions({ match: short, requirements, tone: "WARM", hasSummary: true }).letter.at(-2)).toBe(
      "Handle the fintech experience gap differently",
    );
    const long = { items: [item(requirements[1].text, "gap")] };
    expect(refineSuggestions({ match: long, requirements: requirements.slice(1), tone: "WARM", hasSummary: true }).letter).toHaveLength(3);
  });

  it("falls back to the prototype's chips without a match", () => {
    expect(refineSuggestions({ match: null, requirements: [], tone: "FORMAL", hasSummary: false })).toEqual({
      resume: ["Emphasize leadership", "Mention accessibility"],
      letter: ["Make it warmer", "Shorter, under 200 words", "Answer the application questions"],
      email: ["Shorter, under 100 words", "Make it warmer", "Make the subject line stand out"],
      posting: ["Answer the application questions", "What will they ask in the interview?", "What matters most for this role?"],
    });
  });
});
