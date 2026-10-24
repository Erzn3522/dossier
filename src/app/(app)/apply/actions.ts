"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { DocumentKind, VersionCause } from "@/generated/prisma/enums";
import { action, ActionError } from "@/lib/action";
import { isAiConfigured } from "@/lib/ai/config";
import { emailAddresses, emailUnits } from "@/lib/application-email";
import { saveVersion } from "@/lib/document-versions";
import { updateDocuments } from "@/lib/document-units";
import { GmailDeliveryUnknown, GmailNotConnected, GmailSendFailed } from "@/lib/gmail/client";
import { GmailSendBlocked, sendApplicationEmail } from "@/lib/gmail/send-application";
import { quickApplyJob } from "@/lib/jobs/quick-apply";
import { startJob } from "@/lib/jobs/runner";
import { prisma } from "@/lib/prisma";

const refresh = (id: string) => {
  revalidatePath(`/apply/${id}`);
  revalidatePath(`/applications/${id}`);
};

/** A link as typed, with https:// added when it has no scheme; empty stays empty. */
function postingLink(value: string): string {
  const link = value.trim();
  if (!link) return "";
  try {
    const url = new URL(/^[a-z][a-z\d+.-]*:\/\//i.test(link) ? link : `https://${link}`);
    if (url.protocol === "http:" || url.protocol === "https:") return url.toString();
  } catch {
    // Not a link.
  }
  throw new ActionError("The link to the posting doesn't look like a web address. Fix it or leave it empty.");
}

const recipientSchema = z.string().trim().max(320);

/** The one address in what was typed, or "" for nothing; anything else is refused in words the user can act on. */
function oneAddress(value: string): string {
  if (!value) return "";
  const addresses = emailAddresses(value);
  if (addresses.length !== 1) throw new ActionError("Enter one email address, or leave it empty.");
  return addresses[0];
}

/** "Prepare application": starts the whole pipeline ahead of queued automation work, and returns the job's id. */
export const startQuickApply = action(
  z.object({
    posting: z.string().trim().min(1, "Paste the posting, or fetch it from its link, first.").max(100_000),
    postingUrl: z.string().max(2000),
    recipient: recipientSchema,
    note: z.string().trim().max(2000),
  }),
  async ({ posting, postingUrl, recipient, note }) => {
    const job = { posting, postingUrl: postingLink(postingUrl), recipient: oneAddress(recipient), note };
    if (!(await isAiConfigured())) throw new ActionError("Set up an AI model in Settings first.");
    return startJob(quickApplyJob, job, { first: true });
  },
);

/** Saves the email as edited on the Quick apply page; a version is kept like any edit by hand. */
export const saveQuickApplyEmail = action(
  z.object({
    id: z.string().min(1),
    to: recipientSchema,
    subject: z.string().trim().max(500),
    body: z.string().max(20_000),
  }),
  async ({ id, to, subject, body }, { toast }) => {
    oneAddress(to);
    const units = emailUnits({ to, subject, body: body.trim() });
    const exists = await prisma.document.findFirst({ where: { applicationId: id, kind: DocumentKind.EMAIL }, select: { id: true } });
    if (!exists) {
      const application = await prisma.application.findUnique({ where: { id }, select: { id: true } });
      if (!application) throw new ActionError("That application no longer exists.");
      await prisma.$transaction(async (tx) => {
        const document = await tx.document.create({ data: { applicationId: id, kind: DocumentKind.EMAIL, units } });
        await saveVersion(tx, document.id, units, { cause: VersionCause.WRITTEN });
      });
    } else {
      await updateDocuments(id, async (documents) => {
        documents[DocumentKind.EMAIL] = units;
      });
    }
    refresh(id);
    toast("Email saved.");
    return null;
  },
);

/** Sends the application with Gmail: the email, with the tailored resume and the cover letter as PDFs. */
export const sendQuickApply = action(
  z.object({ id: z.string().min(1), retryUnknown: z.boolean().default(false) }),
  async ({ id, retryUnknown }, { toast }) => {
    try {
      await sendApplicationEmail(id, retryUnknown);
    } catch (error) {
      if (error instanceof GmailSendBlocked || error instanceof GmailDeliveryUnknown || error instanceof GmailNotConnected || error instanceof GmailSendFailed) {
        throw new ActionError(error.message);
      }
      throw error;
    }
    refresh(id);
    toast("Email sent with your resume and cover letter.");
    return null;
  },
);
