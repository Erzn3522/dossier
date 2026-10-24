import { describe, expect, it } from "vitest";

import { checkedLanguage, detectTextLanguage } from "./posting-language";

const english = `Are you looking for a role where you can combine theoretical computer vision, hardware integration and robust software development?
Trackman is looking for a Computer Vision Engineer to join our Golf Launch Monitor R&D team in Hørsholm, Denmark. You will work with cameras and radar,
and you will be part of a team that ships the products our customers use every day. We offer a great place to work with the best people in the industry.`;
const danish = `Vil du være med til at udvikle fremtidens teknologi? Vi søger en ingeniør til vores team i Hørsholm. Du får ansvar for at udvikle software,
og du vil arbejde tæt sammen med vores kolleger på tværs af afdelinger. Vi tilbyder en spændende stilling med gode muligheder for udvikling, og du har
erfaring med computer vision og kan lide at arbejde i et team, som er ambitiøst. Det er ikke et krav, at du har erfaring med radar, men det er en fordel.`;

describe("posting language", () => {
  it("tells the language of the sentences, not of the company's country", () => {
    expect(detectTextLanguage(english)).toBe("English");
    // Danish and Norwegian share most short words: too close to call on its own.
    expect(detectTextLanguage(danish)).toBeNull();
    expect(detectTextLanguage("Too short to tell.")).toBeNull();
  });

  it("corrects the model only when the text clearly disagrees", () => {
    expect(checkedLanguage("Danish", english)).toBe("English");
    expect(checkedLanguage("Danish", danish)).toBe("Danish");
    // A close call keeps the model's answer.
    expect(checkedLanguage("Norwegian", danish)).toBe("Norwegian");
    expect(checkedLanguage(null, english)).toBe("English");
    expect(checkedLanguage("German", "Kurz.")).toBe("German");
  });
});
