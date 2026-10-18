import "server-only";

import nodemailer from "nodemailer";

import { prisma } from "@/lib/prisma";
import { decryptSecret, GMAIL_OAUTH_TOKEN } from "@/lib/secrets";

import { gmailOAuthConfig } from "./config";
import { GmailScopeMissing, refreshAccessToken } from "./oauth";

export class GmailNotConnected extends Error {}
export class GmailDeliveryUnknown extends Error {}
export class GmailSendFailed extends Error {}

export async function gmailConnection(): Promise<{ email: string; refreshToken: string }> {
  const connection = await prisma.gmailConnection.findUnique({ where: { id: "default" } });
  if (!connection) throw new GmailNotConnected("Connect Gmail in Settings → Automation first.");
  return { email: connection.email, refreshToken: decryptSecret(GMAIL_OAUTH_TOKEN, connection.refreshTokenEnc) };
}

export async function gmailConnectionView(): Promise<{ configured: boolean; email: string | null; connectedAt: Date | null }> {
  const connection = await prisma.gmailConnection.findUnique({ where: { id: "default" }, select: { email: true, connectedAt: true } });
  return { configured: gmailOAuthConfig() !== null, email: connection?.email ?? null, connectedAt: connection?.connectedAt ?? null };
}

export async function buildMime(input: {
  from: string;
  to: string[];
  subject: string;
  body: string;
  attachments: { filename: string; content: Uint8Array; contentType: "application/pdf" }[];
}): Promise<string> {
  const transport = nodemailer.createTransport({ streamTransport: true, buffer: true, newline: "unix" });
  const result = await transport.sendMail({
    from: input.from,
    to: input.to,
    subject: input.subject,
    text: input.body,
    attachments: input.attachments.map((attachment) => ({ ...attachment, content: Buffer.from(attachment.content) })),
  });
  const message = result.message;
  if (!Buffer.isBuffer(message)) throw new Error("The Gmail message could not be built.");
  return message.toString("base64url");
}

export async function sendRawMessage(raw: string): Promise<{ id: string }> {
  const config = gmailOAuthConfig();
  if (!config) throw new GmailNotConnected("Finish the Gmail environment settings first.");
  const connection = await gmailConnection();
  let accessToken: string;
  try {
    accessToken = await refreshAccessToken(config, connection.refreshToken);
  } catch (error) {
    if (error instanceof GmailScopeMissing) throw new GmailSendFailed(error.message);
    throw error;
  }
  let response: Response;
  try {
    response = await fetch("https://gmail.googleapis.com/gmail/v1/users/me/messages/send", {
      method: "POST",
      headers: { authorization: `Bearer ${accessToken}`, "content-type": "application/json" },
      body: JSON.stringify({ raw }),
      signal: AbortSignal.timeout(30_000),
    });
  } catch {
    throw new GmailDeliveryUnknown("Gmail did not confirm whether it sent the message. Check Sent before retrying.");
  }
  const answer = (await response.json().catch(() => ({}))) as { id?: string; error?: { message?: string } };
  if (response.ok && answer.id) return { id: answer.id };
  if (response.status >= 500) throw new GmailDeliveryUnknown("Gmail did not confirm whether it sent the message. Check Sent before retrying.");
  throw new GmailSendFailed(answer.error?.message || "Gmail refused the message.");
}
