import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { createTestClient, resetDatabase } from "@/test/db";

import { queueApprovedOutreach } from "./schedule";

const client = createTestClient();
const prisma = () => client;

beforeEach(async () => {
  await resetDatabase(prisma());
  await prisma().setting.createMany({ data: [
    { key: "outreachEnabled", value: "true" },
    { key: "outreachAcknowledged", value: "true" },
    { key: "outreachTimeZone", value: "UTC" },
    { key: "outreachDailySendLimit", value: "5" },
  ] });
});
afterAll(() => prisma().$disconnect());

describe("outreach daily queue", () => {
  it("queues only five individually approved leads, five minutes apart, and leaves the rest for another day", async () => {
    const campaign = await prisma().outreachCampaign.create({ data: {
      name: "Vision", keywords: ["computer vision"], countries: ["Europe"], remote: true,
      targetRole: "Vision Engineer", opportunity: "Employment", pitch: "Profile fit", cta: "A short call", language: "English",
    } });
    await prisma().outreachLead.createMany({ data: Array.from({ length: 7 }, (_, index) => ({
      campaignId: campaign.id,
      companyName: `Company ${index}`,
      domain: `company-${index}.example`,
      website: `https://company-${index}.example/`,
      status: "APPROVED" as const,
      approvedAt: new Date(`2026-10-19T0${index}:00:00Z`),
    })) });
    const now = new Date("2026-10-19T09:00:00Z");

    expect(await queueApprovedOutreach(now)).toBe(5);
    const leads = await prisma().outreachLead.findMany({ orderBy: { approvedAt: "asc" }, select: { status: true, queuedFor: true } });
    expect(leads.slice(0, 5).map((lead) => lead.status)).toEqual(Array(5).fill("QUEUED"));
    expect(leads.slice(0, 5).map((lead) => lead.queuedFor?.toISOString())).toEqual([
      "2026-10-19T09:00:00.000Z", "2026-10-19T09:05:00.000Z", "2026-10-19T09:10:00.000Z", "2026-10-19T09:15:00.000Z", "2026-10-19T09:20:00.000Z",
    ]);
    expect(leads.slice(5).map((lead) => lead.status)).toEqual(["APPROVED", "APPROVED"]);
    expect(await queueApprovedOutreach(new Date("2026-10-19T10:00:00Z"))).toBe(0);
  });
});

