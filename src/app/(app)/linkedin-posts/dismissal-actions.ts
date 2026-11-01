"use server";

import { z } from "zod";
import { action } from "@/lib/action";
import { linkedInPostSchema } from "@/lib/linkedin-posts/data";
import { dismissLinkedInPost, listDismissedPosts, restoreLinkedInPost } from "@/lib/linkedin-posts/dismissals";

export const dismissPost = action(z.object({ post: linkedInPostSchema }), ({ post }) => dismissLinkedInPost(post));
export const restorePost = action(z.object({ key: z.string().min(1).max(2000) }), ({ key }) => restoreLinkedInPost(key));
export const loadDismissedPosts = action(z.object({ page: z.number().int().min(1).max(100000) }), ({ page }) => listDismissedPosts(page));
