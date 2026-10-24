import { describe, expect, it } from "vitest";

import { adviceFromMatch } from "./resume-advice";

describe("adviceFromMatch", () => {
  it("turns gaps and skills without a role into advice, and skips what's covered", () => {
    const advice = adviceFromMatch({
      items: [
        { requirement: "Python", result: "covered", skill: "Python", experienceIds: ["e1"], note: null },
        { requirement: "ROS 2", result: "gap", skill: null, experienceIds: [], note: "Not in your profile yet" },
        { requirement: "OpenCV", result: "partial", skill: "OpenCV", experienceIds: [], note: null },
      ],
    });
    expect(advice).toEqual([
      expect.objectContaining({ area: "Missing requirement", reason: "Not in your profile yet", from: "match" }),
      expect.objectContaining({ area: "Skills", from: "match" }),
    ]);
    expect(advice[0].suggestion).toContain('"ROS 2"');
    expect(advice[0].suggestion).toMatch(/^The posting asks for/);
    expect(advice[1].suggestion).toContain('"OpenCV"');
  });
});
