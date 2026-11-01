"use server";

import { action } from "@/lib/action";
import { fitScopeSchema } from "@/lib/linkedin-posts/profile-fit-data";
import { readProfileFit, startProfileFit, stopProfileFit } from "@/lib/linkedin-posts/profile-fit-store";

export const loadProfileMatch = action(fitScopeSchema, readProfileFit);
export const startProfileMatch = action(fitScopeSchema, startProfileFit);
export const stopProfileMatch = action(fitScopeSchema, stopProfileFit);
