import { describe, expect, it } from "vitest";

import { MockProvider } from "@/lib/ai/providers/mock";
import { demoProfile } from "@/lib/demo-profile";

import { analyzeOutreachCompany, rankOutreachContacts, tailorOutreachResume, type TaskOptions } from "./index";

const options: TaskOptions = { creativity: "BALANCED", strict: true, language: "English" };

describe("outreach AI boundaries", () => {
  it("drops evidence citations that were not supplied", async () => {
    const provider = new MockProvider({ reply: () => ({ companyName: "Vision Co", score: 82, summary: "Builds visual inspection systems.", capabilities: ["Visual inspection"], hiringSignal: null, reason: "Direct product evidence.", evidenceIndexes: [0, 99] }) });
    const result = await analyzeOutreachCompany(provider, {
      pages: [{ url: "https://vision.example/", title: "Home", excerpt: "We build visual inspection systems." }],
      keywords: ["computer vision"], targetRole: "Computer Vision Engineer", opportunity: "Employment",
    }, options);
    expect(result.data.evidenceIndexes).toEqual([0]);
    expect(provider.calls[0].system).toMatch(/numbered evidence/);
  });

  it("lets the model return only indexes, never an invented contact", async () => {
    const provider = new MockProvider({ reply: () => ({ ranked: [{ index: 7, reason: "Invented" }, { index: 0, reason: "Recruiting address" }] }) });
    const contacts = [{ email: "talent@example.com", name: null, title: null, sourceUrl: "https://example.com/careers", excerpt: "talent@example.com", role: "recruiting" as const, rankReason: "" }];
    const result = await rankOutreachContacts(provider, { contacts, targetRole: "Vision Engineer", opportunity: "Employment" }, options);
    expect(result.data).toEqual([{ ...contacts[0], rankReason: "Recruiting address" }]);
    expect(provider.calls[0].system).toMatch(/Never create, repair, infer or rewrite an email address/);
  });

  it("drops skills and entries that are not in the profile and replaces unsupported claims", async () => {
    const profile = demoProfile();
    const provider = new MockProvider({ reply: () => ({
      summary: "Computer vision specialist at Imaginary Labs with 99 patents.",
      roles: [{ id: "not-a-profile-role", bullets: ["Invented a role"] }],
      skills: [profile.skills[0].name, "CUDA"],
      education: [],
    }) });
    const result = await tailorOutreachResume(provider, {
      profile,
      company: { companyName: "Vision Co", score: 90, summary: "Computer vision products", capabilities: ["Vision"], hiringSignal: null, reason: "Relevant", evidenceIndexes: [0] },
      targetRole: "Computer Vision Engineer", opportunity: "Employment",
    }, options);
    expect(result.data.find((unit) => unit.id === "skills")?.text).toBe(profile.skills[0].name);
    expect(result.data.some((unit) => unit.id.includes("not-a-profile-role"))).toBe(false);
    expect(result.data.find((unit) => unit.id === "summary")?.text).toBe(profile.basics.summary);
    expect(JSON.stringify(result.data)).not.toMatch(/Imaginary|99 patents|CUDA/);
  });
});

