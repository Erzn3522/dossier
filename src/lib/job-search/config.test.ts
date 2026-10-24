import { describe, expect, it, vi } from "vitest";

import { encryptSecret, JOB_SOURCE_KEY } from "@/lib/secrets";

import { credentialsFor, jobSearchView, requestContext, resolveJobSearchConfig } from "./config";

vi.mock("@/lib/env", () => ({ env: { DOSSIER_SECRET: "a".repeat(32) } }));

const nothingSaved = { jobSource: null, jsearchKeyEnc: null, jsearchHost: "openwebninja" as const, adzunaAppId: null, adzunaKeyEnc: null };
const noEnv = {};

describe("resolveJobSearchConfig", () => {
  it("is off until a source is chosen", () => {
    const config = resolveJobSearchConfig(nothingSaved, noEnv);
    expect(config).toMatchObject({ source: null, saved: false, jsearch: { key: null, keyState: "none" }, adzuna: { appId: "", key: null } });
    expect(jobSearchView(config)).toEqual({
      source: "OFF",
      jsearch: { host: "openwebninja", keyState: "none" },
      adzuna: { appId: "", keyState: "none" },
    });
  });

  it("uses the environment until something is saved", () => {
    const config = resolveJobSearchConfig(nothingSaved, {
      DOSSIER_JOBS_SOURCE: "jsearch",
      DOSSIER_JSEARCH_KEY: "ak_env",
      DOSSIER_JSEARCH_HOST: "rapidapi",
      DOSSIER_ADZUNA_APP_ID: "app-env",
      DOSSIER_ADZUNA_KEY: "adz-env",
    });
    expect(config).toMatchObject({
      source: "JSEARCH",
      saved: false,
      jsearch: { key: "ak_env", host: "rapidapi", keyState: "env" },
      adzuna: { appId: "app-env", key: "adz-env", keyState: "env" },
    });
    expect(resolveJobSearchConfig(nothingSaved, { DOSSIER_JOBS_SOURCE: "off" }).source).toBeNull();
  });

  it("prefers what's saved, Off included, and decrypts saved keys", () => {
    const saved = {
      jobSource: "ADZUNA" as const,
      jsearchKeyEnc: encryptSecret(JOB_SOURCE_KEY, "ak_saved"),
      jsearchHost: "openwebninja" as const,
      adzunaAppId: "app-saved",
      adzunaKeyEnc: encryptSecret(JOB_SOURCE_KEY, "adz-saved"),
    };
    const config = resolveJobSearchConfig(saved, { DOSSIER_JOBS_SOURCE: "jsearch", DOSSIER_JSEARCH_KEY: "ak_env", DOSSIER_JSEARCH_HOST: "rapidapi" });
    expect(config).toMatchObject({
      source: "ADZUNA",
      saved: true,
      jsearch: { key: "ak_saved", host: "openwebninja", keyState: "set" },
      adzuna: { appId: "app-saved", key: "adz-saved", keyState: "set" },
    });
    expect(resolveJobSearchConfig({ ...saved, jobSource: "OFF" }, { DOSSIER_JOBS_SOURCE: "jsearch" })).toMatchObject({ source: null, saved: true });
  });

  it("says when a saved key can't be read, rather than using another", () => {
    const config = resolveJobSearchConfig(
      { ...nothingSaved, jobSource: "JSEARCH", jsearchKeyEnc: encryptSecret(JOB_SOURCE_KEY, "ak", "b".repeat(32)) },
      { DOSSIER_JSEARCH_KEY: "ak_env" },
    );
    expect(config.jsearch).toEqual({ key: null, host: "openwebninja", keyState: "unreadable" });
    expect(() => credentialsFor(config, "JSEARCH")).toThrow("Your saved JSearch key can't be read. Enter it again in Settings → Job search.");
  });
});

describe("credentialsFor", () => {
  const config = resolveJobSearchConfig(
    { ...nothingSaved, jobSource: "JSEARCH", jsearchKeyEnc: encryptSecret(JOB_SOURCE_KEY, "ak_saved"), jsearchHost: "rapidapi" },
    noEnv,
  );

  it("gives each source its own key", () => {
    expect(credentialsFor(config, "JSEARCH")).toEqual({ key: "ak_saved", host: "rapidapi" });
    expect(credentialsFor(config, "ARBEITSAGENTUR")).toEqual({});
    expect(credentialsFor(config, "REMOTE_OK")).toEqual({});
    expect(credentialsFor(config, "REMOTIVE")).toEqual({});
    expect(credentialsFor(config, "WE_WORK_REMOTELY")).toEqual({});
    expect(credentialsFor(config, "HIMALAYAS")).toEqual({});
    expect(credentialsFor(config, "JOBICY")).toEqual({});
    expect(credentialsFor(config, "ARBEITNOW")).toEqual({});
  });

  it("says what's missing", () => {
    expect(() => credentialsFor(config, "ADZUNA")).toThrow("Add your Adzuna app ID and key in Settings → Job search first.");
    expect(() => credentialsFor(resolveJobSearchConfig(nothingSaved, noEnv), "JSEARCH")).toThrow("Add your JSearch key in Settings → Job search first.");
    const keyOnly = resolveJobSearchConfig({ ...nothingSaved, adzunaKeyEnc: encryptSecret(JOB_SOURCE_KEY, "adz") }, noEnv);
    expect(() => credentialsFor(keyOnly, "ADZUNA")).toThrow(/app ID and key/);
  });
});

describe("requestContext", () => {
  it("leaves sources at their own address, unless the end-to-end tests point them at a fake", () => {
    expect(requestContext("JSEARCH", undefined)).toEqual({});
    expect(requestContext("ADZUNA", "http://127.0.0.1:3998/")).toEqual({ baseUrl: "http://127.0.0.1:3998/adzuna" });
  });
});
