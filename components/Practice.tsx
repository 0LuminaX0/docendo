"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { ArrowRight, Check, Eye, Lightbulb, Play, Timer } from "lucide-react";
import { Header, Modal, VideoFrame, mmss } from "./ui";
import { track } from "@/lib/client/log";
import { useGuard } from "./useGuard";
import { blankEntry, post, save, useSaved, type PracticeEntry, type PracticeState, type Saved } from "@/lib/client/store";

type Item = { id: string; title: string; kind: "choice" | "number"; prompt: string; options: string[] | null; unit: string | null };
type Moment = { video: string; videoId: string; start: number; end: number; part: string };
const KEYS = "ABCDEF";

/**
 * Chapter 3, the base case ("direct feedback"): the learner solves practice
 * problems, checks an answer as often as they like and can open the worked
 * solution. Nothing is graded. Time is fixed, so every learner spends the same
 * time here whatever they do.
 */
export default function Practice({ items, minutes }: { items: Item[]; minutes: number }) {
  const router = useRouter();
  const [saved, update] = useSaved();
  const allowed = useGuard(saved, "practice");
  const [now, setNow] = useState(() => Date.now());
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirmLeave, setConfirmLeave] = useState(false);
  const [watching, setWatching] = useState<{ id: string; moments: Moment[]; k: number } | null>(null);

  // the clock starts on the first visit and keeps running across reloads
  useEffect(() => {
    if (saved && !saved.practice?.startedAt) update((s) => ({ ...s, practice: { items: {}, ...s.practice, startedAt: Date.now() } }));
  }, [saved, update]);
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  const startedAt = saved?.practice?.startedAt ?? null;
  useTimeUp(!!startedAt && now - startedAt >= minutes * 60_000);

  if (!allowed || !saved) return <div className="center">Loading…</div>;
  const state: PracticeState = saved.practice ?? { startedAt: null, items: {} };
  const entry = (id: string): PracticeEntry => state.items[id] ?? blankEntry();
  const total = minutes * 60_000;
  const left = Math.min(total, Math.max(0, total - (now - (state.startedAt ?? now))));
  const over = left === 0;
  const solved = items.filter((q) => entry(q.id).correct).length;

  const set = (id: string, f: (e: PracticeEntry) => PracticeEntry) =>
    update((s: Saved) => {
      const p = s.practice ?? { startedAt: Date.now(), items: {} };
      return { ...s, practice: { ...p, items: { ...p.items, [id]: f(p.items[id] ?? blankEntry()) } } };
    });

  async function call<T>(body: Record<string, unknown>): Promise<T | null> {
    if (!saved) return null;
    setError(null);
    const r = await post<T>("/api/practice", { token: saved.token, ...body });
    if (r.ok) return r.data;
    if (r.expired) {
      save(null);
      router.replace("/");
    } else setError(r.error);
    return null;
  }

  async function check(q: Item) {
    const e = entry(q.id);
    if (!e.answer.trim() || busy) return;
    setBusy(q.id);
    track("practice_check_click", { id: q.id, answer: e.answer.slice(0, 40), workChars: e.work.length, checksBefore: e.checks });
    const d = await call<{ correct: boolean }>({ action: "check", id: q.id, answer: e.answer, work: e.work || undefined });
    setBusy(null);
    if (d) set(q.id, (x) => ({ ...x, checks: x.checks + 1, correct: d.correct }));
  }

  async function hint(q: Item) {
    if (busy) return;
    setBusy(q.id);
    const d = await call<{ moments: Moment[] }>({ action: "hint", id: q.id });
    setBusy(null);
    if (!d || !d.moments.length) return;
    track("practice_hint_open", { id: q.id, moments: d.moments.map((m) => `${m.video}@${Math.round(m.start)}`) });
    set(q.id, (x) => ({ ...x, hints: (x.hints ?? 0) + 1 }));
    setWatching({ id: q.id, moments: d.moments, k: 0 });
  }

  async function reveal(q: Item) {
    if (busy) return;
    track("practice_solution_click", { id: q.id, checks: entry(q.id).checks, solved: entry(q.id).correct === true });
    setBusy(q.id);
    const d = await call<{ steps: string[]; answer: string }>({ action: "solution", id: q.id });
    setBusy(null);
    if (d) set(q.id, (x) => ({ ...x, solution: d }));
  }

  function goTest() {
    track("practice_leave", { leftMs: left, solved, timeUp: over, checked: items.filter((q) => entry(q.id).checks > 0).length, solutions: items.filter((q) => entry(q.id).solution).length });
    update((s: Saved) => ({ ...s, step: s.step === "practice" ? "exercises" : s.step }));
    router.push("/exercises");
  }

  const clock = (
    <span className={`clock${left < 60_000 ? " low" : ""}${over ? " over" : ""}`} title="Time left for practice" role="timer" aria-live="off">
      <Timer size={15} strokeWidth={2.4} />
      {over ? "Time's up" : mmssMs(left)}
    </span>
  );

  return (
    <div className="shell">
      <Header phase={3} demo={saved.demo} right={clock} />
      <main className="page narrow">
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <span className="eyebrow">Step 3 of 4</span>
          <h1 className="title" style={{ fontSize: "clamp(26px, 4vw, 36px)" }}>Practice problems</h1>
          <p className="lede" style={{ fontSize: 16 }}>
            You have {minutes} minutes. Work through as many problems as you like: check your answer as often as you want, or open the worked solution. Nothing here is graded.
          </p>
        </div>

        <ol className="quiz practice">
          {items.map((q, i) => {
            const e = entry(q.id);
            const lit = e.correct === true ? "on" : e.correct === false ? "off" : "";
            return (
              <li className="q" key={q.id}>
                <div className="qt">
                  <span className="ptitle">{q.title}</span>
                  <p id={`${q.id}-q`}>{q.prompt}</p>
                </div>
                <div className="pwork">
                  <label className="sr-only" htmlFor={`${q.id}-work`}>Your working for problem {i + 1}</label>
                  <textarea
                    id={`${q.id}-work`}
                    className="work"
                    rows={2}
                    maxLength={4000}
                    placeholder="Your working (optional)"
                    value={e.work}
                    disabled={over}
                    onChange={(ev) => set(q.id, (x) => ({ ...x, work: ev.target.value }))}
                    onBlur={(ev) => ev.target.value && track("practice_work", { id: q.id, chars: ev.target.value.length, text: ev.target.value.slice(0, 2000) })}
                  />
                  {q.kind === "choice" && q.options ? (
                    <fieldset className="opts" aria-labelledby={`${q.id}-q`} disabled={over}>
                      {q.options.map((o, k) => (
                        <label className="opt" key={k}>
                          <input type="radio" name={q.id} checked={e.answer === String(k)} onChange={() => (set(q.id, (x) => ({ ...x, answer: String(k), correct: null })), track("practice_option", { id: q.id, k }))} />
                          <span className="key" aria-hidden="true">{KEYS[k]}</span>
                          <span>{o}</span>
                        </label>
                      ))}
                    </fieldset>
                  ) : (
                    <label className="pans">
                      <span>Answer</span>
                      <input
                        className="input"
                        inputMode="decimal"
                        autoComplete="off"
                        maxLength={40}
                        value={e.answer}
                        disabled={over}
                        onChange={(ev) => set(q.id, (x) => ({ ...x, answer: ev.target.value, correct: null }))}
                        onBlur={(ev) => ev.target.value && track("practice_answer_typed", { id: q.id, answer: ev.target.value.slice(0, 40) })}
                        onKeyDown={(ev) => ev.key === "Enter" && void check(q)}
                      />
                      {q.unit && <span className="unit">{q.unit}</span>}
                    </label>
                  )}
                  <div className="pact">
                    <button className="btn small" onClick={() => void check(q)} disabled={over || busy === q.id || !e.answer.trim()}>
                      <Check size={15} strokeWidth={2.6} /> Check
                    </button>
                    <span className={`bulb ${lit}`} role="status" aria-live="polite">
                      <Lightbulb size={18} strokeWidth={2.2} />
                      {e.correct === true ? "Correct" : e.correct === false ? "Not quite, try again" : e.checks ? "" : "Not checked yet"}
                    </span>
                    <span className="grow" />
                    {!e.solution && (
                      <>
                        <button className="btn ghost small" onClick={() => void hint(q)} disabled={busy === q.id} title="Replay the part of the lesson that explains this (no answer)">
                          <Play size={13} fill="currentColor" strokeWidth={0} /> Rewatch
                        </button>
                        <button className="btn ghost small" onClick={() => void reveal(q)} disabled={busy === q.id}>
                          <Eye size={15} /> Show solution
                        </button>
                      </>
                    )}
                  </div>
                  {e.solution && (
                    <div className="explain solution">
                      <ol>
                        {e.solution.steps.map((s, k) => (
                          <li key={k}>{s}</li>
                        ))}
                      </ol>
                      <p>
                        <b>Answer:</b> {e.solution.answer}
                      </p>
                    </div>
                  )}
                </div>
              </li>
            );
          })}
        </ol>

        <div className="submitbar">
          {confirmLeave && !over ? (
            <>
              <span className="note">You still have {mmssMs(left)}. Go to the final test anyway?</span>
              <button className="btn primary small" onClick={goTest}>
                Go to the test <ArrowRight size={15} />
              </button>
              <button className="btn ghost small" onClick={() => (setConfirmLeave(false), track("practice_leave_cancel", { leftMs: left }))}>Keep practising</button>
            </>
          ) : (
            <>
              <button className="btn primary" onClick={() => (over ? goTest() : (setConfirmLeave(true), track("practice_leave_open", { leftMs: left, solved })))}>
                {over ? "Time's up: go to the final test" : "Go to the final test"} <ArrowRight size={17} />
              </button>
              <span className="answered">
                <span className="track" aria-hidden="true"><span className="fill" style={{ width: `${(solved / items.length) * 100}%` }} /></span>
                {solved} of {items.length} solved
              </span>
            </>
          )}
          {error && <p className="error" role="alert">{error}</p>}
        </div>
      </main>
      {watching && (
        <Modal title={watching.moments[watching.k]!.part || "From the lesson"} onClose={() => (track("practice_hint_close", { id: watching.id }), setWatching(null))}>
          <VideoFrame key={watching.k} videoId={watching.moments[watching.k]!.videoId} title="From the lesson" start={watching.moments[watching.k]!.start} end={watching.moments[watching.k]!.end} autoplay />
          {watching.moments.length > 1 && (
            <div className="row">
              {watching.moments.map((m, k) => (
                <button key={k} className={`btn small${k === watching.k ? "" : " ghost"}`} onClick={() => setWatching({ ...watching, k })}>
                  <Play size={12} fill="currentColor" strokeWidth={0} /> {mmss(m.start)}
                </button>
              ))}
            </div>
          )}
        </Modal>
      )}
    </div>
  );
}

/** Log the moment the practice time runs out, once. */
function useTimeUp(over: boolean) {
  const [logged, setLogged] = useState(false);
  useEffect(() => {
    if (over && !logged) {
      setLogged(true);
      track("practice_time_up");
    }
  }, [over, logged]);
}

const mmssMs = (ms: number) => {
  const s = Math.ceil(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
};
