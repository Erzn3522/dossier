import { describe, expect, it, vi } from "vitest";

import { AI_API_KEY, APIFY_API_KEY, applySecretChange, decryptSecret, encryptSecret, JOB_SOURCE_KEY, SecretUnreadable, secretState } from "./secrets";

vi.mock("@/lib/env", () => ({ env: { DOSSIER_SECRET: "a".repeat(32) } }));

describe("secrets", () => {
  it("round-trips each kind", () => {
    expect(decryptSecret(JOB_SOURCE_KEY, encryptSecret(JOB_SOURCE_KEY, "ak_test"))).toBe("ak_test");
    expect(decryptSecret(AI_API_KEY, encryptSecret(AI_API_KEY, "sk-test"))).toBe("sk-test");
    expect(decryptSecret(APIFY_API_KEY, encryptSecret(APIFY_API_KEY, "apify-test"))).toBe("apify-test");
    expect(() => decryptSecret(JOB_SOURCE_KEY, encryptSecret(APIFY_API_KEY, "apify-test"))).toThrow(SecretUnreadable);
  });

  it("won't read one kind of secret as another", () => {
    const jobKey = encryptSecret(JOB_SOURCE_KEY, "ak_test");
    expect(() => decryptSecret(AI_API_KEY, jobKey)).toThrow(SecretUnreadable);
    expect(secretState(AI_API_KEY, jobKey)).toBe("unreadable");
    expect(secretState(JOB_SOURCE_KEY, jobKey)).toBe("set");
    expect(secretState(JOB_SOURCE_KEY, null)).toBe("none");
  });

  it("refuses malformed values without revealing anything", () => {
    expect(() => decryptSecret(JOB_SOURCE_KEY, "v1.only-two")).toThrow("A saved secret can't be read.");
  });

  it("applies a change", () => {
    const stored = encryptSecret(JOB_SOURCE_KEY, "old");
    expect(applySecretChange(JOB_SOURCE_KEY, stored, { action: "keep" })).toBe(stored);
    expect(applySecretChange(JOB_SOURCE_KEY, stored, { action: "set", value: " " })).toBe(stored);
    expect(applySecretChange(JOB_SOURCE_KEY, stored, { action: "clear" })).toBeNull();
    expect(decryptSecret(JOB_SOURCE_KEY, applySecretChange(JOB_SOURCE_KEY, stored, { action: "set", value: " new " })!)).toBe("new");
  });
});
