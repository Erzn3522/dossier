"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { action, ActionError } from "@/lib/action";
import { prisma } from "@/lib/prisma";
import { campaignFiltersSchema, campaignInputSchema } from "@/lib/linkedin-posts/campaign-data";
import { campaignView, listCampaigns, requestCampaignCancel, resumeCampaign, startCampaign } from "@/lib/linkedin-posts/campaigns";

const ref = z.object({ id: z.string().min(1).max(100) });
export const startLinkedInCampaign = action(campaignInputSchema, startCampaign);
export const listLinkedInCampaigns = action(z.object({}), listCampaigns);
export const loadLinkedInCampaign = action(ref.extend({ filters: campaignFiltersSchema, page: z.number().int().min(1).max(10000).default(1) }), ({ id, filters, page }) => campaignView(id, filters, page));
export const cancelLinkedInCampaign = action(ref, async ({ id }) => { await requestCampaignCancel(id); return null; });
export const resumeLinkedInCampaign = action(ref, async ({ id }) => { await resumeCampaign(id); return null; });
export const deleteLinkedInCampaign = action(ref, async ({ id }) => {
  const row = await prisma.linkedInCampaign.findUnique({ where: { id }, include: { attempts: true } });
  if (!row) throw new ActionError("That AI search no longer exists.");
  if (["RUNNING", "CANCELLING", "PAUSED", "FAILED"].includes(row.status)) throw new ActionError("Cancel this AI search before deleting its history.");
  await prisma.linkedInCampaign.delete({ where: { id } });
  revalidatePath("/linkedin-posts");
  return null;
});
