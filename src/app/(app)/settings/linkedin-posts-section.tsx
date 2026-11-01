"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { toastResult } from "@/components/toast";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import type { SecretState } from "@/lib/secrets";
import { saveApifyToken, testApifyToken } from "../linkedin-posts/actions";
import { SettingsSectionIntro } from "./settings-screen";

export function LinkedInPostsSection({ initial }: { initial: SecretState }) {
  const [keyState, setKeyState] = useState(initial);
  const [token, setToken] = useState("");
  const [pending, startTransition] = useTransition();
  const [connection, setConnection] = useState("");
  function save(clear = false) {
    startTransition(async () => {
      const result = toastResult(await saveApifyToken(clear ? { action: "clear" } : { action: "set", value: token }));
      if (result.ok) { setKeyState(result.data.keyState); setToken(""); setConnection(""); }
    });
  }
  return <>
    <SettingsSectionIntro title="LinkedIn posts">Find hiring announcements shared as regular LinkedIn posts, using Apify.</SettingsSectionIntro>
    <Card className="flex flex-col gap-5">
      <div><h3 className="font-medium">Apify connection</h3><p className="mt-1 text-sm text-muted">Uses automly/linkedin-post-search-scraper. You only need an Apify API token; no LinkedIn login or cookies.</p></div>
      <p className="text-sm"><a href="https://console.apify.com/settings/integrations" target="_blank" rel="noopener noreferrer" className="underline">Get your Apify API token ↗</a></p>
      <Input label="Apify API token" type="password" autoComplete="new-password" value={token} onChange={(e) => { setToken(e.target.value); setConnection(""); }}
        hint={keyState === "set" ? "A token is saved. Enter a new one to replace it. Tokens are encrypted and never sent back to your browser." : keyState === "unreadable" ? "The saved token cannot be read. Enter it again." : "No token saved. Your token is encrypted before storage."} />
      <div className="flex flex-wrap gap-4">
        <Button disabled={pending || !token.trim()} onClick={() => save()}>Save token</Button>
        <Button variant="secondary" disabled={pending || keyState !== "set" || Boolean(token.trim())} onClick={() => startTransition(async () => {
          setConnection(""); const result = toastResult(await testApifyToken({})); if (result.ok) setConnection("Connected to Apify. This test does not run a search or verify actor access.");
        })}>Test connection</Button>
        <Button variant="danger-text" disabled={pending || keyState === "none"} onClick={() => save(true)}>Remove token</Button>
      </div>
      {connection && <p role="status" className="text-sm">{connection}</p>}
    </Card>
    <Card className="flex flex-col gap-3 text-sm">
      <h3 className="font-medium">Search limits</h3>
      <p className="text-muted">Each scraper run requests up to 200 posts and has a charge cap of at most $1. AI campaigns split your total Apify budget across all country rounds. Your selected AI provider plans and evaluates each round; hosted AI charges are separate. Apify charges apply to fetched posts, including those hidden by result filters. Opening history does not repeat searches.</p>
      <p><a href="https://apify.com/automly/linkedin-post-search-scraper/pricing" target="_blank" rel="noopener noreferrer" className="underline">Current scraper pricing ↗</a></p>
      <Link href="/linkedin-posts" className="underline">Open LinkedIn posts →</Link>
    </Card>
  </>;
}
