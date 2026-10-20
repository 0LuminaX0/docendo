"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { ArrowDown, ArrowUp, Check, ExternalLink, Lock, Plus, RotateCcw, Trash2, TriangleAlert } from "lucide-react";
import type { LessonPart, Settings } from "@/lib/settings";
import { BLOCKS, flowOf, type StepKey } from "@/lib/flow";
import type { PackSummary } from "@/lib/server/study";

type Change = { at: string; version: string; changed: string[]; reset: boolean; times: number };

const NAMES: Record<string, string> = {
  topic: "topic",
  studyLine: "study line",
  pretest: "before you start",
  watch: "video lesson",
  teach: "teaching",
  practice: "practice",
  test: "final test",
  survey: "questions after the test",
  sessionDays: "session days",
  tools: "tools",
  dailyTurnLimit: "daily model calls",
  // settings saved before the blocks
  practiceMinutes: "practice minutes",
  practiceTries: "tries per problem",
  stopAfterMessages: "stop after messages",
  stopAfterMinutes: "stop after minutes",
  delayedTestDays: "follow-up days",
  calculator: "calculator",
  voice: "voice input",
  lesson: "video lesson",
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
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

// the blocks as the page lists them: the session's steps, with the questions after the test before the results
const ROWS: (StepKey | "survey")[] = ["pretest", "watch", "teach", "practice", "exercises", "survey", "results"];
const ROW_NAME = (k: StepKey | "survey") => (k === "survey" ? "Questions after the test" : BLOCKS.find((b) => b.key === k)!.name);
const ROW_ABOUT = (k: StepKey | "survey") =>
  k === "survey" ? "A few questions on effort, responsibility for Kai and enjoyment, plus the manipulation check. Shown before the score so it can't colour them." : BLOCKS.find((b) => b.key === k)!.about;

/**
 * The Study setup page: which topic pack the study runs, the session's steps as blocks (each switched on or off, with
 * its own settings and a summary counted from the pack), the general settings, and how long a session takes. Every
 * edit is checked on the server against the pack (what the lesson's help still covers, what the pack can't do).
 */
export default function SettingsForm({
  initial,
  defaults: initialDefaults,
  summary: initialSummary,
  topics,
  version,
  defaultVersion,
  history,
  perVersion,
  demo,
}: {
  initial: Settings;
  defaults: Settings;
  summary: PackSummary;
  topics: { slug: string; title: string }[];
  version: string;
  defaultVersion: string;
  history: Change[];
  perVersion: Record<string, number>;
  demo: boolean;
}) {
  const [saved, setSaved] = useState(initial);
  const [s, setS] = useState(initial);
  const [defaults, setDefaults] = useState(initialDefaults);
  const [summary, setSummary] = useState(initialSummary);
  const [problem, setProblem] = useState<string | null>(null);
  const [ver, setVer] = useState(version);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const dirty = !same(s, saved);
  const set = <K extends keyof Settings>(k: K, v: Settings[K]) => setS((x) => ({ ...x, [k]: v }));
  const patch = <K extends "pretest" | "watch" | "teach" | "practice" | "test" | "survey" | "tools">(k: K, v: Partial<Settings[K]>) => setS((x) => ({ ...x, [k]: { ...x[k], ...v } }));

  // every edit: the pack's view of it (summaries, the lesson's help, what the pack can't do), unsaved
  const key = JSON.stringify(s);
  useEffect(() => {
    const t = setTimeout(async () => {
      const r = await post({ action: "check", settings: s });
      if (r.ok) {
        setSummary(r.data.summary as PackSummary);
        setProblem((r.data.problem as string | null) ?? null);
      }
    }, 350);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  async function post(body: unknown): Promise<{ ok: true; data: Record<string, unknown> } | { ok: false; error: string }> {
    const res = await fetch("/api/admin/settings", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    const d = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    return res.ok ? { ok: true, data: d } : { ok: false, error: String(d.error ?? "Something went wrong.") };
  }

  async function save(action: "save" | "reset") {
    if (action === "reset" && !confirm("Go back to the defaults (the environment and the topic pack's own lesson and timing)?")) return;
    setBusy(true);
    setMsg(null);
    const r = await post(action === "save" ? { action, settings: s } : { action });
    setBusy(false);
    if (!r.ok) return setMsg({ ok: false, text: r.error });
    const next = r.data.settings as Settings;
    setSaved(next);
    setS(next);
    setVer(String(r.data.version));
    setSummary(r.data.summary as PackSummary);
    setMsg({ ok: true, text: `Saved as version ${r.data.version}. New page loads use it within seconds.` });
  }

  /** Another topic pack: its own lesson and practice timing come with it; the other settings stay. */
  async function pickTopic(slug: string) {
    if (slug === s.topic) return;
    const r = await post({ action: "topic", topic: slug });
    if (!r.ok) return setMsg({ ok: false, text: r.error });
    const d = r.data.defaults as Settings;
    setDefaults(d);
    setS((x) => ({ ...x, topic: d.topic, watch: { ...x.watch, parts: d.watch.parts }, practice: { ...x.practice, minutes: d.practice.minutes } }));
  }

  const flow = flowOf(s);
  const isOn = (k: StepKey | "survey") => (k === "survey" ? s.survey.on : k === "pretest" ? s.pretest.on : k === "watch" ? s.watch.on : k === "practice" ? s.practice.on : true);
  const optional = (k: StepKey | "survey") => k === "survey" || BLOCKS.find((b) => b.key === k)!.optional;
  const toggle = (k: StepKey | "survey", on: boolean) => (k === "survey" || k === "pretest" || k === "watch" || k === "practice" ? patch(k, { on }) : undefined);
  const changed = (k: keyof Settings) => !same(s[k], defaults[k]);
  const stepNo = (k: StepKey | "survey") => (k === "survey" ? null : flow.indexOf(k) + 1 || null);
  const cov = summary.coverage;
  const coverOk = cov.facts === cov.factsTotal && cov.ideas === cov.ideasTotal;
  const lessonSec = s.watch.parts.reduce((a, p) => a + Math.max(0, p.end - p.start), 0);
  const maxMin = Math.max(1, ...flow.map((k) => summary.minutes[k]));
  const twoForms = summary.forms.length > 1;

  return (
    <div className="study">
      <div className="study-main">
        <section className="adm-card study-topic">
          <div className="study-topic-head">
            <div>
              <span className="adm-side-h">Topic pack</span>
              <h2>{summary.title}</h2>
              <p className="note">{summary.goal}</p>
            </div>
            <label className="study-pick">
              <span className="note">Runs</span>
              <select className="input" value={s.topic} onChange={(e) => void pickTopic(e.target.value)} disabled={topics.length < 2} title={topics.length < 2 ? "One pack on this server: add one in topics/ and lib/server/topics.ts" : undefined}>
                {topics.map((t) => (
                  <option key={t.slug} value={t.slug}>
                    {t.title}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <ul className="study-facts">
            <li><b>{summary.ideas}</b> ideas in the lesson{summary.ideasAround ? `, ${summary.ideasAround} around it` : ""}</li>
            <li><b>{summary.facts}</b> facts Kai waits for</li>
            <li><b>{summary.videos}</b> source {summary.videos === 1 ? "video" : "videos"}</li>
            <li><b>{summary.practice.problems}</b> practice problems</li>
            <li><b>{summary.forms.length}</b> test {summary.forms.length === 1 ? "form" : "forms"} of {summary.forms.map((f) => f.items).join(" and ")}</li>
            <li><b>{summary.pretest.items}</b> pretest, <b>{summary.survey}</b> survey questions</li>
          </ul>
          <p className="note">
            Everything the topic brings lives in <code>topics/{summary.slug}/</code>. <Link href="/admin/content">See its content</Link>.
            {s.topic !== saved.topic && " Sessions already running keep the topic they started with."}
          </p>
        </section>

        <section className="study-steps" aria-label="The session's steps">
          <div className="study-steps-head">
            <h2>The session, step by step</h2>
            <p className="note">Switch the optional steps on or off. Teaching Kai, the final test and the results are always there. The order follows what each step needs.</p>
          </div>
          <ol className="study-blocks">
            {ROWS.map((k) => {
              const on = isOn(k);
              const no = stepNo(k);
              return (
                <li key={k} className={`study-block${on ? "" : " off"}`}>
                  <span className={`study-no tone-${k}`}>{on ? (no ?? <Check size={14} />) : ""}</span>
                  <div className="study-body">
                    <div className="study-row">
                      <div className="study-title">
                        <h3>{ROW_NAME(k)}</h3>
                        <span className="note">{on ? summary.blocks[k] : "Off: sessions skip this step"}</span>
                      </div>
                      {optional(k) ? (
                        <label className="set-toggle compact" title={on ? "Switch off" : "Switch on"}>
                          <input type="checkbox" role="switch" checked={on} onChange={(e) => toggle(k, e.target.checked)} aria-label={`${ROW_NAME(k)}: on`} />
                          <span className="set-switch" aria-hidden="true" />
                        </label>
                      ) : (
                        <span className="study-lock" title="Always part of a session">
                          <Lock size={13} /> always on
                        </span>
                      )}
                    </div>
                    {on && <p className="study-about">{ROW_ABOUT(k)}</p>}

                    {on && k === "watch" && (
                      <div className="study-fields">
                        <div className="set-h">
                          <span className="note">
                            {s.watch.parts.length} {s.watch.parts.length === 1 ? "part" : "parts"}, {mmss(lessonSec)} in all, played back to back as one video
                          </span>
                          <span className={`set-cover${coverOk ? "" : " warn"}`}>
                            {coverOk ? <Check size={15} /> : <TriangleAlert size={15} />}
                            Rewatch moments for {cov.facts} of {cov.factsTotal} facts; Kai&apos;s help for {cov.ideas} of {cov.ideasTotal} ideas
                          </span>
                        </div>
                        {cov.unknownVideos.length > 0 && (
                          <p className="set-warn">
                            <TriangleAlert size={15} /> The pack has no transcript for {cov.unknownVideos.join(", ")}: these parts play, but nothing in them can be offered as a Rewatch moment or help.
                          </p>
                        )}
                        <ol className="set-parts">
                          {s.watch.parts.map((p, i) => (
                            <Part
                              key={i}
                              p={p}
                              i={i}
                              n={s.watch.parts.length}
                              onChange={(x) => patch("watch", { parts: s.watch.parts.map((q, j) => (j === i ? { ...q, ...x } : q)) })}
                              onMove={(d) => {
                                const l = [...s.watch.parts];
                                const [q] = l.splice(i, 1);
                                l.splice(i + d, 0, q!);
                                patch("watch", { parts: l });
                              }}
                              onRemove={() => patch("watch", { parts: s.watch.parts.filter((_, j) => j !== i) })}
                            />
                          ))}
                        </ol>
                        <div className="row">
                          <button type="button" className="btn ghost small" disabled={s.watch.parts.length >= 8} onClick={() => patch("watch", { parts: [...s.watch.parts, { videoId: s.watch.parts.at(-1)?.videoId ?? "", start: 0, end: 60, title: "New part", channel: s.watch.parts.at(-1)?.channel ?? "" }] })}>
                            <Plus size={15} /> Add a part
                          </button>
                          {!same(s.watch.parts, defaults.watch.parts) && (
                            <button type="button" className="btn ghost small" onClick={() => patch("watch", { parts: defaults.watch.parts })}>
                              <RotateCcw size={14} /> The pack&apos;s own lesson
                            </button>
                          )}
                        </div>
                      </div>
                    )}

                    {k === "teach" && (
                      <div className="study-fields grid">
                        <p className="note span">When participants may end teaching themselves (&quot;I&apos;ve taught all I can&quot;), whichever comes first. Team sessions can from the start.</p>
                        <Num label="After this many messages" value={s.teach.stopAfterMessages} min={0} max={30} step={1} onChange={(v) => patch("teach", { stopAfterMessages: v })} changed={s.teach.stopAfterMessages !== defaults.teach.stopAfterMessages} />
                        <Num label="Or after this many minutes" value={s.teach.stopAfterMinutes} min={0} max={30} step={0.5} onChange={(v) => patch("teach", { stopAfterMinutes: v })} changed={s.teach.stopAfterMinutes !== defaults.teach.stopAfterMinutes} />
                      </div>
                    )}

                    {on && k === "practice" && (
                      <div className="study-fields grid">
                        <Num label="Minutes for the practice" value={s.practice.minutes} min={2} max={60} step={1} onChange={(v) => patch("practice", { minutes: v })} changed={s.practice.minutes !== defaults.practice.minutes} />
                        <Num label="Tries per problem (the learner's checks; Kai always gets two)" value={s.practice.tries} min={1} max={5} step={1} onChange={(v) => patch("practice", { tries: v })} changed={s.practice.tries !== defaults.practice.tries} />
                      </div>
                    )}
                    {!on && k === "practice" && <p className="study-about warn">Without practice, the two conditions no longer differ: every session gets the same steps.</p>}

                    {k === "exercises" && (
                      <div className="study-fields grid">
                        <Num
                          label={twoForms ? "Follow-up test after this many days (0: none)" : "Follow-up test (needs a second test form)"}
                          value={s.test.followUpDays}
                          min={0}
                          max={60}
                          step={1}
                          disabled={!twoForms && s.test.followUpDays === 0}
                          onChange={(v) => patch("test", { followUpDays: v })}
                          changed={s.test.followUpDays !== defaults.test.followUpDays}
                        />
                        <p className="note">The follow-up takes the other form and needs codes that name one person (a shared code names nobody).</p>
                      </div>
                    )}
                  </div>
                </li>
              );
            })}
          </ol>
        </section>

        <div className="adm-cols">
          <section className="adm-card set-card">
            <h2>Fixed by design</h2>
            <p className="note">Part of the study design: changed in code, with a reason, not mid-study. Counted from the code and the pack.</p>
            <dl className="adm-dl set-fixed">
              {summary.fixed.map(([a, b]) => (
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
                    <span>
                      {h.reset ? "back to the defaults" : h.changed.map((c) => NAMES[c] ?? c).join(", ") || "saved, nothing changed"}
                      {h.times > 1 && <span className="note"> ×{h.times}</span>}
                    </span>
                    {perVersion[h.version] ? <span className="note">{perVersion[h.version]} sessions</span> : null}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="note">No changes yet: the defaults are in force ({defaultVersion}).</p>
            )}
          </section>
        </div>
      </div>

      <aside className="study-side">
        <section className="adm-card">
          <h2>A session</h2>
          <p className="study-total">
            about <b>{summary.total}</b> min
          </p>
          <ol className="study-time">
            {flow.map((k) => (
              <li key={k}>
                <span>{BLOCKS.find((b) => b.key === k)!.name}</span>
                <span className="study-bar">
                  <i className={`tone-${k}`} style={{ width: `${Math.max(4, (summary.minutes[k] / maxMin) * 100)}%` }} />
                </span>
                <b>{summary.minutes[k]}</b>
              </li>
            ))}
          </ol>
          <p className="note">Estimates: the lesson&apos;s length, the practice timer, about a minute per test question, and the usual 8 to 12 minutes of teaching.</p>
        </section>

        <TryIt dirty={dirty} />

        <section className="adm-card set-card">
          <h2>Everywhere</h2>
          <label className="set-field">
            <span>
              Line above the welcome title
              {changed("studyLine") && <i className="set-dot" title="Changed from the default" />}
            </span>
            <input className="input" value={s.studyLine} maxLength={120} onChange={(e) => set("studyLine", e.target.value)} />
          </label>
          <Num label="A session lasts (days, on the device)" value={s.sessionDays} min={1} max={30} step={1} onChange={(v) => set("sessionDays", v)} changed={changed("sessionDays")} />
          <Toggle label="Calculator in the working fields" hint="Typing a sum and = writes the result. Off: the fields stay, without the sums. The same in every condition." value={s.tools.calculator} onChange={(v) => patch("tools", { calculator: v })} changed={s.tools.calculator !== defaults.tools.calculator} />
          <Toggle label="Voice input" hint={demo ? "This server runs in demo mode, so voice is hidden anyway." : "A microphone in the chat and the correction box; about $0.003 a minute of speech."} value={s.tools.voice} onChange={(v) => patch("tools", { voice: v })} changed={s.tools.voice !== defaults.tools.voice} />
          <Num label="Model calls per day, whole site (chat, Kai's solving, voice)" value={s.dailyTurnLimit} min={50} max={50000} step={50} onChange={(v) => set("dailyTurnLimit", v)} changed={changed("dailyTurnLimit")} />
        </section>
      </aside>

      <div className={`set-bar${dirty || msg || problem ? " on" : ""}`} role="region" aria-label="Save the settings">
        <span className="set-bar-text">
          {msg ? (
            <span className={msg.ok ? "ok" : "err"}>{msg.text}</span>
          ) : problem ? (
            <span className="err">{problem}</span>
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
        <button type="button" className="btn primary small" disabled={busy || !dirty || !!problem} onClick={() => void save("save")}>
          {busy ? "Saving…" : "Save"}
        </button>
      </div>
    </div>
  );
}

function Num({ label, value, min, max, step, onChange, changed, disabled }: { label: string; value: number; min: number; max: number; step: number; onChange: (v: number) => void; changed: boolean; disabled?: boolean }) {
  return (
    <label className="set-field">
      <span>
        {label}
        {changed && <i className="set-dot" title="Changed from the default" />}
      </span>
      <input className="input" type="number" min={min} max={max} step={step} value={value} disabled={disabled} onChange={(e) => onChange(Number(e.target.value))} />
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

/**
 * Try the study as a participant would: a one-use trial code in the chosen condition (a participant's session, no
 * shortcuts, counted with the tests), opened on the welcome page in a new tab with the code filled in.
 */
function TryIt({ dirty }: { dirty: boolean }) {
  const [cond, setCond] = useState<"direct" | "recursive">("recursive");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function go() {
    setBusy(true);
    setError(null);
    // the tab opens now (a pop-up opened after the request would be blocked), then goes to the code's link
    const tab = window.open("about:blank", "_blank");
    const day = new Date().toISOString().slice(0, 10);
    const res = await fetch("/api/admin/codes", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "create", count: 1, prefix: "TRY", label: `try-out ${day}`, condition: cond, trial: true, maxUses: 1 }) });
    const d = (await res.json().catch(() => ({}))) as { codes?: { code: string }[]; error?: string };
    setBusy(false);
    const code = d.codes?.[0]?.code;
    if (!res.ok || !code) {
      tab?.close();
      return setError(d.error ?? "Couldn't make a trial code.");
    }
    const url = `${location.origin}/?code=${encodeURIComponent(code)}`;
    if (tab) tab.location.href = url;
    else location.href = url;
  }
  return (
    <section className="adm-card set-card">
      <h2>Try it as a participant</h2>
      <p className="note">
        A one-use trial code: exactly a participant&apos;s session in that condition, counted with the tests. {dirty ? "Save first: it runs the saved setup." : "It runs the saved setup."}
      </p>
      <div className="row">
        <span className="adm-seg">
          {(["direct", "recursive"] as const).map((c) => (
            <button key={c} type="button" aria-current={cond === c ? "page" : undefined} onClick={() => setCond(c)}>
              {c}
            </button>
          ))}
        </span>
        <button type="button" className="btn primary small" disabled={busy} onClick={() => void go()}>
          <ExternalLink size={14} /> {busy ? "Opening…" : "Open"}
        </button>
      </div>
      {error && <p className="error">{error}</p>}
    </section>
  );
}
