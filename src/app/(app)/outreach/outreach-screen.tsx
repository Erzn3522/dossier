"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useMemo, useState, useTransition } from "react";

import { toastResult } from "@/components/toast";
import { Button, buttonClassName } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Toggle } from "@/components/ui/toggle";
import type { ActionResult } from "@/lib/action";
import type { Unit } from "@/lib/application-data";
import type { OutreachContact, OutreachEvidence } from "@/lib/outreach/data";

import {
  deleteOutreachCampaign,
  dismissOutreachLeads,
  markUnknownOutreachSent,
  retryOutreachResearch,
  requeueFailedOutreach,
  removeOutreachSuppression,
  retryUnknownOutreach,
  runOutreachNow,
  saveOutreachCampaign,
  saveOutreachDraft,
  suppressOutreachLead,
  toggleOutreachCampaign,
  updateOutreachSettings,
} from "./actions";

type Campaign = {
  id: string; name: string; enabled: boolean; keywords: string[]; countries: string[]; countryOptions: string[]; remote: boolean;
  targetRole: string; opportunity: string; pitch: string; cta: string; language: string;
  fitThreshold: number; dailyDiscoveryLimit: number; lastRunAt: string | null;
  lastRun: { status: string; found: number; prepared: number; filtered: number; failed: number } | null;
};
type Lead = {
  id: string; campaign: string; targetRole: string; language: string; companyName: string; domain: string; website: string;
  status: string; score: number | null; reason: string | null; error: string | null; contacts: OutreachContact[];
  research: OutreachEvidence | null; selectedEmail: string; subject: string; body: string; resumeUnits: Unit[];
  approvedAt: string | null; queuedFor: string | null; sentAt: string | null; createdAt: string;
  delivery: { status: string; error: string | null; attemptedAt: string; gmailMessageId: string | null } | null;
};
type Settings = { enabled: boolean; acknowledged: boolean; time: string; timeZone: string; dailySendLimit: number; problem: string | null };
type CampaignForm = Omit<Campaign, "id" | "lastRunAt" | "lastRun" | "countryOptions">;
type View = "campaigns" | "leads" | "review" | "sent";

const NAV: { value: View; label: string }[] = [
  { value: "campaigns", label: "Campaigns" }, { value: "leads", label: "Leads" }, { value: "review", label: "Review" }, { value: "sent", label: "Sent" },
];
const emptyCampaign: CampaignForm = {
  name: "", enabled: true, keywords: ["computer vision"], countries: ["Europe"], remote: true,
  targetRole: "Computer Vision / Machine Learning Engineer", opportunity: "Full-time employment or a relevant engineering opportunity",
  pitch: "Introduce my relevant computer vision and image processing experience using only facts from my profile.",
  cta: "Ask whether a short introductory conversation would be useful.", language: "English", fitThreshold: 70, dailyDiscoveryLimit: 10,
};

export function OutreachScreen({ campaigns, leads, settings, timeZones, suppressions, searchConfigured }: {
  campaigns: Campaign[]; leads: Lead[]; settings: Settings; timeZones: string[];
  suppressions: { id: string; kind: string; value: string; createdAt: string }[];
  searchConfigured: boolean;
}) {
  const query = useSearchParams();
  const raw = query.get("view");
  const view: View = NAV.some((item) => item.value === raw) ? raw as View : "campaigns";
  const reviewCount = leads.filter((lead) => lead.status === "READY").length;
  return (
    <main className="px-14 pb-16">
      <nav aria-label="Outreach views" className="mb-6 flex flex-wrap gap-2 border-b border-line pb-3">
        {NAV.map((item) => <Link key={item.value} href={`/outreach?view=${item.value}`} className={buttonClassName(view === item.value ? "primary" : "text", "sm")}>{item.label}{item.value === "review" ? ` (${reviewCount})` : ""}</Link>)}
      </nav>
      {view === "campaigns" && <Campaigns campaigns={campaigns} settings={settings} timeZones={timeZones} suppressions={suppressions} searchConfigured={searchConfigured} />}
      {view === "leads" && <Leads leads={leads} />}
      {view === "review" && <Review leads={leads.filter((lead) => ["READY", "APPROVED", "QUEUED"].includes(lead.status))} />}
      {view === "sent" && <Sent leads={leads.filter((lead) => ["SENT", "FAILED", "UNKNOWN", "SENDING"].includes(lead.status) && lead.delivery)} />}
    </main>
  );
}

function useRun() {
  const router = useRouter();
  const [pending, start] = useTransition();
  const run = <T,>(work: () => Promise<ActionResult<T>>) => start(async () => { toastResult(await work()); router.refresh(); });
  return { pending, run };
}

function Campaigns({ campaigns, settings, timeZones, suppressions, searchConfigured }: { campaigns: Campaign[]; settings: Settings; timeZones: string[]; suppressions: { id: string; kind: string; value: string; createdAt: string }[]; searchConfigured: boolean }) {
  const { pending, run } = useRun();
  const [schedule, setSchedule] = useState(settings);
  const [editing, setEditing] = useState<Campaign | null>(null);
  const [creating, setCreating] = useState(false);
  const saveSchedule = () => run(() => updateOutreachSettings(schedule));
  return <div className="space-y-6">
    <Card className="space-y-5">
      <div><h2 className="font-medium">Outreach safety and schedule</h2><p className="mt-1 text-sm text-muted">Discovery and sending remain off until you explicitly enable them. Approved messages wait for this separate daily window. Company analysis and writing require the local Ollama/llama.cpp provider.</p></div>
      <Checkbox label="I understand that a public business email does not by itself create permission in every country, and I will consider GDPR legitimate interest and local ePrivacy rules." checked={schedule.acknowledged} onChange={(event) => setSchedule({ ...schedule, acknowledged: event.target.checked })} />
      <Toggle label="Enable cold outreach" description="Runs active campaigns and sends only individually approved drafts." checked={schedule.enabled} onCheckedChange={(enabled) => setSchedule({ ...schedule, enabled })} />
      <div className="grid gap-4 sm:grid-cols-3">
        <Input label="Daily window" type="time" value={schedule.time} onChange={(event) => setSchedule({ ...schedule, time: event.target.value })} />
        <Select label="Time zone" value={schedule.timeZone} onChange={(event) => setSchedule({ ...schedule, timeZone: event.target.value })}>{timeZones.map((zone) => <option key={zone}>{zone}</option>)}</Select>
        <Input label="Daily send limit" type="number" min={1} max={5} value={schedule.dailySendLimit} onChange={(event) => setSchedule({ ...schedule, dailySendLimit: Number(event.target.value) })} />
      </div>
      <p className="text-sm text-muted">Approved emails are spaced five minutes apart. The installation-wide hard maximum is five cold emails per local calendar day.</p>
      {!searchConfigured && <p role="alert" className="text-sm text-error-strong">SearXNG is not configured. Set DOSSIER_SEARXNG_URL before running discovery.</p>}
      {schedule.problem && <p role="alert" className="text-sm text-error-strong">Last run: {schedule.problem}</p>}
      <Button disabled={pending} onClick={saveSchedule}>Save outreach settings</Button>
      <p className="text-meta text-muted">Before sending, review the <a className="underline" target="_blank" rel="noreferrer" href="https://commission.europa.eu/law/law-topic/data-protection/information-business-and-organisations/legal-grounds-processing-data_en">European Commission guidance</a> and <a className="underline" target="_blank" rel="noreferrer" href="https://support.google.com/mail/answer/14229414">Google sender guidelines</a>.</p>
    </Card>
    <div className="flex items-center justify-between"><div><h2 className="font-medium">Campaigns</h2><p className="text-sm text-muted">Each campaign researches at most its New companies/day (up to 25), dismissed ones included. Every run searches the next eight queries of its plan.</p></div><Button size="sm" onClick={() => setCreating(true)}>New campaign</Button></div>
    {creating && <CampaignEditor initial={emptyCampaign} pending={pending} onCancel={() => setCreating(false)} onSave={(data) => run(async () => { const result = await saveOutreachCampaign(data); if (result.ok) setCreating(false); return result; })} />}
    {campaigns.map((campaign) => editing?.id === campaign.id
      ? <CampaignEditor key={campaign.id} initial={campaign} pending={pending} onCancel={() => setEditing(null)} onSave={(data) => run(async () => { const result = await saveOutreachCampaign({ ...data, id: campaign.id }); if (result.ok) setEditing(null); return result; })} />
      : <Card key={campaign.id} className="space-y-4"><div className="flex flex-wrap items-start justify-between gap-4"><div><h3 className="font-medium">{campaign.name}</h3><p className="text-sm text-muted">{campaign.keywords.join(", ")} · {campaign.countries.join(", ")} · threshold {campaign.fitThreshold}%</p></div><Toggle label={campaign.enabled ? "Active" : "Paused"} checked={campaign.enabled} onCheckedChange={(enabled) => run(() => toggleOutreachCampaign({ id: campaign.id, enabled }))} /></div><p className="text-sm">{campaign.targetRole} · {campaign.opportunity}</p>{campaign.lastRun && <p className="text-meta text-muted">Last run: {campaign.lastRun.status.toLowerCase()} · {campaign.lastRun.found} found · {campaign.lastRun.prepared} prepared · {campaign.lastRun.filtered} filtered · {campaign.lastRun.failed} failed</p>}<div className="flex flex-wrap items-end gap-3"><RunCampaign campaign={campaign} disabled={pending || !campaign.enabled || !settings.enabled || !searchConfigured} onRun={(country) => run(() => runOutreachNow({ id: campaign.id, country }))} /><Button variant="secondary" size="sm" onClick={() => setEditing(campaign)}>Edit</Button><Button variant="danger-text" size="sm" onClick={() => run(() => deleteOutreachCampaign({ id: campaign.id }))}>Remove</Button></div></Card>)}
    <Card><h2 className="font-medium">Suppression list</h2><p className="mt-1 text-sm text-muted">These values apply across every campaign and are never rediscovered unless you remove them here.</p>{suppressions.length ? <ul className="mt-4 space-y-2 text-sm">{suppressions.map((item) => <li key={item.id} className="flex items-center justify-between gap-3"><span><span className="text-meta uppercase text-muted">{item.kind}</span> · {item.value}</span><Button variant="danger-text" size="sm" disabled={pending} onClick={() => run(() => removeOutreachSuppression({ id: item.id }))}>Remove</Button></li>)}</ul> : <p className="mt-4 text-sm text-muted">No suppressed emails or domains.</p>}</Card>
  </div>;
}

function RunCampaign({ campaign, disabled, onRun }: { campaign: Campaign; disabled: boolean; onRun: (country: string | null) => void }) {
  const [country, setCountry] = useState("");
  return <>
    {campaign.countryOptions.length > 1 && <Select label="Search in" value={country} onChange={(e) => setCountry(e.target.value)}><option value="">All regions</option>{campaign.countryOptions.map((option) => <option key={option} value={option}>{option}</option>)}</Select>}
    <Button size="sm" disabled={disabled} onClick={() => onRun(country || null)}>Run now</Button>
  </>;
}

function CampaignEditor({ initial, pending, onCancel, onSave }: { initial: CampaignForm; pending: boolean; onCancel: () => void; onSave: (data: CampaignForm) => void }) {
  const [data, setData] = useState({ ...initial, keywords: initial.keywords.join(", "), countries: initial.countries.join(", ") });
  const input = { ...data, keywords: data.keywords.split(",").map((value) => value.trim()).filter(Boolean), countries: data.countries.split(",").map((value) => value.trim()).filter(Boolean) };
  return <Card className="grid gap-4 sm:grid-cols-2">
    <Input label="Campaign name" value={data.name} onChange={(e) => setData({ ...data, name: e.target.value })} />
    <Input label="Language" value={data.language} onChange={(e) => setData({ ...data, language: e.target.value })} />
    <Input className="sm:col-span-2" label="Keywords (comma separated)" value={data.keywords} onChange={(e) => setData({ ...data, keywords: e.target.value })} />
    <Input className="sm:col-span-2" label="Countries/regions (comma separated)" value={data.countries} onChange={(e) => setData({ ...data, countries: e.target.value })} />
    <Input className="sm:col-span-2" label="Target role" value={data.targetRole} onChange={(e) => setData({ ...data, targetRole: e.target.value })} />
    <Textarea className="sm:col-span-2" label="Opportunity" value={data.opportunity} onChange={(e) => setData({ ...data, opportunity: e.target.value })} />
    <Textarea className="sm:col-span-2" label="Pitch guidance" value={data.pitch} onChange={(e) => setData({ ...data, pitch: e.target.value })} />
    <Textarea className="sm:col-span-2" label="CTA" value={data.cta} onChange={(e) => setData({ ...data, cta: e.target.value })} />
    <Input label="Minimum fit (%)" type="number" min={1} max={100} value={data.fitThreshold} onChange={(e) => setData({ ...data, fitThreshold: Number(e.target.value) })} />
    <Input label="New companies/day" type="number" min={1} max={25} value={data.dailyDiscoveryLimit} onChange={(e) => setData({ ...data, dailyDiscoveryLimit: Number(e.target.value) })} />
    <Checkbox label="Include remote companies" checked={data.remote} onChange={(e) => setData({ ...data, remote: e.target.checked })} />
    <Checkbox label="Campaign active" checked={data.enabled} onChange={(e) => setData({ ...data, enabled: e.target.checked })} />
    <div className="flex gap-3 sm:col-span-2"><Button disabled={pending} onClick={() => onSave(input)}>Save campaign</Button><Button variant="secondary" onClick={onCancel}>Cancel</Button></div>
  </Card>;
}

function Leads({ leads }: { leads: Lead[] }) {
  const { pending, run } = useRun();
  const [status, setStatus] = useState("all");
  const [maximum, setMaximum] = useState(100);
  const [selected, setSelected] = useState<string[]>([]);
  const shown = useMemo(() => leads.filter((lead) => (status === "all" || lead.status === status) && (lead.score === null || lead.score <= maximum)), [leads, status, maximum]);
  const dismissable = shown.filter((lead) => !lead.delivery && ["DISCOVERED", "FILTERED", "READY", "FAILED"].includes(lead.status));
  return <div className="space-y-5">
    <Card className="flex flex-wrap items-end gap-4"><Select label="Status" value={status} onChange={(e) => setStatus(e.target.value)}><option value="all">All statuses</option>{[...new Set(leads.map((lead) => lead.status))].sort().map((value) => <option key={value}>{value}</option>)}</Select><Input label="Maximum score" type="number" min={0} max={100} value={maximum} onChange={(e) => setMaximum(Number(e.target.value))} /><p className="pb-3 text-sm text-muted">{shown.length} of {leads.length} leads</p></Card>
    <div className="flex gap-3"><Checkbox label={`Select ${dismissable.length} dismissable`} checked={dismissable.length > 0 && dismissable.every((lead) => selected.includes(lead.id))} onChange={(e) => setSelected(e.target.checked ? dismissable.map((lead) => lead.id) : [])} /><Button variant="danger-outline" size="sm" disabled={pending || !selected.length} onClick={() => run(() => dismissOutreachLeads({ ids: selected }))}>Dismiss selected ({selected.length})</Button></div>
    {shown.map((lead) => <Card key={lead.id} className="flex flex-wrap items-start gap-4"><Checkbox label="" aria-label={`Select ${lead.companyName}`} disabled={!dismissable.some((item) => item.id === lead.id)} checked={selected.includes(lead.id)} onChange={(e) => setSelected(e.target.checked ? [...selected, lead.id] : selected.filter((id) => id !== lead.id))} /><div className="min-w-0 flex-1"><div className="flex flex-wrap items-center gap-2"><h3 className="font-medium">{lead.companyName}</h3><span className="rounded-full bg-selected px-2 py-1 text-meta">{lead.status}</span>{lead.score !== null && <span className="text-sm">{lead.score}%</span>}</div><a href={lead.website} target="_blank" rel="noreferrer" className="text-sm text-muted underline">{lead.domain}</a><p className="mt-2 text-sm">{lead.error ?? lead.reason ?? lead.campaign}</p></div>{["FAILED", "FILTERED"].includes(lead.status) && !lead.delivery && <Button size="sm" variant="secondary" disabled={pending} onClick={() => run(() => retryOutreachResearch({ id: lead.id }))}>Retry research</Button>}</Card>)}
    {!shown.length && <p className="text-sm text-muted">No leads match these filters.</p>}
  </div>;
}

function Review({ leads }: { leads: Lead[] }) {
  return <div className="space-y-6"><p className="text-sm text-muted">{leads.filter((lead) => lead.status === "READY").length} leads wait for review. Approval is always individual; bulk approval is intentionally unavailable.</p>{leads.map((lead) => <ReviewCard key={lead.id} lead={lead} />)}{!leads.length && <Card><p className="text-sm text-muted">Nothing is waiting for outreach review.</p></Card>}</div>;
}

function ReviewCard({ lead }: { lead: Lead }) {
  const { pending, run } = useRun();
  const [recipient, setRecipient] = useState(lead.selectedEmail);
  const [subject, setSubject] = useState(lead.subject);
  const [body, setBody] = useState(lead.body);
  const [units, setUnits] = useState(lead.resumeUnits);
  const editable = lead.status === "READY";
  const save = (approve: boolean) => run(() => saveOutreachDraft({ id: lead.id, selectedEmail: recipient, subject, body, resumeUnits: units, approve }));
  return <Card className="space-y-6">
    <div className="flex flex-wrap items-start justify-between gap-4"><div><h2 className="font-medium">{lead.companyName} · {lead.score ?? "–"}%</h2><a href={lead.website} target="_blank" rel="noreferrer" className="text-sm text-muted underline">{lead.domain}</a><p className="mt-2 text-sm">{lead.reason}</p></div><span className="rounded-full bg-selected px-3 py-1 text-sm">{lead.status}</span></div>
    {lead.research && <div><h3 className="text-sm font-medium">Research evidence</h3><p className="mt-1 text-sm">{lead.research.summary}</p><ul className="mt-2 space-y-2 text-sm">{lead.research.pages.map((page, index) => <li key={page.url}><a className="underline" href={page.url} target="_blank" rel="noreferrer">Source {index + 1}: {page.title}</a><p className="text-muted">{page.excerpt.slice(0, 240)}{page.excerpt.length > 240 ? "…" : ""}</p></li>)}</ul></div>}
    <Select label="Verified recipient" value={recipient} disabled={!editable} onChange={(e) => setRecipient(e.target.value)}>{lead.contacts.map((contact) => <option key={contact.email} value={contact.email}>{contact.email} · {contact.role}</option>)}</Select>
    {lead.contacts.find((contact) => contact.email === recipient) && <p className="text-meta text-muted">Exact source: <a className="underline" target="_blank" rel="noreferrer" href={lead.contacts.find((contact) => contact.email === recipient)!.sourceUrl}>{lead.contacts.find((contact) => contact.email === recipient)!.sourceUrl}</a></p>}
    <Input label="Subject" disabled={!editable} value={subject} onChange={(e) => setSubject(e.target.value)} />
    <Textarea label="Email" disabled={!editable} rows={9} value={body} onChange={(e) => setBody(e.target.value)} />
    <div className="space-y-3"><div className="flex items-center justify-between"><h3 className="text-sm font-medium">Tailored CV</h3><a className="text-sm underline" href={`/api/pdf?doc=outreach-resume&lead=${lead.id}`} target="_blank" rel="noreferrer">Download PDF</a></div><details className="rounded-control border border-line p-3"><summary className="cursor-pointer text-sm font-medium">Preview formatted CV</summary><p className="my-2 text-meta text-muted">The preview shows the last saved version. Save edits to refresh it.</p><iframe title={`${lead.companyName} tailored CV preview`} loading="lazy" src={`/print/outreach-resume/${lead.id}`} className="h-[720px] w-full rounded-control border border-line bg-white" /></details>{units.map((unit, index) => <Textarea key={unit.id} label={unit.label} disabled={!editable} rows={unit.text.includes("\n") ? 4 : 2} value={unit.text} onChange={(e) => setUnits(units.map((entry, entryIndex) => entryIndex === index ? { ...entry, text: e.target.value } : entry))} />)}</div>
    {editable ? <div className="flex flex-wrap gap-3"><Button disabled={pending} onClick={() => save(true)}>Approve &amp; queue</Button><Button variant="secondary" disabled={pending} onClick={() => save(false)}>Save changes</Button><Button variant="secondary" disabled={pending} onClick={() => { if (window.confirm("Research this company again and rewrite the email and CV? Your unsaved and saved edits to this draft will be replaced.")) run(() => retryOutreachResearch({ id: lead.id })); }}>Redo draft</Button><Button variant="danger-outline" disabled={pending} onClick={() => run(() => dismissOutreachLeads({ ids: [lead.id] }))}>Dismiss</Button><Button variant="danger-text" disabled={pending} onClick={() => run(() => suppressOutreachLead({ id: lead.id, kind: "EMAIL", email: recipient }))}>Suppress email</Button><Button variant="danger-text" disabled={pending} onClick={() => run(() => suppressOutreachLead({ id: lead.id, kind: "DOMAIN" }))}>Suppress domain</Button></div> : <p className="text-sm text-muted">Approved for the next daily window{lead.queuedFor ? `; scheduled ${new Date(lead.queuedFor).toLocaleString()}` : ""}.</p>}
  </Card>;
}

function Sent({ leads }: { leads: Lead[] }) {
  const { pending, run } = useRun();
  return <div className="space-y-4">{leads.map((lead) => <Card key={lead.id} className="flex flex-wrap items-start justify-between gap-4"><div><h2 className="font-medium">{lead.companyName}</h2><p className="text-sm">{lead.selectedEmail} · {lead.subject}</p><p className="mt-1 text-sm text-muted">{lead.delivery?.status}{lead.sentAt ? ` · ${new Date(lead.sentAt).toLocaleString()}` : ""}</p>{lead.delivery?.error && <p className="mt-2 text-sm text-error-strong">{lead.delivery.error}</p>}</div>{lead.status === "UNKNOWN" ? <div className="flex gap-2"><Button size="sm" disabled={pending} onClick={() => run(() => markUnknownOutreachSent({ id: lead.id }))}>Mark sent</Button><Button size="sm" variant="danger-outline" disabled={pending} onClick={() => { if (window.confirm("Only retry after checking Gmail Sent. A retry can create a duplicate message. Continue?")) run(() => retryUnknownOutreach({ id: lead.id })); }}>Retry with warning</Button></div> : lead.status === "FAILED" ? <Button size="sm" variant="secondary" disabled={pending} onClick={() => run(() => requeueFailedOutreach({ id: lead.id }))}>Queue for next window</Button> : null}</Card>)}{!leads.length && <Card><p className="text-sm text-muted">No outreach deliveries yet.</p></Card>}</div>;
}

