import { describe, expect, it } from "vitest";

import { MockProvider } from "@/lib/ai/providers/mock";
import { demoProfile } from "@/lib/demo-profile";

import { analyzeOutreachCompany, rankOutreachContacts, tailorOutreachResume, writeOutreachEmail, type TaskOptions } from "./index";

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


describe("outreach email perspective", () => {
  const company = { companyName: "Vision Co", score: 90, summary: "Builds inspection systems", capabilities: ["Vision"], hiringSignal: null, reason: "Relevant", evidenceIndexes: [0] };
  const contact = { email: "hello@vision.example", name: null, title: null, sourceUrl: "https://vision.example/", excerpt: "hello@vision.example", role: "general" as const, rankReason: "" };
  const words = (count: number) => Array.from({ length: count }, () => "detail").join(" ");

  it("sends a recruiter-voice draft with a placeholder signature back to the model, and keeps the corrected one", async () => {
    const profile = demoProfile();
    const first = profile.basics.name.split(" ")[0];
    const replies = [
      { subject: "Hello", body: `Hi ${first}! I came across your profile and your experience. ${words(70)}\n\nBest regards,\n[Your Name]` },
      { subject: "Computer vision engineer", body: `Hello Vision Co team, I build computer vision systems and would like to ask about engineering roles. ${words(70)}` },
    ];
    const provider = new MockProvider({ reply: () => replies.shift()! });
    const result = await writeOutreachEmail(provider, { profile, company, contact, pitch: "Profile fit", cta: "A short call", opportunity: "Employment" }, options);
    expect(provider.calls).toHaveLength(2);
    expect(JSON.stringify(provider.calls[1].messages.at(-1))).toMatch(/sender is the job seeker/);
    expect(result.data.body).toMatch(/^Hello Vision Co team/);
    expect(result.data.body).not.toMatch(/\[Your Name\]|your profile/);
    expect(provider.calls[0].system).toMatch(/FROM a job seeker TO a company/);
  });
});
