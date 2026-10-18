import { describe, expect, it } from "vitest";

import { GMAIL_SEND_SCOPE, hasGmailSendScope, makeOAuthState, verifyOAuthState } from "./oauth";

describe("Gmail OAuth state", () => {
  it("is signed, short lived and accepted only once", async () => {
    const secret = "a-test-secret-that-is-at-least-32-characters";
    const state = await makeOAuthState(secret);
    expect(await verifyOAuthState(state, secret)).toBe(true);
    expect(await verifyOAuthState(state, secret)).toBe(false);
    expect(await verifyOAuthState(`${state}tampered`, secret)).toBe(false);
  });
});

describe("Gmail OAuth scopes", () => {
  it("requires the Gmail send grant", () => {
    expect(hasGmailSendScope(`openid email ${GMAIL_SEND_SCOPE}`)).toBe(true);
    expect(hasGmailSendScope("openid email")).toBe(false);
    expect(hasGmailSendScope(undefined)).toBe(false);
  });
});
