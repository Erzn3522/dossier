import "server-only";

import { env, type Env } from "@/lib/env";
import { decryptSecret, JOB_SOURCE_KEY, SecretUnreadable } from "@/lib/secrets";
import type { SettingsData } from "@/lib/settings";
import { loadSettings } from "@/lib/settings-data";

import type { RequestContext, SourceCredentials } from "./adapter";
import { JobSearchError, jobSearchError } from "./errors";
import type { JobSource, JSearchHost } from "./search";
import { SOURCE_INFO, type JobKeyState, type JobSearchSettingsView } from "./sources";

// Which job source to search, and with which key (E14-4): what's saved in
// Settings, or else the DOSSIER_JOBS_* variables. Each source keeps its own
// key, so a key only ever goes to the source it's for.

export type JobSearchConfig = {
  /** The source in effect; null while job search is off. */
  source: JobSource | null;
  /** Whether the choice is saved in Settings, rather than coming from DOSSIER_JOBS_SOURCE. */
  saved: boolean;
  jsearch: { key: string | null; host: JSearchHost; keyState: JobKeyState };
  adzuna: { appId: string; key: string | null; keyState: JobKeyState };
};

type SavedJobSettings = Pick<SettingsData, "jobSource" | "jsearchKeyEnc" | "jsearchHost" | "adzunaAppId" | "adzunaKeyEnc">;
type JobEnv = Pick<Env, "DOSSIER_JOBS_SOURCE" | "DOSSIER_JSEARCH_KEY" | "DOSSIER_JSEARCH_HOST" | "DOSSIER_ADZUNA_APP_ID" | "DOSSIER_ADZUNA_KEY">;

const FROM_ENV: Record<NonNullable<Env["DOSSIER_JOBS_SOURCE"]>, JobSource | null> = {
  jsearch: "JSEARCH",
  adzuna: "ADZUNA",
  arbeitsagentur: "ARBEITSAGENTUR",
  "remote-ok": "REMOTE_OK",
  remotive: "REMOTIVE",
  "we-work-remotely": "WE_WORK_REMOTELY",
  himalayas: "HIMALAYAS",
  jobicy: "JOBICY",
  arbeitnow: "ARBEITNOW",
  off: null,
};

/** A saved key, decrypted, or else the environment's. */
function keyOf(stored: string | null, fromEnv: string | undefined, secret?: string): { key: string | null; keyState: JobKeyState } {
  if (stored) {
    try {
      return { key: decryptSecret(JOB_SOURCE_KEY, stored, secret), keyState: "set" };
    } catch (error) {
      if (!(error instanceof SecretUnreadable)) throw error;
      return { key: null, keyState: "unreadable" };
    }
  }
  return fromEnv ? { key: fromEnv, keyState: "env" } : { key: null, keyState: "none" };
}

export function resolveJobSearchConfig(saved: SavedJobSettings, source: JobEnv, secret?: string): JobSearchConfig {
  const jsearchKey = keyOf(saved.jsearchKeyEnc, source.DOSSIER_JSEARCH_KEY, secret);
  return {
    source: saved.jobSource ? (saved.jobSource === "OFF" ? null : saved.jobSource) : source.DOSSIER_JOBS_SOURCE ? FROM_ENV[source.DOSSIER_JOBS_SOURCE] : null,
    saved: saved.jobSource !== null,
    jsearch: {
      ...jsearchKey,
      // An environment key goes with the environment's host, when it names one.
      host: jsearchKey.keyState === "env" && source.DOSSIER_JSEARCH_HOST ? source.DOSSIER_JSEARCH_HOST : saved.jsearchHost,
    },
    adzuna: {
      appId: saved.adzunaAppId ?? source.DOSSIER_ADZUNA_APP_ID ?? "",
      ...keyOf(saved.adzunaKeyEnc, source.DOSSIER_ADZUNA_KEY, secret),
    },
  };
}

/** The job search configuration in effect right now. */
export async function loadJobSearchConfig(): Promise<JobSearchConfig> {
  return resolveJobSearchConfig(await loadSettings(), env);
}

/** What Settings → Job search shows: the source and the keys' states, never the keys. */
export function jobSearchView(config: JobSearchConfig): JobSearchSettingsView {
  return {
    source: config.source ?? "OFF",
    jsearch: { host: config.jsearch.host, keyState: config.jsearch.keyState },
    adzuna: { appId: config.adzuna.appId, keyState: config.adzuna.keyState },
  };
}

/**
 * Where a source's requests go: its own address, unless the end-to-end
 * tests point every source at their fake one (DOSSIER_JOBS_TEST_BASE_URL).
 */
export function requestContext(source: JobSource, base = env.DOSSIER_JOBS_TEST_BASE_URL): RequestContext {
  return base ? { baseUrl: `${base.replace(/\/+$/, "")}/${source.toLowerCase()}` } : {};
}

/** The key a source needs, or a JobSearchError saying what's missing. */
export function credentialsFor<S extends JobSource>(config: JobSearchConfig, source: S): SourceCredentials[S] {
  const missing = (keyState: JobKeyState) =>
    keyState === "unreadable"
      ? new JobSearchError("no-key", `Your saved ${SOURCE_INFO[source].name} key can't be read. Enter it again in Settings → Job search.`)
      : jobSearchError("no-key", source);
  switch (source) {
    case "JSEARCH": {
      const { key, host, keyState } = config.jsearch;
      if (!key) throw missing(keyState);
      return { key, host } as SourceCredentials[S];
    }
    case "ADZUNA": {
      const { appId, key, keyState } = config.adzuna;
      if (!key || !appId) throw missing(keyState);
      return { appId, key } as SourceCredentials[S];
    }
    default:
      return {} as SourceCredentials[S];
  }
}
