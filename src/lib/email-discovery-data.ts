import { z } from "zod";

import { isEmailAddress } from "@/lib/application-email";

export const emailConfidenceSchema = z.enum(["HIGH", "MEDIUM", "LOW"]);
export type EmailConfidence = z.infer<typeof emailConfidenceSchema>;

export const discoveredEmailSchema = z.object({
  email: z.string().refine(isEmailAddress),
  sourceUrl: z.url({ protocol: /^https?$/ }),
  sourceTitle: z.string(),
  context: z.string(),
  confidence: emailConfidenceSchema,
  reason: z.string(),
});
export type DiscoveredEmail = z.infer<typeof discoveredEmailSchema>;

export const emailDiscoverySchema = z.object({
  searchedAt: z.iso.datetime(),
  queryCount: z.number().int().nonnegative(),
  pagesRead: z.number().int().nonnegative(),
  rankedWith: z.string().nullable(),
  candidates: z.array(discoveredEmailSchema),
  error: z.string().nullable(),
});
export type EmailDiscovery = z.infer<typeof emailDiscoverySchema>;
