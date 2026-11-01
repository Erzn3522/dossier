import { z } from "zod";
import { linkedInPostSchema, postSearchFields } from "./data";
import { fitFilterSchema, type ProfileFitView } from "./profile-fit-data";

export const campaignInputSchema = postSearchFields.extend({
  countries: z.array(z.string().trim().min(1).max(80)).min(1, "Add at least one target country for AI search.").max(5),
  rounds: z.number().int().min(1).max(20).default(3),
  budgetUsd: z.number().finite().min(0.1).max(100).default(1),
}).refine((q) => Math.max(1, q.authors.length) * q.maxPosts <= 200, "Reduce posts per query or the author list to stay below 200 posts per round.");
export type CampaignInput = z.infer<typeof campaignInputSchema>;
export function roundCap(input: CampaignInput): number {
  return Math.min(1, Math.floor(input.budgetUsd * 1_000_000 / (input.rounds * input.countries.length)) / 1_000_000);
}
export function roundOrder(input: CampaignInput) {
  return Array.from({ length: input.rounds }, (_, round) => input.countries.map((country) => ({ country, round: round + 1 }))).flat();
}
export const countryAssessmentSchema = z.object({
  country: z.string(), relevant: z.boolean(), hiring: z.boolean(),
  confidence: z.enum(["confirmed", "likely", "uncertain"]), reason: z.string().max(1000), evidence: z.string().max(1000).nullable(),
  status: z.enum(["assessed", "unavailable"]).optional(),
});
export type CountryAssessment = z.infer<typeof countryAssessmentSchema>;
export const occurrenceSchema = z.object({ country: z.string(), round: z.number().int(), queries: z.array(z.string()) });
export const campaignFiltersSchema = z.object({
  text: z.string().max(200).default(""), location: z.string().max(200).default(""), exclude: z.string().max(200).default(""),
  hiringOnly: z.boolean().default(false), remoteOnly: z.boolean().default(false),
  authorType: z.enum(["all", "person", "company"]).default("all"),
  sort: z.enum(["relevance", "newest", "likes"]).default("newest"),
  relevantOnly: z.boolean().default(false), confidence: z.enum(["all", "confirmed", "likely", "uncertain"]).default("all"),
  profileFit: fitFilterSchema.default("all"),
});
export type CampaignFilters = z.infer<typeof campaignFiltersSchema>;
export const DEFAULT_CAMPAIGN_FILTERS = campaignFiltersSchema.parse({});
export type CampaignSummary = {
  id: string; status: string; error: string | null; input: CampaignInput; provider: string; model: string | null;
  completed: number; total: number; createdAt: string; reservedUsd: number;
};
export type AttemptView = {
  id: string; country: string; round: number; status: string; queries: string[]; strategy: string | null;
  fetched: number; fresh: number; duplicates: number; relevant: number; error: string | null; capUsd: number; runId: string | null;
};
export type CampaignPostView = { id: string; post: z.infer<typeof linkedInPostSchema>; assessments: CountryAssessment[]; occurrences: z.infer<typeof occurrenceSchema>[]; profileFit?: ProfileFitView | null };
export type CampaignView = CampaignSummary & { attempts: AttemptView[]; posts: CampaignPostView[]; found: number; filtered: number; page: number; pages: number };
export const CAMPAIGN_ACTIVE = ["RUNNING", "CANCELLING"];
