import { z } from "zod";

export const fitVerdict = z.enum(["suitable", "review", "not_suitable", "unavailable"]);
export const fitFilterSchema = z.enum(["all", "hide_unsuitable", "suitable", "review", "not_suitable", "unassessed"]);
export type FitFilter = z.infer<typeof fitFilterSchema>;
export const fitScopeSchema = z.object({ kind: z.enum(["manual", "campaign"]), id: z.string().min(1).max(100) });
export type FitScope = z.infer<typeof fitScopeSchema>;
export const fitScopeKey = (scope: FitScope) => `${scope.kind}:${scope.id}`;
export const profileFitResultSchema = z.object({
  verdict: fitVerdict,
  summary: z.string().max(1000),
  requirements: z.array(z.object({
    requirement: z.string().max(300), quote: z.string().max(600), required: z.boolean(),
    category: z.enum(["skill", "language", "experience", "education", "other"]),
    result: z.enum(["covered", "gap", "unknown"]), profileEvidence: z.string().max(600).nullable(),
  })).max(12),
});
export type ProfileFitResult = z.infer<typeof profileFitResultSchema>;
export type ProfileFitView = ProfileFitResult & { evaluatedAt: string; provider: string; model: string | null };
export type ProfileFitState = {
  scope: string;
  available: boolean; profileReady: boolean; profileHash: string;
  run: { id: string; status: string; active?: boolean; total: number; processed: number; error: string | null } | null;
  results: Record<string, ProfileFitView>;
};
export const FIT_FILTERS: { value: FitFilter; label: string }[] = [
  { value: "all", label: "All posts" }, { value: "hide_unsuitable", label: "Hide unsuitable" },
  { value: "suitable", label: "Suitable only" }, { value: "review", label: "Needs review" },
  { value: "not_suitable", label: "Not suitable" }, { value: "unassessed", label: "Not assessed" },
];
export function matchesFitFilter(fit: ProfileFitResult | null | undefined, mode: FitFilter): boolean {
  if (mode === "all") return true;
  if (mode === "hide_unsuitable") return fit?.verdict !== "not_suitable";
  if (mode === "unassessed") return !fit || fit.verdict === "unavailable";
  return fit?.verdict === mode;
}
