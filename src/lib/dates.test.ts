import { describe, expect, it } from "vitest";

import { daysBetween, formatCalendarDate, formatDate, formatDateTime, formatShortCalendarDate, formatShortDate, formatTime, formatTimestamp } from "./dates";

describe("dates", () => {
  it("shows a calendar date as stored, whatever the time zone", () => {
    expect(formatCalendarDate(new Date("2026-10-15T00:00:00Z"))).toBe("15 Oct 2026");
  });

  it("shows a moment as day, short month and year", () => {
    expect(formatDate(new Date(2026, 8, 27, 14, 30))).toBe("27 Sep 2026");
  });

  it("leaves the year out within the same year", () => {
    const now = new Date(2026, 9, 5);
    expect(formatShortDate(new Date(2026, 9, 3, 9), now)).toBe("3 Oct");
    expect(formatShortDate(new Date(2025, 11, 30, 9), now)).toBe("30 Dec 2025");
  });

  it("shortens a calendar date within the year", () => {
    const now = new Date(2026, 9, 5);
    expect(formatShortCalendarDate(new Date("2026-10-15T00:00:00Z"), now)).toBe("15 Oct");
    expect(formatShortCalendarDate(new Date("2027-01-15T00:00:00Z"), now)).toBe("15 Jan 2027");
  });

  it("shows a moment's weekday, date and time in the user's time zone (E9-9)", () => {
    const at = new Date("2026-10-08T12:00:00Z");
    const now = new Date("2026-09-29T09:00:00Z");
    expect(formatDateTime(at, "Europe/Amsterdam", now)).toBe("Thu 8 Oct, 14:00");
    expect(formatDateTime(at, "America/New_York", now)).toBe("Thu 8 Oct, 08:00");
    expect(formatDateTime(at, "UTC", new Date("2025-12-01T09:00:00Z"))).toBe("Thu 8 Oct 2026, 12:00");
    expect(formatTime(new Date("2026-10-08T21:05:00Z"), "UTC")).toBe("21:05");
  });

  it("counts calendar days in the user's time zone", () => {
    const now = new Date("2026-09-29T21:30:00Z");
    const later = new Date("2026-09-29T23:00:00Z");
    // 23:30 → 01:00 in Amsterdam is the next day; 17:30 → 19:00 in New York is the same one.
    expect(daysBetween(now, later, "Europe/Amsterdam")).toBe(1);
    expect(daysBetween(now, later, "America/New_York")).toBe(0);
    expect(daysBetween(now, new Date("2026-09-28T12:00:00Z"), "UTC")).toBe(-1);
  });
});


describe("SSR timestamps", () => {
  it("uses fixed punctuation even when Intl's combined date/time literals differ", () => {
    const value = new Date("2026-10-30T00:06:00Z");
    const descriptor = Object.getOwnPropertyDescriptor(Intl.DateTimeFormat.prototype, "format")!;
    let combinedLabel = "30 Oct 2026, 01:06";
    Object.defineProperty(Intl.DateTimeFormat.prototype, "format", { ...descriptor, get: () => () => combinedLabel });
    try {
      const server = formatTimestamp(value, "Europe/Ljubljana");
      combinedLabel = "30 Oct 2026 at 01:06";
      expect(formatTimestamp(value, "Europe/Ljubljana")).toBe(server);
      expect(server).toBe("30 Oct 2026, 01:06");
    } finally { Object.defineProperty(Intl.DateTimeFormat.prototype, "format", descriptor); }
  });
  it("uses the supplied time zone, including daylight saving and date rollover", () => {
    expect(formatTimestamp(new Date("2026-10-30T00:06:00Z"), "Europe/Ljubljana")).toBe("30 Oct 2026, 01:06");
    expect(formatTimestamp(new Date("2026-07-30T00:06:00Z"), "Europe/Ljubljana")).toBe("30 Jul 2026, 02:06");
    expect(formatTimestamp(new Date("2026-12-31T23:05:00Z"), "Europe/Ljubljana")).toBe("1 Jan 2027, 00:05");
    expect(formatTimestamp(new Date("2026-10-30T00:06:00Z"))).toBe("30 Oct 2026, 00:06");
  });
  it("handles invalid imported post dates", () => {
    expect(formatTimestamp(new Date("invalid"), "Europe/Ljubljana")).toBe("Date unavailable");
  });
});
