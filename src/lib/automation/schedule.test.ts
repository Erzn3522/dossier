import { describe, expect, it } from "vitest";

import { nextAutomationRun } from "./schedule";

describe("nextAutomationRun", () => {
  it("uses the server-local hour and advances after the configured time", () => {
    const before = new Date(2026, 9, 18, 7, 59, 30);
    const after = new Date(2026, 9, 18, 8, 0, 1);
    expect(nextAutomationRun(before, "08:00")).toEqual(new Date(2026, 9, 18, 8, 0, 0));
    expect(nextAutomationRun(after, "08:00")).toEqual(new Date(2026, 9, 19, 8, 0, 0));
  });
});
