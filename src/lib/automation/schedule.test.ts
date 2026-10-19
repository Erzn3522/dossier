import { describe, expect, it } from "vitest";

import { dayBoundsIn, nextAutomationRun } from "./schedule";

describe("nextAutomationRun", () => {
  it("uses the selected zone and advances after the configured time", () => {
    const before = new Date("2026-10-18T05:59:30Z");
    const after = new Date("2026-10-18T06:00:01Z");
    expect(nextAutomationRun(before, "08:00", "Europe/Ljubljana")).toEqual(new Date("2026-10-18T06:00:00Z"));
    expect(nextAutomationRun(after, "08:00", "Europe/Ljubljana")).toEqual(new Date("2026-10-19T06:00:00Z"));
  });

  it("follows daylight-saving changes in the selected zone", () => {
    expect(nextAutomationRun(new Date("2026-10-24T08:00:00Z"), "08:00", "Europe/Ljubljana")).toEqual(new Date("2026-10-25T07:00:00Z"));
  });

  it("uses local calendar-day boundaries for daily outreach limits", () => {
    expect(dayBoundsIn(new Date("2026-10-19T12:00:00Z"), "Europe/Ljubljana")).toEqual({
      start: new Date("2026-10-18T22:00:00Z"),
      end: new Date("2026-10-19T22:00:00Z"),
    });
  });
});
