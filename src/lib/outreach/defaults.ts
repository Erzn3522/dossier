import "server-only";

import type { Prisma, PrismaClient } from "@/generated/prisma/client";

export const DEFAULT_OUTREACH_CAMPAIGN = {
  id: "default-computer-vision",
  name: "Computer vision companies",
  enabled: true,
  keywords: ["computer vision", "image processing", "machine vision", "visual inspection", "video analytics", "OCR", "3D vision"],
  countries: ["Europe"],
  remote: true,
  targetRole: "Computer Vision / Machine Learning Engineer",
  opportunity: "Full-time employment or a relevant engineering opportunity",
  pitch: "Introduce my relevant computer vision and image processing experience using only facts from my profile.",
  cta: "Ask whether a short introductory conversation would be useful.",
  language: "English",
  fitThreshold: 70,
  dailyDiscoveryLimit: 10,
} as const;

export async function createDefaultOutreachCampaign(db: PrismaClient | Prisma.TransactionClient): Promise<void> {
  await db.outreachCampaign.upsert({
    where: { id: DEFAULT_OUTREACH_CAMPAIGN.id },
    create: { ...DEFAULT_OUTREACH_CAMPAIGN, keywords: [...DEFAULT_OUTREACH_CAMPAIGN.keywords], countries: [...DEFAULT_OUTREACH_CAMPAIGN.countries] },
    update: {},
  });
}

