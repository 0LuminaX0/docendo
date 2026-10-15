"use client";

import { useEffect, useMemo, useState } from "react";
import { ArrowDown, ArrowUp, Check, Plus, RotateCcw, Trash2, TriangleAlert } from "lucide-react";
import type { LessonPart, Settings } from "@/lib/settings";

type Coverage = { facts: number; factsTotal: number; ideas: number; ideasTotal: number; unknownVideos: string[] };
type Change = { at: string; version: string; changed: string[]; reset: boolean };

const NAMES: Record<string, string> = {
  practiceMinutes: "practice minutes",
  practiceTries: "tries per problem",
  stopAfterMessages: "stop after messages",
  stopAfterMinutes: "stop after minutes",
  sessionDays: "session days",
  delayedTestDays: "follow-up days",
  calculator: "calculator",
  voice: "voice input",
  dailyTurnLimit: "daily model calls",
  lesson: "lesson videos",
};

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
/** One format on the server and in the browser (a locale's format differs between them and breaks hydration). */
const when = (iso: string) => {
  const d = new Date(iso);
  return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}, ${String(d.getUTCHours()).padStart(2, "0")}:${String(d.getUTCMinutes()).padStart(2, "0")} UTC`;
};
const mmss = (s: number) => `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, "0")}`;
/** "1:51", "111" or "1:51.0" → seconds; null if it doesn't read as a time. */
function seconds(t: string): number | null {
  const m = /^\s*(?:(\d+):)?(\d{1,2}|\d+)(?:\.\d+)?\s*$/.exec(t);
  if (!m) return null;
  return m[1] !== undefined ? Number(m[1]) * 60 + Number(m[2]) : Number(m[2]);
}

/**
 * The Settings page's form: the study's adjustable settings in groups, the lesson's video parts with a live check
 * of what the lesson's help still covers, the parts that are fixed by design, and the recent changes.
 */
export default function SettingsForm({
  initial,
  defaults,
  version,
  defaultVersion,
  coverage: initialCoverage,
  history,
  perVersion,
  fixed,
  demo,
}: {
  initial: Settings;
  defaults: Settings;
  version: string;
  defaultVersion: string;
  coverage: Coverage;
  history: Change[];
  perVersion: Record<string, number>;
  fixed: string[][];
  demo: boolean;
}) {
  const [saved, setSaved] = useState(initial);
  const [s, setS] = useState(initial);
  const [ver, setVer] = useState(version);
  const [coverage, setCoverage] = useState(initialCoverage);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const dirty = JSON.stringify(s) !== JSON.stringify(saved);
  const set = <K extends keyof Settings>(k: K, v: Settings[K]) => setS((x) => ({ ...x, [k]: v }));

  // what the edited lesson still covers (Rewatch moments, Kai's help cards), checked on the server as you edit
  const lessonKey = JSON.stringify(s.lesson);
  useEffect(() => {
    const t = setTimeout(async () => {
      const r = await post({ action: "check", settings: s });
      if (r.ok) setCoverage(r.data.coverage as Coverage);
    }, 400);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lessonKey]);

  async function post(body: unknown): Promise<{ ok: true; data: Record<string, unknown> } | { ok: false; error: string }> {
    const res = await fetch("/api/admin/settings", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    const d = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    return res.ok ? { ok: true, data: d } : { ok: false, error: String(d.error ?? "Something went wrong.") };
  }

  async function save(action: "save" | "reset") {
    if (action === "reset" && !confirm("Go back to the default settings (from the environment and content files)?")) return;
    setBusy(true);
    setMsg(null);
    const r = await post(action === "save" ? { action, settings: s } : { action });
    setBusy(false);
    if (!r.ok) return setMsg({ ok: false, text: r.error });
    const next = r.data.settings as Settings;
    setSaved(next);
    setS(next);
    setVer(String(r.data.version));
    setCoverage(r.data.coverage as Coverage);
    setMsg({ ok: true, text: `Saved as version ${r.data.version}. New page loads use it within seconds.` });
  }

  const lessonSec = useMemo(() => s.lesson.reduce((a, p) => a + Math.max(0, p.end - p.start), 0), [s.lesson]);
  const setPart = (i: number, patch: Partial<LessonPart>) => set("lesson", s.lesson.map((p, k) => (k === i ? { ...p, ...patch } : p)));
  const move = (i: number, d: -1 | 1) => {
    const l = [...s.lesson];
    const [p] = l.splice(i, 1);
    l.splice(i + d, 0, p!);
    set("lesson", l);
  };
  const changed = (k: keyof Settings) => JSON.stringify(s[k]) !== JSON.stringify(defaults[k]);

  return (
    <div className="set">
      <div className="set-grid">
        <section className="adm-card set-card">
          <h2>Practice</h2>
          <p className="note">The same in both conditions.</p>
          <Num label="Minutes for the practice chapter" value={s.practiceMinutes} min={2} max={60} step={1} onChange={(v) => set("practiceMinutes", v)} changed={changed("practiceMinutes")} />
          <Num label="Tries per problem (direct condition: checks; recursive: Kai's attempts stay two)" value={s.practiceTries} min={1} max={5} step={1} onChange={(v) => set("practiceTries", v)} changed={changed("practiceTries")} />
        </section>

        <section className="adm-card set-card">
          <h2>Teaching Kai</h2>
          <p className="note">When participants may end teaching themselves (&quot;I&apos;ve taught all I can&quot;), whichever comes first. Team sessions can from the start.</p>
          <Num label="After this many messages" value={s.stopAfterMessages} min={0} max={30} step={1} onChange={(v) => set("stopAfterMessages", v)} changed={changed("stopAfterMessages")} />
          <Num label="Or after this many minutes" value={s.stopAfterMinutes} min={0} max={30} step={0.5} onChange={(v) => set("stopAfterMinutes", v)} changed={changed("stopAfterMinutes")} />
        </section>

        <section className="adm-card set-card">
          <h2>Sessions and the follow-up test</h2>
          <p className="note">The follow-up test takes the other test form and needs one-use codes (a shared code names nobody).</p>
          <Num label="A session lasts (days, on the device)" value={s.sessionDays} min={1} max={30} step={1} onChange={(v) => set("sessionDays", v)} changed={changed("sessionDays")} />
          <Num label="Follow-up test opens after (days; 0: no follow-up test)" value={s.delayedTestDays} min={0} max={60} step={1} onChange={(v) => set("delayedTestDays", v)} changed={changed("delayedTestDays")} />
        </section>

        <section className="adm-card set-card">
          <h2>Tools</h2>
          <p className="note">Both conditions get the same tools.</p>
          <Toggle label="Calculator in the working fields" hint="Typing a sum and = writes the result. Off: the fields stay, without the sums." value={s.calculator} onChange={(v) => set("calculator", v)} changed={changed("calculator")} />
          <Toggle label="Voice input" hint={demo ? "This server runs in demo mode, so voice is hidden anyway." : "A microphone in the chat and the correction box; about $0.003 a minute of speech."} value={s.voice} onChange={(v) => set("voice", v)} changed={changed("voice")} />
          <Num label="Daily model calls for the whole site (chat, Kai's solving, voice)" value={s.dailyTurnLimit} min={50} max={50000} step={50} onChange={(v) => set("dailyTurnLimit", v)} changed={changed("dailyTurnLimit")} />
        </section>
      </div>

      <section className="adm-card set-card">
        <div className="set-h">
          <div>
            <h2>The lesson</h2>
            <p className="note">
              Parts of YouTube videos, played back to back as one lesson: {s.lesson.length} {s.lesson.length === 1 ? "part" : "parts"}, {mmss(lessonSec)} in all.
            </p>
          </div>
          <span className={`set-cover${coverage.facts < coverage.factsTotal || coverage.ideas < coverage.ideasTotal ? " warn" : ""}`}>
            {coverage.facts < coverage.factsTotal || coverage.ideas < coverage.ideasTotal ? <TriangleAlert size={15} /> : <Check size={15} />}
            Rewatch moments for {coverage.facts} of {coverage.factsTotal} facts; Kai&apos;s help for {coverage.ideas} of {coverage.ideasTotal} ideas
          </span>
        </div>
        {coverage.unknownVideos.length > 0 && (
          <p className="set-warn">
            <TriangleAlert size={15} /> No transcript for {coverage.unknownVideos.join(", ")}: these parts play, but nothing in them can be offered as a Rewatch moment or help.
          </p>
        )}
        <ol className="set-parts">
          {s.lesson.map((p, i) => (
            <Part key={i} p={p} i={i} n={s.lesson.length} onChange={(patch) => setPart(i, patch)} onMove={(d) => move(i, d)} onRemove={() => set("lesson", s.lesson.filter((_, k) => k !== i))} />
          ))}
        </ol>
        <button type="button" className="btn ghost small" disabled={s.lesson.length >= 8} onClick={() => set("lesson", [...s.lesson, { videoId: s.lesson.at(-1)?.videoId ?? "", start: 0, end: 60, title: "New part", channel: s.lesson.at(-1)?.channel ?? "" }])}>
          <Plus size={15} /> Add a part
        </button>
      </section>

      <div className="set-grid">
        <section className="adm-card set-card">
          <h2>Fixed by design</h2>
          <p className="note">Part of the study design: changed in code, with a reason, not mid-study.</p>
          <dl className="adm-dl set-fixed">
            {fixed.map(([a, b]) => (
              <div key={a}>
                <dt>{a}</dt>
                <dd>{b}</dd>
              </div>
            ))}
          </dl>
        </section>
        <section className="adm-card set-card">
          <h2>Recent changes</h2>
          {history.length ? (
            <ul className="set-hist">
              {history.map((h, i) => (
                <li key={i}>
                  <time dateTime={h.at}>{when(h.at)}</time>
                  <code>{h.version}</code>
                  <span>{h.reset ? "back to the defaults" : h.changed.map((c) => NAMES[c] ?? c).join(", ") || "saved, nothing changed"}</span>
                  {perVersion[h.version] ? <span className="note">{perVersion[h.version]} sessions</span> : null}
                </li>
              ))}
            </ul>
          ) : (
            <p className="note">No changes yet: the defaults are in force ({defaultVersion}).</p>
          )}
        </section>
      </div>

      <div className={`set-bar${dirty || msg ? " on" : ""}`} role="region" aria-label="Save the settings">
        <span className="set-bar-text">
          {msg ? (
            <span className={msg.ok ? "ok" : "err"}>{msg.text}</span>
          ) : dirty ? (
            "Unsaved changes."
          ) : (
            <>Version {ver}.</>
          )}
        </span>
        <span className="grow" />
        <button type="button" className="btn ghost small" disabled={busy} onClick={() => void save("reset")}>
          <RotateCcw size={14} /> Defaults
        </button>
        <button type="button" className="btn ghost small" disabled={busy || !dirty} onClick={() => (setS(saved), setMsg(null))}>
          Discard
        </button>
        <button type="button" className="btn primary small" disabled={busy || !dirty} onClick={() => void save("save")}>
          {busy ? "Saving…" : "Save"}
        </button>
      </div>
    </div>
  );
}

function Num({ label, value, min, max, step, onChange, changed }: { label: string; value: number; min: number; max: number; step: number; onChange: (v: number) => void; changed: boolean }) {
  return (
    <label className="set-field">
      <span>
        {label}
        {changed && <i className="set-dot" title="Changed from the default" />}
      </span>
      <input className="input" type="number" min={min} max={max} step={step} value={value} onChange={(e) => onChange(Number(e.target.value))} />
    </label>
  );
}

function Toggle({ label, hint, value, onChange, changed }: { label: string; hint: string; value: boolean; onChange: (v: boolean) => void; changed: boolean }) {
  return (
    <label className="set-toggle">
      <input type="checkbox" role="switch" checked={value} onChange={(e) => onChange(e.target.checked)} />
      <span className="set-switch" aria-hidden="true" />
      <span>
        <b>
          {label}
          {changed && <i className="set-dot" title="Changed from the default" />}
        </b>
        <span className="note">{hint}</span>
      </span>
    </label>
  );
}

function Part({ p, i, n, onChange, onMove, onRemove }: { p: LessonPart; i: number; n: number; onChange: (patch: Partial<LessonPart>) => void; onMove: (d: -1 | 1) => void; onRemove: () => void }) {
  const [start, setStart] = useState(mmss(p.start));
  const [end, setEnd] = useState(mmss(p.end));
  useEffect(() => setStart(mmss(p.start)), [p.start]);
  useEffect(() => setEnd(mmss(p.end)), [p.end]);
  const idOk = /^[A-Za-z0-9_-]{11}$/.test(p.videoId);
  const lenOk = p.end - p.start >= 10;
  return (
    <li className="set-part">
      <span className="set-num">{i + 1}</span>
      {idOk ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img className="set-thumb" src={`https://i.ytimg.com/vi/${p.videoId}/mqdefault.jpg`} alt="" width={112} height={63} />
      ) : (
        <span className="set-thumb empty" />
      )}
      <div className="set-part-fields">
        <input className="input set-title" value={p.title} maxLength={90} onChange={(e) => onChange({ title: e.target.value })} aria-label={`Part ${i + 1}: title`} />
        <div className="set-part-row">
          <label>
            YouTube id
            <input className={`input mono${idOk ? "" : " bad"}`} value={p.videoId} maxLength={11} onChange={(e) => onChange({ videoId: e.target.value.trim() })} />
          </label>
          <label>
            From
            <input className={`input mono time${lenOk ? "" : " bad"}`} value={start} onChange={(e) => (setStart(e.target.value), seconds(e.target.value) !== null && onChange({ start: seconds(e.target.value)! }))} />
          </label>
          <label>
            To
            <input className={`input mono time${lenOk ? "" : " bad"}`} value={end} onChange={(e) => (setEnd(e.target.value), seconds(e.target.value) !== null && onChange({ end: seconds(e.target.value)! }))} />
          </label>
          <label>
            Channel
            <input className="input" value={p.channel} maxLength={40} onChange={(e) => onChange({ channel: e.target.value })} />
          </label>
          <span className="set-len">{lenOk ? mmss(p.end - p.start) : "too short"}</span>
        </div>
      </div>
      <div className="set-part-act">
        <button type="button" className="iconbtn" disabled={i === 0} onClick={() => onMove(-1)} aria-label="Move up">
          <ArrowUp size={15} />
        </button>
        <button type="button" className="iconbtn" disabled={i === n - 1} onClick={() => onMove(1)} aria-label="Move down">
          <ArrowDown size={15} />
        </button>
        <button type="button" className="iconbtn" disabled={n === 1} onClick={onRemove} aria-label="Remove this part">
          <Trash2 size={15} />
        </button>
      </div>
    </li>
  );
}
