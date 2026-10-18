import type { Metadata } from "next";
import { headers } from "next/headers";

import { loadAiConfig, loadAiSettingsView } from "@/lib/ai/config";
import { jobSearchView, loadJobSearchConfig } from "@/lib/job-search/config";
import { providerOption } from "@/lib/ai/provider-options";
import { lastNightlyBackup } from "@/lib/backup-schedule";
import { backupsDir } from "@/lib/backups";
import { exportFileName } from "@/lib/data-export";
import { formatShortDate } from "@/lib/dates";
import { env } from "@/lib/env";
import { appVersion } from "@/lib/version";
import { prisma } from "@/lib/prisma";
import { loadProfileName } from "@/lib/profile-data";
import { loadSettings } from "@/lib/settings-data";
import { supportedTimeZones } from "@/lib/time-zones";
import { availableUpdate } from "@/lib/update-check";
import { USAGE_PING_HOST, usagePingEnabled } from "@/lib/usage-ping";

import { AiBehaviour } from "./ai-behaviour";
import { AiProviderSection } from "./ai-provider-section";
import { DataSection } from "./data-section";
import { DocumentsSection } from "./documents-section";
import { JobSearchSection } from "./job-search-section";
import { AboutSection, type AboutFacts } from "./about-section";
import { settingsSectionFromParam } from "./sections";
import { SettingsScreen } from "./settings-screen";
import { AutomationSection } from "./automation-section";
import { gmailConnectionView } from "@/lib/gmail/client";

export const metadata: Metadata = { title: "Settings" };

/** Settings (PRD §6.8); the section is in `?section=` (E10-1). */
export default async function SettingsPage({ searchParams }: PageProps<"/settings">) {
  const params = await searchParams;
  const section = settingsSectionFromParam(params.section);
  const settings = await loadSettings();

  return (
    <SettingsScreen section={section}>
      {section === "ai" ? (
        <>
          <AiProviderSection initial={await loadAiSettingsView()} />
          <AiBehaviour initial={{ creativity: settings.creativity, strict: settings.strict, showDiff: settings.showDiff }} />
        </>
      ) : section === "jobs" ? (
        <JobSearchSection initial={jobSearchView(await loadJobSearchConfig())} />
      ) : section === "automation" ? (
        <AutomationSection
          initial={{
            enabled: settings.automationEnabled,
            time: settings.automationTime,
            timeZone: settings.automationTimeZone,
            threshold: settings.automationMatchThreshold,
            blockCriticalGaps: settings.automationBlockCriticalGaps,
            problem: settings.automationProblem,
          }}
          timeZones={supportedTimeZones(settings.automationTimeZone, "Europe/Ljubljana")}
          gmail={await gmailConnectionView()}
          gmailProblem={gmailProblem(params.gmail)}
        />
      ) : section === "data" ? (
        <DataSection
          hasApiKey={[settings.apiKeyEnc, settings.jsearchKeyEnc, settings.adzunaKeyEnc].some((key) => key !== null)}
          exportName={exportFileName()}
          backups={{
            on: settings.nightlyBackup,
            retentionDays: env.DOSSIER_BACKUP_RETENTION_DAYS,
            dir: backupsDir(),
            lastRun: whenRan(await lastNightlyBackup()),
            problem: settings.backupProblem,
          }}
          jobRetentionHours={settings.jobRetentionHours}
        />
      ) : section === "documents" ? (
        <DocumentsSection
          // Only these fields: the settings also hold the encrypted API key, which never leaves the server.
          initial={{
            paper: settings.paper,
            dateFormat: settings.dateFormat,
            defaultTone: settings.defaultTone,
            docLanguage: settings.docLanguage,
            customLanguages: settings.customLanguages,
            fileNamePattern: settings.fileNamePattern,
            includeRefs: settings.includeRefs,
            onePage: settings.onePage,
          }}
          preview={await filePreview()}
        />
      ) : (
        <AboutSection
          facts={await aboutFacts()}
          usagePingHost={USAGE_PING_HOST}
          updates={{ daily: settings.updateCheck, available: availableUpdate(settings) }}
        />
      )}
    </SettingsScreen>
  );
}

function gmailProblem(value: string | string[] | undefined): string | null {
  const result = Array.isArray(value) ? value[0] : value;
  if (result === "missing-scope") return "Google did not grant the Gmail send permission. Reconnect and approve ‘Send email on your behalf’.";
  if (result === "invalid") return "The Gmail connection return was invalid or expired. Start Connect Gmail again.";
  if (result === "failed") return "Google could not complete the Gmail connection. Try connecting again.";
  return null;
}

/** The file name preview uses your name and your latest application, or sample values (SET-8). */
async function filePreview() {
  const [name, latest] = await Promise.all([
    loadProfileName(),
    prisma.application.findFirst({ where: { reviewState: "NORMAL" }, orderBy: { createdAt: "desc" }, select: { company: true, role: true } }),
  ]);
  return {
    name: name.trim() || "Jane Doe",
    company: latest?.company.trim() || "Ledgerly",
    role: latest?.role.trim() || "Senior Product Designer",
  };
}

/** "today at 03:00", "yesterday at 03:00" or "on 25 Sep at 03:00", in the server's time zone. */
function whenRan(date: Date | null, now = new Date()): string | null {
  if (!date) return null;
  const time = date.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
  const day = (value: Date) => new Date(value.getFullYear(), value.getMonth(), value.getDate()).getTime();
  const days = Math.round((day(now) - day(date)) / 86_400_000);
  if (days === 0) return `today at ${time}`;
  if (days === 1) return `yesterday at ${time}`;
  return `on ${formatShortDate(date, now)} at ${time}`;
}

/** "12.4 MB" */
function formatBytes(bytes: number): string {
  const units = ["B", "KB", "MB", "GB", "TB"];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${unit === 0 ? value : value.toFixed(1)} ${units[unit]}`;
}

/** The About rows (SET-12). */
async function aboutFacts(): Promise<AboutFacts> {
  const requestHeaders = await headers();
  const host = requestHeaders.get("x-forwarded-host")?.split(",")[0]?.trim() || requestHeaders.get("host") || "Unknown";
  const [[database], ai, applications, settings] = await Promise.all([
    prisma.$queryRaw<{ size: bigint }[]>`SELECT pg_database_size(current_database()) AS size`,
    loadAiConfig(),
    prisma.application.count({ where: { reviewState: "NORMAL" } }),
    loadSettings(),
  ]);
  return [
    { label: "Version", value: appVersion },
    { label: "Server", value: host },
    { label: "Database", value: `PostgreSQL · ${formatBytes(Number(database.size))}` },
    { label: "Sign-in", value: "set via DOSSIER_PASSWORD" },
    { label: "AI", value: [providerOption(ai.provider).name, ai.model].filter(Boolean).join(" · ") },
    { label: "Applications", value: String(applications) },
    ...usagePingFacts(settings.usagePingId),
  ];
}

/** Whether the usage ping is on, and the install ID it sends. */
function usagePingFacts(id: string | null): AboutFacts {
  if (process.env.NODE_ENV !== "production") return [{ label: "Usage ping", value: "off in development" }];
  if (!usagePingEnabled()) return [{ label: "Usage ping", value: "off (DOSSIER_TELEMETRY=off)" }];
  return [
    { label: "Usage ping", value: "on" },
    { label: "Install ID", value: id ?? "made with the first ping" },
  ];
}
