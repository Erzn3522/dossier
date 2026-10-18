import "server-only";

import { logServerError } from "@/lib/log";
import { loadSettings, saveSettings } from "@/lib/settings-data";

import { runAutomatedSearches } from "./searches";

type DateParts = { year: number; month: number; day: number; hour: number; minute: number };

const formatters = new Map<string, Intl.DateTimeFormat>();

function partsIn(date: Date, timeZone: string): DateParts {
  let formatter = formatters.get(timeZone);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat("en-CA", {
      timeZone,
      year: "numeric",
      month: "numeric",
      day: "numeric",
      hour: "numeric",
      minute: "numeric",
      hourCycle: "h23",
    });
    formatters.set(timeZone, formatter);
  }
  const values = Object.fromEntries(formatter.formatToParts(date).map((part) => [part.type, Number(part.value)]));
  return { year: values.year, month: values.month, day: values.day, hour: values.hour, minute: values.minute };
}

/** Converts a wall-clock time to an instant, or null when that minute does not exist during a DST jump. */
function instantIn(parts: DateParts, timeZone: string): Date | null {
  const target = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute);
  let instant = target;
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const shown = partsIn(new Date(instant), timeZone);
    const correction = target - Date.UTC(shown.year, shown.month - 1, shown.day, shown.hour, shown.minute);
    if (correction === 0) break;
    instant += correction;
  }
  const candidate = new Date(instant);
  const shown = partsIn(candidate, timeZone);
  return Object.entries(parts).every(([key, value]) => shown[key as keyof DateParts] === value) ? candidate : null;
}

/** Next HH:MM in the selected IANA time zone, including daylight-saving changes. */
export function nextAutomationRun(now: Date, time: string, timeZone: string): Date {
  const [hour, minute] = time.split(":").map(Number);
  const today = partsIn(now, timeZone);
  const firstDay = Date.UTC(today.year, today.month - 1, today.day);
  for (let offset = 0; offset < 370; offset += 1) {
    const day = new Date(firstDay + offset * 86_400_000);
    const candidate = instantIn({ year: day.getUTCFullYear(), month: day.getUTCMonth() + 1, day: day.getUTCDate(), hour, minute }, timeZone);
    if (candidate && candidate > now) return candidate;
  }
  throw new Error(`Could not schedule ${time} in ${timeZone}.`);
}

const globalSchedule = globalThis as unknown as { automationTimer?: ReturnType<typeof setTimeout> };

export async function startAutomationSchedule(reset = false): Promise<void> {
  if (reset && globalSchedule.automationTimer) clearTimeout(globalSchedule.automationTimer);
  if (globalSchedule.automationTimer && !reset) return;
  const schedule = async () => {
    const settings = await loadSettings();
    const now = new Date();
    globalSchedule.automationTimer = setTimeout(() => {
      void runAutomatedSearches({ scheduled: true })
        .catch(async (error) => {
          logServerError("automation schedule", error);
          await saveSettings({ automationProblem: error instanceof Error ? error.message : "The daily search failed." }).catch(() => {});
        })
        .finally(schedule);
    }, nextAutomationRun(now, settings.automationTime, settings.automationTimeZone).getTime() - now.getTime());
    globalSchedule.automationTimer.unref?.();
  };
  await schedule();
}
