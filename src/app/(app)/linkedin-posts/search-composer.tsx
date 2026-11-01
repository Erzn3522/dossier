"use client";

import Link from "next/link";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { POSTED_WITHIN, postSearchSchema, type PostSearchQuery } from "@/lib/linkedin-posts/data";
import { campaignInputSchema, roundCap, type CampaignInput } from "@/lib/linkedin-posts/campaign-data";
import { buildQueries, uniqueLines } from "@/lib/linkedin-posts/queries";

export type ComposerSubmission = { mode: "manual"; query: PostSearchQuery } | { mode: "ai"; query: CampaignInput };
export function SearchComposer({ initial, initialAi = true, disabled, pending, onSubmit }: {
  initial?: PostSearchQuery; initialAi?: boolean; disabled: boolean; pending: boolean; onSubmit: (input: ComposerSubmission) => void;
}) {
  const [keywords, setKeywords] = useState(initial?.keywords ?? [""]);
  const [countries, setCountries] = useState(initial?.countries ?? []);
  const [country, setCountry] = useState("");
  const [ai, setAi] = useState(initialAi);
  const [rounds, setRounds] = useState(3);
  const [budgetUsd, setBudgetUsd] = useState(1);
  const [postedWithin, setPostedWithin] = useState<PostSearchQuery["postedWithin"]>(initial?.postedWithin ?? "month");
  const [since, setSince] = useState(initial?.since ?? "");
  const [authors, setAuthors] = useState(initial?.authors.join("\n") ?? "");
  const [maxPosts, setMaxPosts] = useState(initial?.maxPosts ?? 20);
  const [error, setError] = useState("");
  const seedKeywords = keywords.map((value) => value.trim()).filter(Boolean);
  const query = { keywords: seedKeywords, countries, authors: uniqueLines(authors), postedWithin, since, maxPosts };
  let preview: string[] = [];
  let previewError = "";
  try { preview = buildQueries(seedKeywords, countries); } catch (e) { previewError = (e as Error).message; }
  const manualLimit = preview.length * Math.max(1, query.authors.length) * (maxPosts || 0);
  const totalRounds = countries.length * (rounds || 0);
  const cap = totalRounds ? roundCap({ ...query, rounds, budgetUsd }) : 0;
  function addCountry() {
    const value = country.trim();
    if (!value) return;
    if (countries.length >= 5) { setError("Add up to 5 countries."); return; }
    if (value.length > 80) { setError("Keep each country name below 80 characters."); return; }
    if (!countries.some((c) => c.toLowerCase() === value.toLowerCase())) setCountries([...countries, value]);
    setCountry(""); setError("");
  }
  function pasteRows(index: number, text: string) {
    const lines = uniqueLines(text);
    const next = [...keywords.slice(0, index), ...lines, ...keywords.slice(index + 1)];
    if (next.length > 5) { setError("That paste would exceed 5 keyword rows. Split it into separate searches; no rows were changed."); return; }
    setKeywords(next.length ? next : [""]); setError("");
  }
  return <form onSubmit={(event) => {
    event.preventDefault(); setError("");
    if (country.trim()) { setError("Add the country with Enter or Add country before starting."); return; }
    const result = ai ? campaignInputSchema.safeParse({ ...query, rounds, budgetUsd }) : postSearchSchema.safeParse(query);
    if (!result.success) { setError(result.error.issues[0]?.message ?? "Check the search fields."); return; }
    if (ai) onSubmit({ mode: "ai", query: result.data as CampaignInput });
    else onSubmit({ mode: "manual", query: result.data as PostSearchQuery });
  }} className="flex flex-col gap-5">
    <div className="flex items-center justify-between gap-4"><h2 className="font-serif text-section">New search</h2><Link href="/settings?section=linkedin" className="text-sm underline">API settings</Link></div>
    <fieldset className="flex flex-col gap-3"><legend className="mb-2 text-sm font-medium">Topics and keywords</legend>
      {keywords.map((value, index) => <div key={index} className="flex items-end gap-3">
        <Input className="min-w-0 flex-1" label={`Keyword ${index + 1}`} value={value} placeholder='"Computer Vision" hiring OR recruiting' maxLength={200}
          onChange={(e) => setKeywords(keywords.map((k, i) => i === index ? e.target.value : k))}
          onPaste={(e) => { const text = e.clipboardData.getData("text"); if (/\r?\n/.test(text)) { e.preventDefault(); pasteRows(index, text); } }} />
        <Button variant="text" aria-label={`Remove keyword ${index + 1}`} onClick={() => setKeywords(keywords.length === 1 ? [""] : keywords.filter((_, i) => i !== index))}>×</Button>
      </div>)}
      <div><Button variant="secondary" size="sm" disabled={keywords.length >= 5} onClick={() => setKeywords([...keywords, ""])}>+ Add keyword</Button></div>
      <p className="text-xs text-muted">Up to 5 topics. Paste a list into any row to split it into separate keywords.</p>
    </fieldset>
    <div className="flex flex-col gap-3">
      <div className="flex items-end gap-3"><Input label="Target countries" value={country} maxLength={80} placeholder="Turkey, Türkiye or Slovenia" className="flex-1"
        onChange={(e) => setCountry(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addCountry(); } }} />
        <Button variant="secondary" disabled={countries.length >= 5 || !country.trim()} onClick={addCountry}>Add country</Button></div>
      <div className="flex flex-wrap gap-2">{countries.map((name) => <span key={name} className="inline-flex items-center gap-3 rounded-control bg-selected px-3 py-2 text-sm">{name}<button type="button" aria-label={`Remove country ${name}`} onClick={() => setCountries(countries.filter((c) => c !== name))}>×</button></span>)}</div>
      <p className="text-xs text-muted">Up to 5 countries, kept exactly as typed. AI search requires a country; manual search can run without one.</p>
    </div>
    <label className="flex items-center gap-2 text-sm font-medium"><input type="checkbox" checked={ai} onChange={(e) => setAi(e.target.checked)} />Optimize with AI</label>
    {ai ? <div className="rounded-control border border-line bg-paper p-4">
      <p className="mb-4 text-sm text-muted">Starts with your original manual queries, then uses your AI provider to expand short topic and hiring searches. Zero-result rounds remove constraints instead of adding country names. Country fit is assessed after retrieval.</p>
      <div className="grid gap-4 sm:grid-cols-2">
        <Input label="Rounds per country" type="number" min={1} max={20} required value={Number.isNaN(rounds) ? "" : rounds} onChange={(e) => setRounds(e.target.valueAsNumber)} />
        <Input label="Total Apify budget (USD)" type="number" min={0.1} max={100} step={0.01} required value={Number.isNaN(budgetUsd) ? "" : budgetUsd} onChange={(e) => setBudgetUsd(e.target.valueAsNumber)} />
      </div>
      <p className="mt-3 text-sm" role="status">{totalRounds} rounds · up to ${Number.isFinite(cap) ? cap.toFixed(6) : "0"} per round · up to 5 queries per round</p>
      <p className="mt-2 text-xs text-muted">Continues through all rounds even after finding good results. Stops on cancellation or a blocking error. Hosted AI charges, if any, are separate from the Apify budget.</p>
    </div> : <div className="rounded-control border border-line p-4">
      <h3 className="mb-2 text-sm font-medium">Query preview · {preview.length} searches</h3>
      <p className="mb-3 text-xs text-muted">Country names are added to every OR alternative. This searches post text, not a verified job location.</p>
      {countries.length ? countries.map((name) => <div key={name} className="mb-3"><h4 className="text-xs font-medium">{name}</h4><ul className="mt-1 list-inside list-disc text-sm">{!previewError && buildQueries(seedKeywords, [name]).map((q) => <li key={q} className="wrap-anywhere">{q}</li>)}</ul></div>)
        : <ul className="list-inside list-disc text-sm">{preview.map((q) => <li key={q}>{q}</li>)}</ul>}
      {previewError && <p role="alert" className="text-sm text-error">{previewError}</p>}
    </div>}
    <details className="rounded-control border border-line p-4"><summary className="cursor-pointer text-sm font-medium">Date, result limits & author filters</summary><div className="mt-4 flex flex-col gap-4"><div className="grid gap-4 sm:grid-cols-3">
      <Select label="Posted within" value={postedWithin} onChange={(e) => setPostedWithin(e.target.value as PostSearchQuery["postedWithin"])}>{POSTED_WITHIN.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</Select>
      <Input label="Posted on or after" type="date" value={since} onChange={(e) => setSince(e.target.value)} hint="Optional, UTC. Both date filters apply." />
      <Input label="Posts per query / author" type="number" min={1} max={100} required value={Number.isNaN(maxPosts) ? "" : maxPosts} onChange={(e) => setMaxPosts(e.target.valueAsNumber)} />
    </div>
    <Textarea label="People or companies" value={authors} onChange={(e) => setAuthors(e.target.value)} rows={2} hint="Optional. One LinkedIn profile/company URL or public handle per line, up to 5." /></div></details>
    {!ai && <p role="status" className="text-sm text-muted">Up to {manualLimit} posts · 200 per search maximum</p>}
    {!ai && manualLimit > 200 && <div className="flex flex-wrap items-center gap-3"><p className="text-sm text-error">Reduce the number of posts per query to stay below 200.</p><Button variant="secondary" size="sm" onClick={() => setMaxPosts(Math.max(1, Math.floor(200 / Math.max(1, preview.length * Math.max(1, query.authors.length)))))}>Use {Math.max(1, Math.floor(200 / Math.max(1, preview.length * Math.max(1, query.authors.length))))} posts per query</Button></div>}
    <Button type="submit" disabled={disabled || pending || (!ai && (manualLimit > 200 || Boolean(previewError)))}>{pending ? "Starting…" : ai ? "Start AI search" : "Search LinkedIn posts"}</Button>
    <p className="text-xs text-muted">Only public, web-indexed LinkedIn posts can be found. Each run fetches at most 200 posts, with a charge cap of at most $1.</p>
    {error && <p role="alert" className="text-sm text-error">{error}</p>}
  </form>;
}
