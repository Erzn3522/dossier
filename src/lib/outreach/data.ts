import { z } from "zod";

import { unitsSchema } from "@/lib/application-data";

export const outreachEvidenceSchema = z.object({
  pages: z.array(
    z.object({
      url: z.url(),
      title: z.string().default(""),
      excerpt: z.string(),
      collectedAt: z.iso.datetime(),
    }),
  ),
  summary: z.string(),
  capabilities: z.array(z.string()),
  hiringSignal: z.string().nullable(),
  evidenceIndexes: z.array(z.number().int().nonnegative()),
});

export const outreachContactSchema = z.object({
  email: z.email(),
  name: z.string().nullable(),
  title: z.string().nullable(),
  sourceUrl: z.url(),
  excerpt: z.string(),
  role: z.enum(["recruiting", "technical-lead", "founder", "role", "general"]),
  rankReason: z.string().default(""),
});

export const outreachContactsSchema = z.array(outreachContactSchema);
export const outreachResumeSchema = unitsSchema;

export type OutreachEvidence = z.infer<typeof outreachEvidenceSchema>;
export type OutreachContact = z.infer<typeof outreachContactSchema>;

