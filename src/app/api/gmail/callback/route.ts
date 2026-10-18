import { NextResponse } from "next/server";

import { gmailOAuthConfig } from "@/lib/gmail/config";
import { exchangeCode, GmailScopeMissing, GMAIL_STATE_COOKIE, verifyOAuthState } from "@/lib/gmail/oauth";
import { prisma } from "@/lib/prisma";
import { encryptSecret, GMAIL_OAUTH_TOKEN } from "@/lib/secrets";
import { route } from "@/lib/route";

export const GET = route(async (request) => {
  const config = gmailOAuthConfig();
  const home = config?.publicUrl ?? request.nextUrl.origin;
  const finish = (value: "connected" | "cancelled" | "invalid" | "missing-scope" | "failed") => {
    const response = NextResponse.redirect(`${home}/settings?section=automation&gmail=${value}`);
    response.cookies.delete(GMAIL_STATE_COOKIE);
    return response;
  };

  if (!config) return finish("failed");
  if (request.nextUrl.searchParams.has("error")) return finish("cancelled");
  const code = request.nextUrl.searchParams.get("code") ?? "";
  const state = request.nextUrl.searchParams.get("state") ?? "";
  const cookie = request.cookies.get(GMAIL_STATE_COOKIE)?.value ?? "";
  if (!code || !state || state !== cookie || !(await verifyOAuthState(state))) return finish("invalid");

  try {
    const connected = await exchangeCode(config, code);
    await prisma.gmailConnection.upsert({
      where: { id: "default" },
      create: { id: "default", email: connected.email, refreshTokenEnc: encryptSecret(GMAIL_OAUTH_TOKEN, connected.refreshToken) },
      update: { email: connected.email, refreshTokenEnc: encryptSecret(GMAIL_OAUTH_TOKEN, connected.refreshToken), connectedAt: new Date() },
    });
    return finish("connected");
  } catch (error) {
    return finish(error instanceof GmailScopeMissing ? "missing-scope" : "failed");
  }
}, { allowCrossSiteGet: true });
