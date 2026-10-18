export const DEFAULT_AUTOMATION_TIME_ZONE = "UTC";

/** Whether Intl recognises an IANA time-zone name such as Europe/Ljubljana. */
export function isTimeZone(value: string): boolean {
  if (!value || value.length > 100) return false;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: value }).format();
    return true;
  } catch {
    return false;
  }
}

/** Every zone this JavaScript runtime supports, plus any saved/default values. */
export function supportedTimeZones(...include: string[]): string[] {
  const zones = typeof Intl.supportedValuesOf === "function" ? Intl.supportedValuesOf("timeZone") : [];
  return [...new Set([DEFAULT_AUTOMATION_TIME_ZONE, ...include.filter(isTimeZone), ...zones])].sort((a, b) => a.localeCompare(b, "en"));
}
