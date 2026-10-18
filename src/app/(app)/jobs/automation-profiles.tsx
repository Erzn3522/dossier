"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { toast } from "@/components/toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Toggle } from "@/components/ui/toggle";
import { AUTOMATION_PAGE_OPTIONS, type AutomationPagesPerRun } from "@/lib/automation/pages";
import type { AutomatedSearchView } from "@/lib/automation/searches";
import type { SearchQuery } from "@/lib/job-search/search";

import { addAutomatedSearch, changeAutomatedSearchPages, removeAutomatedSearch, runAutomatedSearchNow, toggleAutomatedSearch } from "./actions";

export function AutomationProfiles({ profiles, query }: { profiles: AutomatedSearchView[]; query: SearchQuery }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState(query.keywords);
  const [pagesPerRun, setPagesPerRun] = useState<AutomationPagesPerRun>(1);
  const [pending, start] = useTransition();
  const run = (work: () => Promise<{ ok: boolean; error?: string; toast?: string }>) => start(async () => {
    const result = await work();
    if (!result.ok) toast(result.error ?? "Something went wrong.");
    else if (result.toast) toast(result.toast);
    router.refresh();
  });
  return (
    <section className="mx-14 mb-5 rounded-panel border border-line-card bg-card p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="font-medium">Automatic searches</h2>
          <p className="text-sm text-muted">Each page finds up to 10 jobs and uses one JSearch API request.</p>
        </div>
        <Button variant="secondary" size="sm" onClick={() => { setName(query.keywords); setPagesPerRun(1); setOpen((value) => !value); }}>Save current search</Button>
      </div>
      {open && (
        <div className="mt-4 flex flex-wrap items-end gap-2 border-t border-line pt-4">
          <Input label="Profile name" value={name} onChange={(event) => setName(event.target.value)} className="min-w-[220px] flex-1" />
          <Select label="Pages per run" value={pagesPerRun} onChange={(event) => setPagesPerRun(Number(event.target.value) as AutomationPagesPerRun)} className="min-w-[190px]">
            {AUTOMATION_PAGE_OPTIONS.map((pages) => <option key={pages} value={pages}>{pages} · up to {pages * 10} jobs</option>)}
          </Select>
          <Button size="sm" disabled={pending || !name.trim() || !query.keywords || !query.country} onClick={() => run(async () => {
            const result = await addAutomatedSearch({ name, pagesPerRun, query });
            if (result.ok) setOpen(false);
            return result;
          })}>Add</Button>
        </div>
      )}
      {profiles.length > 0 && (
        <div className="mt-4 divide-y divide-line border-t border-line">
          {profiles.map((profile) => (
            <div key={profile.id} className="flex flex-wrap items-center gap-3 py-3">
              <Toggle className="min-w-[220px] flex-1" label={profile.name} description={`${profile.query.keywords} · ${profile.query.place || profile.query.country.toUpperCase()}`} checked={profile.enabled} onCheckedChange={(enabled) => run(() => toggleAutomatedSearch({ id: profile.id, enabled }))} />
              <Select
                aria-label={`Pages per run for ${profile.name}`}
                value={profile.pagesPerRun}
                disabled={pending}
                onChange={(event) => run(() => changeAutomatedSearchPages({ id: profile.id, pagesPerRun: Number(event.target.value) as AutomationPagesPerRun }))}
                className="min-w-[150px]"
              >
                {AUTOMATION_PAGE_OPTIONS.map((pages) => <option key={pages} value={pages}>{pages} page{pages === 1 ? "" : "s"} · {pages * 10} jobs</option>)}
              </Select>
              <Button variant="secondary" size="sm" disabled={pending} onClick={() => run(() => runAutomatedSearchNow({ id: profile.id }))}>Run now</Button>
              <Button variant="danger-text" size="sm" disabled={pending} onClick={() => run(() => removeAutomatedSearch({ id: profile.id }))}>Remove</Button>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
