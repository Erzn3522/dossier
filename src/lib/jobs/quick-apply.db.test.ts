import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

import { MockProvider } from "@/lib/ai/providers/mock";
import { QUICK_APPLY_STEPS } from "@/lib/quick-apply";
import { createTestClient, resetDatabase } from "@/test/db";
import { seedBuiltIns } from "../../../prisma/seed/built-ins";

import { quickApplyJob } from "./quick-apply";

const db = vi.hoisted(() => ({ client: undefined as ReturnType<typeof createTestClient> | undefined }));
vi.mock("@/lib/prisma", async () => {
  const { createTestClient } = await import("@/test/db");
  db.client = createTestClient();
  return { prisma: db.client };
});
const provider = vi.hoisted(() => ({ current: undefined as unknown }));
vi.mock("@/lib/ai", () => ({ getAiProvider: async () => provider.current }));
vi.mock("@/lib/ai/task-options", () => ({ loadTaskOptions: async () => ({ creativity: "BALANCED", strict: true, language: null }) }));
vi.mock("@/lib/profile-data", async () => {
  const { demoProfile } = await import("@/lib/demo-profile");
  return { loadProfile: async () => demoProfile() };
});
vi.mock("@/lib/one-page", () => ({ fitResumeToOnePage: async () => ({ trimmed: [], fits: true }), describeTrim: () => [] }));
vi.mock("./runner", () => ({ defineJob: <T,>(definition: T) => definition }));

const prisma = () => db.client!;
const posting = "Ledgerly is hiring a Vision Engineer in Berlin. You must know Kubernetes. Apply to jobs@ledgerly.example.";

const replies: Record<string, unknown> = {
  extracted_posting: {
    title: "Vision Engineer · Ledgerly", company: "Ledgerly", role: "Vision Engineer", location: "Berlin", mode: null, salary: null, deadline: null,
    requirements: [{ text: "Kubernetes", kind: "skill", required: true, years: null, language: null, skill: "Kubernetes" }],
    asksForReferences: false, language: "English", contactName: null, contactEmail: "jobs@ledgerly.example",
  },
  requirement_matches: { matches: [{ requirement: 0, skill: null, language: null }] },
  resume_advice: { suggestions: [{ area: "Summary", suggestion: "Open the summary with your vision work.", reason: "The role is about vision." }] },
  tailored_resume: { summary: "Product designer.", roles: [], skills: ["Figma"], education: [] },
  cover_letter: { recipient: "Ledgerly · Hiring team", greeting: "Dear Ledgerly team,", paragraphs: [{ label: "Opening", text: "I'd love to join Ledgerly." }], signOff: "Warm regards," },
  application_email: { contactName: null, contactEmail: "jobs@ledgerly.example", subject: "Application: Vision Engineer", greeting: "Dear Ledgerly team,", paragraphs: ["My CV and letter are attached."], signOff: "Warm regards," },
};

beforeEach(async () => {
  await resetDatabase(prisma());
  await seedBuiltIns(prisma());
  provider.current = new MockProvider({ reply: (call) => replies[call.json?.name ?? ""] });
});
afterAll(() => prisma().$disconnect());

describe("quickApplyJob", () => {
  it("creates a draft application with CV advice, letter and email, naming each step", async () => {
    const steps: string[] = [];
    const { applicationId } = await quickApplyJob.run(
      { posting, postingUrl: "https://ledgerly.example/jobs/1", recipient: "", note: "" },
      { step: async (name) => void steps.push(name), signal: new AbortController().signal },
    );
    expect(steps).toEqual([...QUICK_APPLY_STEPS]);
    const application = await prisma().application.findUniqueOrThrow({ where: { id: applicationId }, include: { documents: true } });
    expect(application).toMatchObject({ company: "Ledgerly", role: "Vision Engineer", reviewState: "NORMAL", postingUrl: "https://ledgerly.example/jobs/1" });
    expect(application.documents.map((document) => document.kind).sort()).toEqual(["COVER_LETTER", "EMAIL", "RESUME"]);
    expect(application.resumeAdvice).toEqual([
      expect.objectContaining({ area: "Missing requirement", from: "match" }),
      { area: "Summary", suggestion: "Open the summary with your vision work.", reason: "The role is about vision.", from: "ai" },
    ]);
    const email = application.documents.find((document) => document.kind === "EMAIL")!.units as { id: string; text: string }[];
    expect(email.find((unit) => unit.id === "to")?.text).toBe("jobs@ledgerly.example");
  });

  it("says the text isn't a posting when reading it rambles until it's cut off", async () => {
    provider.current = { complete: async () => { const { AiError } = await import("@/lib/ai/errors"); throw AiError.of("cut-off"); } };
    await expect(quickApplyJob.run({ posting: "Skip to content. Cookie notice.", postingUrl: "", recipient: "", note: "" }, { step: async () => {}, signal: new AbortController().signal }))
      .rejects.toThrow(/couldn't read a job posting in that text/);
    expect(await prisma().application.count()).toBe(0);
  });

  it("sends to the address the user gave instead of the posting's", async () => {
    const { applicationId } = await quickApplyJob.run(
      { posting, postingUrl: "", recipient: "hiring@other.example", note: "" },
      { step: async () => {}, signal: new AbortController().signal },
    );
    const document = await prisma().document.findFirstOrThrow({ where: { applicationId, kind: "EMAIL" } });
    expect((document.units as { id: string; text: string }[]).find((unit) => unit.id === "to")?.text).toBe("hiring@other.example");
  });
});
