import "server-only";

import { SignJWT, jwtVerify } from "jose";

import { deriveKey } from "@/lib/keys";

import type { GmailOAuthConfig } from "./config";

export const GMAIL_STATE_COOKIE = "dossier_gmail_oauth";
export const GMAIL_SEND_SCOPE = "https://www.googleapis.com/auth/gmail.send";
export const GMAIL_SCOPES = ["openid", "email", GMAIL_SEND_SCOPE] as const;

export class GmailScopeMissing extends Error {}

export function hasGmailSendScope(scope: string | undefined): boolean {
  return new Set((scope ?? "").split(/\s+/).filter(Boolean)).has(GMAIL_SEND_SCOPE);
}

export async function makeOAuthState(secret?: string): Promise<string> {
  return new SignJWT({ purpose: "gmail-connect" })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime("10m")
    .setJti(crypto.randomUUID())
    .sign(deriveKey("gmail-oauth-state", secret));
}

export async function verifyOAuthState(value: string, secret?: string): Promise<boolean> {
  try {
    const { payload } = await jwtVerify(value, deriveKey("gmail-oauth-state", secret), { algorithms: ["HS256"] });
    if (payload.purpose !== "gmail-connect" || !payload.jti || consumedStates.has(payload.jti)) return false;
    consumedStates.set(payload.jti, Date.now() + 10 * 60_000);
    for (const [id, expires] of consumedStates) if (expires < Date.now()) consumedStates.delete(id);
    return true;
  } catch {
    return false;
  }
}

const globalOAuth = globalThis as unknown as { dossierConsumedGmailStates?: Map<string, number> };
const consumedStates = (globalOAuth.dossierConsumedGmailStates ??= new Map());

export function authorizationUrl(config: GmailOAuthConfig, state: string): string {
  const url = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  url.search = new URLSearchParams({
    client_id: config.clientId,
    redirect_uri: config.redirectUri,
    response_type: "code",
    scope: GMAIL_SCOPES.join(" "),
    access_type: "offline",
    prompt: "consent",
    include_granted_scopes: "true",
    state,
  }).toString();
  return url.toString();
}

type TokenResponse = { access_token?: string; refresh_token?: string; scope?: string; error?: string; error_description?: string };

async function tokenRequest(body: URLSearchParams): Promise<TokenResponse> {
  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body,
    signal: AbortSignal.timeout(20_000),
  });
  const json = (await response.json().catch(() => ({}))) as TokenResponse;
  if (!response.ok) throw new Error(json.error_description || json.error || "Google did not accept the OAuth request.");
  return json;
}

export async function exchangeCode(config: GmailOAuthConfig, code: string): Promise<{ accessToken: string; refreshToken: string; email: string }> {
  const token = await tokenRequest(
    new URLSearchParams({
      code,
      client_id: config.clientId,
      client_secret: config.clientSecret,
      redirect_uri: config.redirectUri,
      grant_type: "authorization_code",
    }),
  );
  if (!token.access_token || !token.refresh_token) throw new Error("Google did not return a reusable Gmail connection.");
  if (!hasGmailSendScope(token.scope)) {
    await revokeToken(token.access_token).catch(() => {});
    throw new GmailScopeMissing("Google did not grant permission to send Gmail messages.");
  }
  const profile = await fetch("https://openidconnect.googleapis.com/v1/userinfo", {
    headers: { authorization: `Bearer ${token.access_token}` },
    signal: AbortSignal.timeout(20_000),
  });
  const identity = (await profile.json().catch(() => ({}))) as { email?: string };
  if (!profile.ok || !identity.email) throw new Error("Google did not return the connected account's email address.");
  return { accessToken: token.access_token, refreshToken: token.refresh_token, email: identity.email };
}

export async function refreshAccessToken(config: GmailOAuthConfig, refreshToken: string): Promise<string> {
  const token = await tokenRequest(
    new URLSearchParams({
      refresh_token: refreshToken,
      client_id: config.clientId,
      client_secret: config.clientSecret,
      grant_type: "refresh_token",
    }),
  );
  if (!token.access_token) throw new Error("Google did not refresh the Gmail connection.");
  if (!hasGmailSendScope(token.scope)) throw new GmailScopeMissing("Google did not grant permission to send Gmail messages. Reconnect Gmail and approve that permission.");
  return token.access_token;
}

export async function revokeToken(token: string): Promise<void> {
  const response = await fetch("https://oauth2.googleapis.com/revoke", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ token }),
    signal: AbortSignal.timeout(20_000),
  });
  if (!response.ok) throw new Error("Google could not revoke the Gmail connection.");
}
