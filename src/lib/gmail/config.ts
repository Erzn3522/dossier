import "server-only";

import { env } from "@/lib/env";

export type GmailOAuthConfig = {
  publicUrl: string;
  clientId: string;
  clientSecret: string;
  redirectUri: string;
};

export function gmailOAuthConfig(): GmailOAuthConfig | null {
  if (!env.DOSSIER_PUBLIC_URL || !env.DOSSIER_GOOGLE_CLIENT_ID || !env.DOSSIER_GOOGLE_CLIENT_SECRET) return null;
  const publicUrl = env.DOSSIER_PUBLIC_URL.replace(/\/$/, "");
  return {
    publicUrl,
    clientId: env.DOSSIER_GOOGLE_CLIENT_ID,
    clientSecret: env.DOSSIER_GOOGLE_CLIENT_SECRET,
    redirectUri: `${publicUrl}/api/gmail/callback`,
  };
}

export function gmailMissingConfig(): string[] {
  return [
    !env.DOSSIER_PUBLIC_URL && "DOSSIER_PUBLIC_URL",
    !env.DOSSIER_GOOGLE_CLIENT_ID && "DOSSIER_GOOGLE_CLIENT_ID",
    !env.DOSSIER_GOOGLE_CLIENT_SECRET && "DOSSIER_GOOGLE_CLIENT_SECRET",
  ].filter((name): name is string => Boolean(name));
}
