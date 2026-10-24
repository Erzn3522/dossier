import type { SearchQuery } from "@/lib/job-search/search";

export const AUTOMATION_KEYWORDS = '"computer vision" OR "machine vision" OR "perception engineer" OR "machine learning engineer" OR "robotics engineer" OR "image processing"';

const COUNTRIES = [
  ["de", "Germany", ["Berlin", "Munich", "Stuttgart"]],
  ["nl", "Netherlands", ["Amsterdam", "Eindhoven", "Rotterdam"]],
  ["ie", "Ireland", ["Dublin", "Cork"]],
  ["dk", "Denmark", ["Copenhagen", "Aarhus"]],
  ["se", "Sweden", ["Stockholm", "Gothenburg"]],
  ["fi", "Finland", ["Helsinki", "Tampere"]],
  ["at", "Austria", ["Vienna", "Graz"]],
  ["be", "Belgium", ["Brussels", "Leuven"]],
  ["fr", "France", ["Paris", "Toulouse", "Grenoble"]],
  ["lu", "Luxembourg", ["Luxembourg"]],
  ["cz", "Czechia", ["Prague", "Brno"]],
  ["ee", "Estonia", ["Tallinn"]],
  ["pl", "Poland", ["Warsaw", "Kraków"]],
  ["es", "Spain", ["Madrid", "Barcelona"]],
  ["si", "Slovenia", ["Ljubljana", "Maribor", "Celje", "Koper"]],
  ["tr", "Türkiye", ["Istanbul", "Ankara"]],
] as const;

export type AutomationProfileSpec = { name: string; enabled: true; pagesPerRun: 3; query: SearchQuery };

export const AUTOMATION_PROFILE_SPECS: readonly AutomationProfileSpec[] = COUNTRIES.flatMap(([country, countryName, cities]) =>
  cities.map((place) => ({
    name: `${countryName} — ${place}`,
    enabled: true as const,
    pagesPerRun: 3 as const,
    query: {
      keywords: AUTOMATION_KEYWORDS,
      place,
      country,
      radiusKm: country === "si" ? 50 as const : 200 as const,
      remoteOnly: country !== "si",
      postedWithin: "week" as const,
    },
  })),
);

/** First full local minute that is at least two minutes after `now`. */
export function installationSchedule(now: Date, timeZone = "Europe/Ljubljana"): { instant: Date; time: string; timeZone: string } {
  const instant = new Date(Math.ceil((now.getTime() + 120_000) / 60_000) * 60_000);
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-GB", {
    timeZone, hour: "2-digit", minute: "2-digit", hourCycle: "h23",
  }).formatToParts(instant).map((part) => [part.type, part.value]));
  return { instant, time: `${parts.hour}:${parts.minute}`, timeZone };
}
