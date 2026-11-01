import { describe, expect, it, vi } from "vitest";
import { exportSchema, EXPORT_SCHEMA_VERSION } from "@/lib/data-export";

vi.mock("@/lib/env", () => ({ env: { DOSSIER_SECRET: "s".repeat(32) } }));
const date = "2026-10-30T10:00:00.000Z";
const old = { format: "dossier-export", schemaVersion: 6, appVersion: "test", exportedAt: date,
  profile: { fields: [], skills: [], languages: [], experience: [], education: [], references: [] }, themes: [], settings: [], applications: [] };
const campaign = { id: "campaign", input: { keywords: ["Computer Vision"], countries: ["Slovenia"], rounds: 3, budgetUsd: 1, maxPosts: 20, authors: [], postedWithin: "month", since: "" },
  status: "PAUSED", provider: "LOCAL", model: "ollama-test", error: null, createdAt: date, updatedAt: date, attempts: [], posts: [] };
describe("campaign export compatibility", () => {
  it("reads pre-campaign exports with an empty AI campaign history", () => {
    expect(exportSchema.parse(old).linkedInCampaigns).toEqual([]);
  });
  it("keeps typed campaign settings and rejects damaged inputs before import", () => {
    const file = { ...old, schemaVersion: EXPORT_SCHEMA_VERSION, linkedInCampaigns: [campaign] };
    expect(exportSchema.parse(file).linkedInCampaigns[0].input).toMatchObject({ rounds: 3, countries: ["Slovenia"] });
    expect(exportSchema.safeParse({ ...file, linkedInCampaigns: [{ ...campaign, input: { ...campaign.input, rounds: 1000 } }] }).success).toBe(false);
  });
});
