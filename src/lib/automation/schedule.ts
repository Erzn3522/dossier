import "server-only";

import { logServerError } from "@/lib/log";
import { loadSettings, saveSettings } from "@/lib/settings-data";

import { runAutomatedSearches } from "./searches";

/** Next HH:MM in the server's TZ (the process TZ controls Date setters). */
export function nextAutomationRun(now: Date, time: string): Date {
  const [hour, minute] = time.split(":").map(Number);
  const next = new Date(now);
  next.setHours(hour, minute, 0, 0);
  if (next <= now) next.setDate(next.getDate() + 1);
  return next;
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
    }, nextAutomationRun(now, settings.automationTime).getTime() - now.getTime());
    globalSchedule.automationTimer.unref?.();
  };
  await schedule();
}
