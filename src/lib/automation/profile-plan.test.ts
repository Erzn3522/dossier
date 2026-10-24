import { describe, expect, it } from "vitest";
import { AUTOMATION_PROFILE_SPECS, installationSchedule } from "./profile-plan";

describe("automation profile plan", () => {
  it("defines exactly 35 enabled weekly three-page profiles", () => {
    expect(AUTOMATION_PROFILE_SPECS).toHaveLength(35);
    expect(AUTOMATION_PROFILE_SPECS.every((profile) => profile.enabled && profile.pagesPerRun === 3 && profile.query.postedWithin === "week")).toBe(true);
  });

  it("only makes the four Slovenian profiles non-remote with a 50 km radius", () => {
    const local = AUTOMATION_PROFILE_SPECS.filter((profile) => !profile.query.remoteOnly);
    expect(local.map((profile) => profile.query.place)).toEqual(["Ljubljana", "Maribor", "Celje", "Koper"]);
    expect(local.every((profile) => profile.query.country === "si" && profile.query.radiusKm === 50)).toBe(true);
    expect(AUTOMATION_PROFILE_SPECS.filter((profile) => profile.query.country !== "si").every((profile) => profile.query.remoteOnly && profile.query.radiusKm === 200)).toBe(true);
  });

  it("chooses a full minute at least two minutes ahead", () => {
    const result = installationSchedule(new Date("2026-10-24T04:34:28.911Z"));
    expect(result.instant.toISOString()).toBe("2026-10-24T04:37:00.000Z");
    expect(result.timeZone).toBe("Europe/Ljubljana");
  });
});
