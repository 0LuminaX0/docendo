"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { CalendarClock, Check, Unlock } from "lucide-react";

export type Person = {
  pid: string;
  label: string;
  trial: boolean;
  cond: string;
  form: string;
  followForm: string;
  testAt: string | null;
  score: string | null;
  opensAt: number | null;
  early: boolean;
  doneAt: string | null;
  lateScore: string | null;
  status: "first" | "waiting" | "open" | "done";
  sid: string | null;
  lateSid: string | null;
};

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
/** One format on the server and in the browser (a locale's format differs between them and breaks hydration). */
const day = (ms: number | string | null) => {
  if (ms === null) return "–";
  const d = new Date(ms);
  return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}`;
};
const STATUS = { first: "in the first session", waiting: "waiting", open: "open", done: "done" } as const;

/**
 * The follow-up test's controls: the switch and the days (the same setting as Study setup), the counts, and everyone
 * who can take it, with "Open now" and "Back to schedule" per person and for everyone waiting.
 */
export default function FollowUpManager({ rows, on, days, forms, formSize, paired }: { rows: Person[]; on: boolean; days: number; forms: number; formSize: number; paired: number }) {
  const router = useRouter();
  const [who, setWho] = useState<"participants" | "trials" | "all">("all");
  const [sw, setSw] = useState(on);
  const [d, setD] = useState(days);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const shown = rows.filter((r) => (who === "all" ? true : who === "trials" ? r.trial : !r.trial));
  const count = (s: Person["status"]) => shown.filter((r) => r.status === s).length;

  async function call(body: unknown, done: (d: Record<string, unknown>) => string) {
    setBusy(true);
    setMsg(null);
    const res = await fetch("/api/admin/followup", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    setBusy(false);
    setMsg(res.ok ? { ok: true, text: done(data) } : { ok: false, text: String(data.error ?? "Something went wrong.") });
    if (res.ok) router.refresh();
  }

  return (
    <>
      <div className="adm-two">
        <div className="adm-stack">
          <section className="adm-card set-card">
            <h2>When it opens</h2>
            {forms < 2 ? (
              <p className="note">The topic pack has one test form: a follow-up needs a second one.</p>
            ) : (
              <>
                <label className="set-toggle">
                  <input type="checkbox" role="switch" checked={sw} onChange={(e) => setSw(e.target.checked)} />
                  <span className="set-switch" aria-hidden="true" />
                  <span>
                    <b>Follow-up test</b>
                    <span className="note">{sw ? "On: people with their own code can take it." : "Off: nobody can start it (early openings wait too)."}</span>
                  </span>
                </label>
                <label className="set-field">
                  <span>Opens on its own after this many days (0: right away)</span>
                  <input className="input" type="number" min={0} max={60} step={1} value={d} disabled={!sw} onChange={(e) => setD(Number(e.target.value))} />
                </label>
                <div className="row">
                  <button type="button" className="btn primary small" disabled={busy || (sw === on && d === days)} onClick={() => void call({ action: "setting", followUp: sw, followUpDays: d }, (x) => `Saved as version ${String(x.version)}.`)}>
                    Save
                  </button>
                  <span className="note">The same setting as on Study setup; every change is versioned.</span>
                </div>
              </>
            )}
          </section>
        </div>
        <div className="adm-stack">
          <section className="adm-card">
            <h2>The test</h2>
            <dl className="adm-dl">
              <dt>Form</dt>
              <dd>the other one (A first, then B; or B, then A)</dd>
              <dt>Questions</dt>
              <dd>
                {formSize}, {paired} of them the twin of a question in the first form
              </dd>
              <dt>First</dt>
              <dd>&quot;have you looked at the topic again since?&quot;</dd>
              <dt>Not repeated</dt>
              <dd>the questions after the test, the practice solutions</dd>
            </dl>
          </section>
        </div>
      </div>

      <section className="adm-kpis">
        <div><b>{count("waiting")}</b><span>waiting for their date</span></div>
        <div className={count("open") ? "live" : ""}><b>{count("open")}</b><span>open, not taken yet</span></div>
        <div><b>{count("done")}</b><span>done both tests</span></div>
        <div><b>{count("first")}</b><span>still in the first session</span></div>
      </section>

      <section className="adm-card">
        <div className="fu-bar">
          <span className="adm-seg">
            {(["all", "participants", "trials"] as const).map((w) => (
              <button key={w} type="button" aria-current={who === w ? "page" : undefined} onClick={() => setWho(w)}>
                {w === "all" ? "Everyone" : w === "participants" ? "Participants" : "Trial runs"}
              </button>
            ))}
          </span>
          <span className="grow" />
          {msg && <span className={msg.ok ? "ok-text" : "error-text"}>{msg.text}</span>}
          <button type="button" className="btn primary small" disabled={busy || !count("waiting")} onClick={() => confirm(`Open the follow-up now for ${count("waiting")} ${count("waiting") === 1 ? "person" : "people"} waiting?`) && void call({ action: "open-waiting", who }, (x) => `Opened for ${String(x.changed)}.`)}>
            <Unlock size={14} /> Open now for everyone waiting
          </button>
        </div>
        <table className="adm-table">
          <thead>
            <tr>
              <th>Who</th>
              <th>Condition</th>
              <th>Final test</th>
              <th>Follow-up</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {shown.map((r) => (
              <tr key={r.pid} className={r.status === "done" ? "off" : ""}>
                <td>
                  <code>{r.pid}</code> {r.label && <span className="note">“{r.label}”</span>} {r.trial && <span className="adm-pill">trial</span>}
                </td>
                <td>
                  <span className={`adm-pill ${r.cond === "recursive" ? "rec" : "dir"}`}>{r.cond}</span>
                </td>
                <td>
                  {r.testAt ? (
                    <>
                      {day(r.testAt)}, form {r.form}
                      {r.score && <> ({r.sid ? <Link href={`/admin/sessions/${r.sid}`}>{r.score}</Link> : r.score})</>}
                    </>
                  ) : (
                    <span className="note">not yet</span>
                  )}
                </td>
                <td>
                  <span className={`fu-status ${r.status}`}>
                    {r.status === "done" ? <Check size={13} /> : r.status === "open" ? <Unlock size={13} /> : <CalendarClock size={13} />}
                    {STATUS[r.status]}
                  </span>{" "}
                  <span className="note">
                    {r.status === "waiting" && `opens ${day(r.opensAt)}, form ${r.followForm}`}
                    {r.status === "open" && `since ${day(r.opensAt)}${r.early ? ", opened early" : ""}`}
                    {r.status === "done" && (
                      <>
                        {day(r.doneAt)}, {r.lateSid ? <Link href={`/admin/sessions/${r.lateSid}`}>{r.lateScore}</Link> : r.lateScore}
                      </>
                    )}
                  </span>
                </td>
                <td className="adm-rowact">
                  {r.status === "waiting" && (
                    <button type="button" className="btn ghost small" disabled={busy} onClick={() => void call({ action: "open", pids: [r.pid] }, () => `Opened for ${r.pid}.`)}>
                      Open now
                    </button>
                  )}
                  {r.status === "open" && r.early && (
                    <button type="button" className="btn ghost small" disabled={busy} onClick={() => void call({ action: "schedule", pids: [r.pid] }, () => `${r.pid} is back on the schedule.`)}>
                      Back to schedule
                    </button>
                  )}
                </td>
              </tr>
            ))}
            {!shown.length && (
              <tr>
                <td colSpan={5} className="note">
                  Nobody with their own code yet. One-use codes from <Link href="/admin/codes">Access</Link> (participant or trial run) appear here once used.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </section>
    </>
  );
}
