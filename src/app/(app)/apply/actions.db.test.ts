import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

import { startJob } from "@/lib/jobs/runner";
import { createTestClient, resetDatabase } from "@/test/db";

import { saveQuickApplyEmail, startQuickApply } from "./actions";

const db = vi.hoisted(() => ({ client: undefined as ReturnType<typeof createTestClient> | undefined }));
vi.mock("@/lib/prisma", async () => {
  const { createTestClient } = await import("@/test/db");
  db.client = createTestClient();
  return { prisma: db.client };
});
vi.mock("@/lib/auth/session", () => ({
  getSession: async () => ({ persistent: false, issuedAt: new Date(), expiresAt: new Date(Date.now() + 60_000) }),
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/ai/config", () => ({ isAiConfigured: async () => true }));
vi.mock("@/lib/jobs/runner", () => ({ startJob: vi.fn(async () => "job-1"), defineJob: <T,>(definition: T) => definition }));
const prisma = () => db.client!;

beforeEach(async () => {
  await resetDatabase(prisma());
  vi.mocked(startJob).mockClear();
});
afterAll(() => prisma().$disconnect());

describe("Quick apply actions", () => {
  it("starts the job ahead of the queue with a clean link and recipient", async () => {
    expect(await startQuickApply({ posting: " Vision Engineer at Ledgerly ", postingUrl: "ledgerly.example/jobs/1", recipient: "Jobs <jobs@ledgerly.example>", note: "" }))
      .toEqual({ ok: true, data: "job-1" });
    expect(vi.mocked(startJob).mock.calls[0].slice(1)).toEqual([
      { posting: "Vision Engineer at Ledgerly", postingUrl: "https://ledgerly.example/jobs/1", recipient: "jobs@ledgerly.example", note: "" },
      { first: true },
    ]);
  });

  it("refuses an empty posting or a malformed recipient", async () => {
    expect(await startQuickApply({ posting: " ", postingUrl: "", recipient: "", note: "" })).toMatchObject({ ok: false });
    expect(await startQuickApply({ posting: "A job", postingUrl: "", recipient: "not an email", note: "" })).toMatchObject({ ok: false, error: "Enter one email address, or leave it empty." });
    expect(startJob).not.toHaveBeenCalled();
  });

  it("saves the edited email over the written one, or creates it", async () => {
    await prisma().application.create({
      data: { id: "app-1", documents: { create: { kind: "EMAIL", units: [{ id: "to", label: "Recipient", text: "" }, { id: "subject", label: "Subject", text: "Old" }, { id: "body", label: "Message", text: "Old" }] } } },
    });
    await prisma().application.create({ data: { id: "app-2" } });
    expect(await saveQuickApplyEmail({ id: "app-1", to: "jobs@ledgerly.example", subject: "New", body: "Hello " })).toMatchObject({ ok: true, toast: "Email saved." });
    expect(await saveQuickApplyEmail({ id: "app-2", to: "", subject: "Hi", body: "There" })).toMatchObject({ ok: true });
    const texts = async (applicationId: string) =>
      ((await prisma().document.findFirstOrThrow({ where: { applicationId, kind: "EMAIL" } })).units as { text: string }[]).map((unit) => unit.text);
    expect(await texts("app-1")).toEqual(["jobs@ledgerly.example", "New", "Hello"]);
    expect(await texts("app-2")).toEqual(["", "Hi", "There"]);
    expect(await saveQuickApplyEmail({ id: "gone", to: "", subject: "", body: "" })).toMatchObject({ ok: false, error: "That application no longer exists." });
  });
});
