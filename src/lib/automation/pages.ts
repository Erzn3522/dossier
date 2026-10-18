export const AUTOMATION_PAGE_OPTIONS = [1, 2, 3] as const;

export type AutomationPagesPerRun = (typeof AUTOMATION_PAGE_OPTIONS)[number];

export function validAutomationPages(value: number): AutomationPagesPerRun {
  return AUTOMATION_PAGE_OPTIONS.includes(value as AutomationPagesPerRun) ? value as AutomationPagesPerRun : 1;
}
