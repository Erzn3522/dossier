"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { action, ActionError } from "@/lib/action";
import { prisma } from "@/lib/prisma";
import { APIFY_API_KEY, applySecretChange } from "@/lib/secrets";
import { loadSettings, saveSettings } from "@/lib/settings-data";
import { apifyRequest } from "@/lib/linkedin-posts/apify";
import { isSearching, postSearchSchema } from "@/lib/linkedin-posts/data";
import { apifyKeyState, cancelPostSearch, getPostSearch, loadApifyKey, refreshPostSearch, searchView, startPostSearch } from "@/lib/linkedin-posts/searches";

const ref = z.object({ id: z.string().min(1).max(100) });
export const runLinkedInSearch = action(postSearchSchema, startPostSearch);
export const loadLinkedInSearch = action(ref, async ({ id }) => searchView(await getPostSearch(id)));
export const refreshLinkedInSearch = action(ref, ({ id }) => refreshPostSearch(id));
export const cancelLinkedInSearch = action(ref, ({ id }) => cancelPostSearch(id));
export const deleteLinkedInSearch = action(ref, async ({ id }) => {
  const row = await getPostSearch(id);
  if (isSearching(row.status)) throw new ActionError("Cancel the search and wait for it to stop before deleting it.");
  await prisma.linkedInPostSearch.delete({ where: { id } });
  revalidatePath("/linkedin-posts");
  return null;
});

export const saveApifyToken = action(z.discriminatedUnion("action", [
  z.object({ action: z.literal("set"), value: z.string().trim().min(1).max(1000) }),
  z.object({ action: z.literal("clear") }),
]), async (change, { toast }) => {
  const active = await prisma.linkedInPostSearch.count({ where: { status: { in: ["STARTING", "RUNNING"] } } });
  if (active) throw new ActionError("Wait for the active post search to finish, or cancel it, before changing the token.");
  if (await prisma.linkedInCampaign.count({ where: { status: { in: ["RUNNING", "CANCELLING"] } } })) throw new ActionError("Finish or cancel the AI search before changing the Apify token.");
  const settings = await loadSettings();
  await saveSettings({ apifyKeyEnc: applySecretChange(APIFY_API_KEY, settings.apifyKeyEnc, change) });
  revalidatePath("/settings"); revalidatePath("/linkedin-posts");
  toast(change.action === "clear" ? "Apify token removed." : "Apify token saved.");
  return { keyState: await apifyKeyState() };
});
export const testApifyToken = action(z.object({}), async () => {
  await apifyRequest(await loadApifyKey(), "/users/me");
  return null;
});
