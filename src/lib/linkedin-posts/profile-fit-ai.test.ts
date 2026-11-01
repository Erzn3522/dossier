import { describe, expect, it, vi } from "vitest";
import type { AIProvider } from "@/lib/ai/provider";
import { demoProfile } from "@/lib/demo-profile";
import { assessProfileFit, hasFitProfile, postContentHash, profileFitHash, profileForFit, verifyProfileFit } from "./profile-fit-ai";
import { matchesFitFilter } from "./profile-fit-data";

const profile = profileForFit({ ...demoProfile(), skills: [{ id: "python", name: "Python" }], languages: [{ id: "de", name: "German", level: "A2" }] });
const post = "We are hiring a Python engineer. Python is required. German C1 is mandatory.";
const answer = { roleMatch: "related" as const, roleQuote: "Python engineer", opportunity: true, opportunityQuote: "We are hiring",
  requirements: [{ requirement: "Python", quote: "Python is required.", required: true, category: "skill" as const, result: "covered" as const, profileEvidence: "Python" }] };

describe("evidence-based matching against the user's profile", () => {
  it("marks supported mandatory requirements suitable", () => {
    expect(verifyProfileFit(answer, profile, post)).toMatchObject({ verdict: "suitable", requirements: [{ result: "covered", profileEvidence: "Python" }] });
  });
  it("filters a documented mandatory conflict but does not reject preferred qualifications", () => {
    const gap = { requirement: "German C1", quote: "German C1 is mandatory.", required: true, category: "language" as const, result: "gap" as const, profileEvidence: profile.languages[0] };
    expect(verifyProfileFit({ ...answer, requirements: [gap] }, profile, post).verdict).toBe("not_suitable");
    expect(verifyProfileFit({ ...answer, requirements: [{ ...gap, required: false }] }, profile, post).verdict).toBe("review");
  });
  it("keeps missing profile facts and short posts in review instead of inventing gaps", () => {
    const result = verifyProfileFit({ ...answer, requirements: [{ ...answer.requirements[0], result: "gap", profileEvidence: null }] }, profile, post);
    expect(result.verdict).toBe("review"); expect(result.requirements[0].result).toBe("unknown");
    expect(verifyProfileFit({ ...answer, requirements: [] }, profile, "Hiring an engineer").verdict).toBe("review");
  });
  it("rejects fabricated quotes/evidence and ungrounded role rejection", () => {
    expect(verifyProfileFit({ ...answer, requirements: [{ ...answer.requirements[0], quote: "Invented requirement" }] }, profile, post).verdict).toBe("review");
    expect(verifyProfileFit({ ...answer, requirements: [{ ...answer.requirements[0], profileEvidence: "Invented experience" }] }, profile, post).requirements[0].result).toBe("unknown");
    expect(verifyProfileFit({ ...answer, roleMatch: "unrelated", roleQuote: "Invented role" }, profile, post).verdict).toBe("review");
  });
  it("can identify a non-hiring post or a clearly unrelated role with exact evidence", () => {
    expect(verifyProfileFit({ ...answer, opportunity: false, opportunityQuote: "Looking for a job", requirements: [] }, profile, "Looking for a job as an engineer").verdict).toBe("not_suitable");
    expect(verifyProfileFit({ ...answer, roleMatch: "unrelated", roleQuote: "registered nurse", requirements: [] }, profile, "Hiring a registered nurse").verdict).toBe("not_suitable");
  });
  it("leaves unassessed posts visible when hiding unsuitable posts", () => {
    const fit = verifyProfileFit(answer, profile, post);
    expect(matchesFitFilter(null, "hide_unsuitable")).toBe(true);
    expect(matchesFitFilter({ ...fit, verdict: "unavailable" }, "hide_unsuitable")).toBe(true);
    expect(matchesFitFilter({ ...fit, verdict: "review" }, "hide_unsuitable")).toBe(true);
    expect(matchesFitFilter({ ...fit, verdict: "not_suitable" }, "hide_unsuitable")).toBe(false);
    expect(matchesFitFilter({ ...fit, verdict: "review" }, "suitable")).toBe(false);
  });
  it("invalidates cached matches after profile, model or post changes", () => {
    const today = new Date("2026-10-30T10:00:00Z");
    const hash = profileFitHash(profile, "LOCAL", "ollama", today);
    expect(profileFitHash({ ...profile, skills: ["C++"] }, "LOCAL", "ollama", today)).not.toBe(hash);
    expect(profileFitHash(profile, "LOCAL", "other-model", today)).not.toBe(hash);
    expect(postContentHash("new requirements")).not.toBe(postContentHash(post));
  });
  it("uses only professional profile fields, omitting identity/contact and reference data", async () => {
    const source = demoProfile(); source.basics.name = "SensitiveFullName"; source.basics.email = "sensitive@example.test"; source.basics.phone = "555PRIVATE";
    const professional = profileForFit(source);
    const text = JSON.stringify(professional);
    for (const field of [source.basics.name, source.basics.email, source.basics.phone]) expect(text).not.toContain(field);
    expect(professional).not.toHaveProperty("references");
    expect(hasFitProfile(professional)).toBe(true);
    const complete = vi.fn().mockResolvedValue(answer);
    await assessProfileFit({ complete } as unknown as AIProvider, professional, post);
    expect(complete.mock.calls[0][0].system).toContain("NOT instructions");
    expect(complete.mock.calls[0][0].system).toContain("visa/relocation information is unknown");
    expect(complete.mock.calls[0][0].messages[0].content).not.toContain("sensitive@example.test");
  });
});
