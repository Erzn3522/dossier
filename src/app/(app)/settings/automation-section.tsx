"use client";

import { useState } from "react";

import { useTrackSave } from "@/components/save-tracker";
import { toastResult } from "@/components/toast";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Toggle } from "@/components/ui/toggle";

import { disconnectGmail, testGmailConnection, updateSettings } from "./actions";
import { SettingsSectionIntro } from "./settings-screen";

type State = { enabled: boolean; time: string; timeZone: string; threshold: number; blockCriticalGaps: boolean; problem: string | null };
type Gmail = { configured: boolean; email: string | null; connectedAt: Date | null };

export function AutomationSection({ initial, timeZones, gmail: initialGmail, gmailProblem }: { initial: State; timeZones: string[]; gmail: Gmail; gmailProblem: string | null }) {
  const track = useTrackSave();
  const [state, setState] = useState(initial);
  const [gmail, setGmail] = useState(initialGmail);
  const [busy, setBusy] = useState(false);
  const change = (patch: Partial<State>) => {
    const previous = state;
    const next = { ...state, ...patch };
    setState(next);
    void track(updateSettings({
      ...(patch.enabled === undefined ? {} : { automationEnabled: patch.enabled }),
      ...(patch.time === undefined ? {} : { automationTime: patch.time }),
      ...(patch.timeZone === undefined ? {} : { automationTimeZone: patch.timeZone }),
      ...(patch.threshold === undefined ? {} : { automationMatchThreshold: patch.threshold }),
      ...(patch.blockCriticalGaps === undefined ? {} : { automationBlockCriticalGaps: patch.blockCriticalGaps }),
    })).then((result) => { if (!toastResult(result).ok) setState(previous); });
  };
  const connectionAction = async (kind: "test" | "disconnect") => {
    setBusy(true);
    const result = toastResult(await (kind === "test" ? testGmailConnection({}) : disconnectGmail({})));
    if (result.ok) setGmail(result.data);
    setBusy(false);
  };

  return (
    <>
      <SettingsSectionIntro title="Automation">Daily searches prepare applications for review. Every Gmail message still needs a separate approval.</SettingsSectionIntro>
      <Card className="flex flex-col gap-5">
        <Toggle label="Run daily job searches" description="Uses each enabled search profile once per day." checked={state.enabled} onCheckedChange={(enabled) => change({ enabled })} />
        <div className="grid gap-4 sm:grid-cols-2">
          <Input label="Daily time" type="time" value={state.time} onChange={(event) => change({ time: event.target.value })} />
          <Select label="Time zone" value={state.timeZone} onChange={(event) => change({ timeZone: event.target.value })}>
            {timeZones.map((timeZone) => <option key={timeZone} value={timeZone}>{timeZone}</option>)}
          </Select>
          <Input label="Minimum match (%)" type="number" min={1} max={100} value={state.threshold} onChange={(event) => change({ threshold: Number(event.target.value) })} />
        </div>
        <p className="text-meta text-muted">Daily time follows the selected zone, including daylight-saving changes.</p>
        <Toggle label="Block mandatory language/experience gaps" checked={state.blockCriticalGaps} onCheckedChange={(blockCriticalGaps) => change({ blockCriticalGaps })} />
        {state.problem && <p role="alert" className="text-sm text-error-strong">Last run: {state.problem}</p>}
      </Card>
      <Card className="flex flex-col items-start gap-4">
        <div>
          <h3 className="font-medium">Gmail sending</h3>
          <p className="mt-1 text-sm text-muted">Scope: identity and gmail.send only. Dossier cannot read your inbox.</p>
        </div>
        {gmailProblem && <p role="alert" className="rounded-control bg-danger-soft p-3 text-sm text-error-strong">{gmailProblem}</p>}
        {gmail.email ? (
          <>
            <p className="text-sm">Connected as <strong>{gmail.email}</strong></p>
            <div className="flex gap-2">
              <Button variant="secondary" size="sm" disabled={busy} onClick={() => void connectionAction("test")}>Test connection</Button>
              <Button variant="danger-outline" size="sm" disabled={busy} onClick={() => void connectionAction("disconnect")}>Disconnect</Button>
            </div>
          </>
        ) : gmail.configured ? (
          <a href="/api/gmail/connect" className="rounded-control bg-primary px-4 py-2.5 text-sm font-medium text-on-primary hover:text-on-primary">Connect Gmail</a>
        ) : (
          <p className="text-sm text-muted">Add DOSSIER_PUBLIC_URL, DOSSIER_GOOGLE_CLIENT_ID and DOSSIER_GOOGLE_CLIENT_SECRET, then restart Dossier.</p>
        )}
      </Card>
    </>
  );
}
