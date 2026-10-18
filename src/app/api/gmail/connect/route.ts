import { NextResponse } from "next/server";

import { gmailOAuthConfig } from "@/lib/gmail/config";
import { authorizationUrl, GMAIL_STATE_COOKIE, makeOAuthState } from "@/lib/gmail/oauth";
import { route } from "@/lib/route";

export const GET = route(async () => {
  const config = gmailOAuthConfig();
  if (!config) return NextResponse.redirect(`${configUrl()}/settings?section=automation&gmail=not-configured`);
  const state = await makeOAuthState();
  const response = NextResponse.redirect(authorizationUrl(config, state));
  response.cookies.set(GMAIL_STATE_COOKIE, state, {
    httpOnly: true,
    sameSite: "lax",
    secure: config.publicUrl.startsWith("https://"),
    path: "/api/gmail/callback",
    maxAge: 10 * 60,
  });
  return response;
});

function configUrl(): string {
  return process.env.DOSSIER_PUBLIC_URL?.replace(/\/$/, "") || "http://localhost:3000";
}
