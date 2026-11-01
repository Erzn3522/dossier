"use client";

import { createContext, use, useCallback, useRef, useState, type ReactNode } from "react";
import { toast, toastResult } from "@/components/toast";
import type { LinkedInPost } from "@/lib/linkedin-posts/data";
import { linkedInPostKey } from "@/lib/linkedin-posts/post-key";
import { dismissPost, restorePost } from "./dismissal-actions";

type Dismissals = {
  keys: Set<string>; pending: Set<string>; revision: number;
  dismiss: (post: LinkedInPost) => Promise<boolean>; restore: (key: string) => Promise<boolean>;
};
const Context = createContext<Dismissals | null>(null);
export const useDismissals = () => use(Context);

export function DismissalProvider({ initialKeys, children }: { initialKeys: string[]; children: ReactNode }) {
  const [keys, setKeys] = useState(() => new Set(initialKeys));
  const [pending, setPending] = useState(new Set<string>());
  const pendingRef = useRef(new Set<string>());
  const [revision, setRevision] = useState(0);
  const changeKey = useCallback((key: string, dismissed: boolean) => {
    setKeys((old) => { const next = new Set(old); if (dismissed) next.add(key); else next.delete(key); return next; });
  }, []);
  const changePending = (key: string, value: boolean) => {
    if (value) pendingRef.current.add(key); else pendingRef.current.delete(key);
    setPending(new Set(pendingRef.current));
  };
  const restore = async (key: string): Promise<boolean> => {
    if (pendingRef.current.has(key)) return false;
    changePending(key, true);
    try {
      const result = toastResult(await restorePost({ key }));
      if (!result.ok) return false;
      changeKey(key, false); setRevision((n) => n + 1); toast("Post restored."); return true;
    } catch { toast("Could not restore the post. Try again."); return false; }
    finally { changePending(key, false); }
  };
  const dismiss = async (post: LinkedInPost): Promise<boolean> => {
    const key = linkedInPostKey(post);
    if (pendingRef.current.has(key)) return false;
    changePending(key, true);
    // Change visible lists only after persistence succeeds: errors cannot
    // accidentally hide a post, and a polling response cannot resurrect it.
    try {
      const result = toastResult(await dismissPost({ post }));
      if (!result.ok) return false;
      changeKey(key, true); setRevision((n) => n + 1);
      toast("Post dismissed from this and future searches.", { action: { label: "Undo", onClick: () => { void restore(key); } } });
      return true;
    } catch { toast("Could not dismiss the post. Try again."); return false; }
    finally { changePending(key, false); }
  };
  return <Context value={{ keys, pending, revision, dismiss, restore }}>{children}</Context>;
}
