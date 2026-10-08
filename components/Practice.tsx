"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { ArrowRight, Check, Lightbulb, Play, Timer } from "lucide-react";
import { Header, Modal, VideoFrame, mmss } from "./ui";
import KaiSolve from "./KaiSolve";
import { track } from "@/lib/client/log";
import { useGuard } from "./useGuard";
import { blankEntry, post, save, useSaved, type Condition, type KaiAttempt, type KaiEntry, type PracticeEntry, type PracticeState, type Saved } from "@/lib/client/store";
import type { State } from "@/engine/tutor/state";

type Item = { id: string; round: number; title: string; kind: "choice" | "number"; prompt: string; options: string[] | null; unit: string | null };
type Moment = { video: string; videoId: string; start: number; end: number; part: string };
const KEYS = "ABCDEF";

/**
 * Chapter 3, one problem at a time, in two rounds (round 2 repeats round 1's
 * ideas in new settings). Direct feedback: the learner solves each problem, a
 * first try and one retry, each answered with a right/wrong light. Recursive
 * feedback (KaiSolve): Kai solves it from its notebook and gets the light; after
 * a wrong answer the learner finds the faulty step and reteaches once, and Kai
 * tries again. Same problems, time and number of tries. Worked solutions come
 * after the final test in both. When the time runs out, the test starts.
 */
export default function Practice({ items, minutes, tries }: { items: Item[]; minutes: number; tries: number }) {
  const router = useRouter();
  const [saved, update] = useSaved();
  const allowed = useGuard(saved, "practice");
  const [now, setNow] = useState(() => Date.now());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [watching, setWatching] = useState<{ id: string; moments: Moment[]; k: number } | null>(null);
  const shownAt = useRef<{ id: string; at: number } | null>(null);

  // the clock starts on the first visit and keeps running across reloads
  useEffect(() => {
    if (saved && !saved.practice?.startedAt) update((s) => ({ ...s, practice: { items: {}, ...s.practice, startedAt: Date.now() } }));
  }, [saved, update]);
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  const state: PracticeState = saved?.practice ?? { startedAt: null, items: {} };
  // participants practise in their own condition; team sessions can switch to look at both
  const team = saved?.team !== false;
  const mode: Condition = team ? (state.view ?? saved?.condition ?? "direct") : (saved?.condition ?? "direct");
  const index = Math.min(state.current ?? 0, items.length - 1);
  const q = items[index]!;
  const total = minutes * 60_000;
  const left = Math.min(total, Math.max(0, total - (now - (state.startedAt ?? now))));
  const over = !!state.startedAt && left === 0;

  // time on each problem: from when it is shown until the learner moves on (or the time runs out)
  const leaveProblem = useCallback(
    (why: string) => {
      const s = shownAt.current;
      if (!s) return;
      shownAt.current = null;
      const ms = Date.now() - s.at;
      update((x: Saved) => {
        const p = x.practice ?? { startedAt: Date.now(), items: {} };
        const e = p.items[s.id] ?? blankEntry();
        return { ...x, practice: { ...p, items: { ...p.items, [s.id]: { ...e, ms: (e.ms ?? 0) + ms } } } };
      });
      track("practice_problem_leave", { id: s.id, ms, why });
    },
    [update],
  );
  useEffect(() => {
    if (!allowed || !saved || over) return;
    if (shownAt.current?.id === q.id) return;
    shownAt.current = { id: q.id, at: Date.now() };
    track("practice_problem_show", { id: q.id, index, round: q.round, leftMs: left });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [allowed, !!saved, q.id, over]);
  useEffect(() => {
    const away = () => document.visibilityState === "hidden" && shownAt.current && track("practice_problem_hidden", { id: shownAt.current.id });
    document.addEventListener("visibilitychange", away);
    return () => document.removeEventListener("visibilitychange", away);
  }, []);

  const goTest = useCallback(
    (why: "done" | "time_up" | "early") => {
      leaveProblem(why);
      const p = saved?.practice;
      const es = items.map((x) => p?.items[x.id] ?? blankEntry());
      const ks = items.map((x) => p?.kai?.[x.id]?.attempts ?? []);
      track("practice_leave", {
        why,
        mode,
        kaiFirstTry: ks.filter((a) => a[0]?.correct).length,
        kaiOnRetry: ks.filter((a) => !a[0]?.correct && a[1]?.correct).length,
        leftMs: left,
        solved: es.filter((e) => e.correct).length,
        firstTry: es.filter((e) => e.firstCorrect).length,
        tried: es.filter((e) => e.checks > 0).length,
        reached: Math.min((p?.current ?? 0) + 1, items.length),
      });
      update((s: Saved) => ({ ...s, step: s.step === "practice" ? "exercises" : s.step }));
      router.push("/exercises");
    },
    [items, left, leaveProblem, router, saved?.practice, update, mode],
  );

  // time's up: straight on to the test
  const moved = useRef(false);
  useEffect(() => {
    if (over && allowed && !moved.current) {
      moved.current = true;
      track("practice_time_up", { index });
      goTest("time_up");
    }
  }, [over, allowed, goTest, index]);

  if (!allowed || !saved) return <div className="center">Loading…</div>;
  const entry = (id: string): PracticeEntry => state.items[id] ?? blankEntry();
  const e = entry(q.id);
  const kaiOf = (id: string): KaiEntry => state.kai?.[id] ?? { attempts: [], clicks: [], correction: null };
  const ke = kaiOf(q.id);
  const kaiDone = (k: KaiEntry) => k.attempts.some((a) => a.correct) || k.attempts.length >= 2;
  const finished = mode === "recursive" ? kaiDone(ke) : e.correct === true || e.checks >= tries;
  const last = index === items.length - 1;
  const inRound = items.filter((x) => x.round === q.round);
  const rounds = [...new Set(items.map((x) => x.round))];

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

  async function check() {
    if (!e.answer.trim() || busy || finished || over) return;
    setBusy(true);
    const attempt = e.checks + 1;
    const ms = shownAt.current ? Date.now() - shownAt.current.at : null;
    track("practice_check_click", { id: q.id, attempt, answer: e.answer.slice(0, 40), workChars: e.work.length, msOnProblem: ms });
    const d = await call<{ correct: boolean }>({ action: "check", id: q.id, answer: e.answer, attempt, work: e.work || undefined, msOnProblem: ms ?? undefined });
    setBusy(false);
    if (d) set(q.id, (x) => ({ ...x, checks: x.checks + 1, correct: d.correct, ...(x.checks === 0 ? { firstCorrect: d.correct } : {}) }));
  }

  const setKai = (id: string, f: (k: KaiEntry) => KaiEntry) =>
    update((s: Saved) => {
      const p = s.practice ?? { startedAt: Date.now(), items: {} };
      return { ...s, practice: { ...p, kai: { ...p.kai, [id]: f(p.kai?.[id] ?? { attempts: [], clicks: [], correction: null }) } } };
    });

  async function solveKai() {
    if (busy || over || !saved?.chat.state) return;
    setBusy(true);
    const ms = shownAt.current ? Date.now() - shownAt.current.at : undefined;
    track("practice_kai_solve_click", { id: q.id, msOnProblem: ms ?? null });
    const d = await call<{ solution: KaiAttempt }>({ action: "solve", id: q.id, state: saved.chat.state, msOnProblem: ms });
    setBusy(false);
    if (d) setKai(q.id, (k) => ({ ...k, attempts: [d.solution] }));
  }

  function clickStep(i: number) {
    track("practice_kai_step_click", { id: q.id, step: i, nClicks: ke.clicks.length + 1 });
    setKai(q.id, (k) => ({ ...k, clicks: [...k.clicks, i] }));
  }

  async function reteach(message: string) {
    if (busy || over || !saved?.chat.state) return;
    const first = ke.attempts[0];
    const clicked = ke.clicks.at(-1);
    if (!first || clicked === undefined) return;
    setBusy(true);
    const ms = shownAt.current ? Date.now() - shownAt.current.at : undefined;
    track("practice_kai_reteach_send", { id: q.id, chars: message.length, step: clicked });
    setKai(q.id, (k) => ({ ...k, correction: message }));
    const d = await call<{ solution: KaiAttempt; state: State }>({ action: "reteach", id: q.id, state: saved.chat.state, message, step: first.steps[clicked]?.text ?? "", clicks: ke.clicks, msOnProblem: ms });
    setBusy(false);
    if (!d) return setKai(q.id, (k) => ({ ...k, correction: null }));
    // Kai's notebook now holds the correction too, for the problems that follow
    update((s: Saved) => ({ ...s, chat: { ...s.chat, state: d.state } }));
    setKai(q.id, (k) => ({ ...k, attempts: [...k.attempts, d.solution] }));
  }

  function switchView(to: Condition) {
    if (to === mode) return;
    track("practice_view_toggle", { to });
    update((s: Saved) => ({ ...s, practice: { ...(s.practice ?? { startedAt: Date.now(), items: {} }), view: to } }));
  }

  async function hint() {
    if (busy) return;
    setBusy(true);
    const d = await call<{ moments: Moment[] }>({ action: "hint", id: q.id });
    setBusy(false);
    if (!d || !d.moments.length) return;
    track("practice_hint_open", { id: q.id, moments: d.moments.map((m) => `${m.video}@${Math.round(m.start)}`) });
    set(q.id, (x) => ({ ...x, hints: (x.hints ?? 0) + 1 }));
    setWatching({ id: q.id, moments: d.moments, k: 0 });
  }

  function next() {
    if (last) return goTest("done");
    leaveProblem(finished ? "next" : "skip");
    if (!finished) track("practice_skip", { id: q.id, checks: e.checks });
    update((s: Saved) => {
      const p = s.practice ?? { startedAt: Date.now(), items: {} };
      return { ...s, practice: { ...p, current: index + 1 } };
    });
    window.scrollTo({ top: 0 });
  }

  const lit = e.correct === true ? "on" : e.correct === false ? "off" : "";
  const more = tries - e.checks === 1 ? "One more try" : `${tries - e.checks} more tries`;
  const status =
    e.correct === true
      ? e.checks === 1 ? "Correct" : "Correct on the second try"
      : finished
        ? "Not quite. You'll see the worked solution after the final test."
        : e.correct === false
          ? `Not quite. ${more}.`
          : e.checks
            ? `${more}.`
            : `You have ${tries} tries.`;

  const clock = (
    <span className={`clock${left < 60_000 ? " low" : ""}${over ? " over" : ""}`} title="Time left for practice" role="timer" aria-live="off">
      <Timer size={15} strokeWidth={2.4} />
      {over ? "Time's up" : mmssMs(left)}
    </span>
  );

  return (
    <div className="shell">
      <Header
        phase={3}
        demo={saved.demo}
        right={clock}
        left={
          team ? (
            <div className="seg" role="group" aria-label="Condition to view (team sessions only)">
              <button type="button" aria-pressed={mode === "direct"} onClick={() => switchView("direct")} title="Direct feedback: you solve the problems">
                <span className="lbl">You solve</span>
              </button>
              <button type="button" aria-pressed={mode === "recursive"} onClick={() => switchView("recursive")} title="Recursive feedback: Kai solves the problems from what you taught it">
                <span className="lbl">Kai solves</span>
              </button>
            </div>
          ) : undefined
        }
      />
      <main className="page narrow">
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <span className="eyebrow">Step 3 of 4</span>
          <h1 className="title" style={{ fontSize: "clamp(26px, 4vw, 36px)" }}>Practice problems</h1>
          {mode === "recursive" ? (
            <p className="lede" style={{ fontSize: 16 }}>
              Now Kai tries two rounds of three problems, using only what you taught it, and a light shows whether its answer is right. If Kai gets one wrong, find the step where it went wrong and correct Kai once; then it tries again. {minutes} minutes in all. The worked solutions come after the final test.
            </p>
          ) : (
            <p className="lede" style={{ fontSize: 16 }}>
              Two rounds of three problems, {minutes} minutes in all. Each problem gets a first try and one retry; a light tells you if your answer is right. Nothing here is graded, and the worked solutions come after the final test.
            </p>
          )}
        </div>

        <nav className="prog" aria-label="Problems">
          {rounds.map((r) => (
            <div className="prog-round" key={r}>
              <span>Round {r}</span>
              <ol>
                {items.map((x, i) => {
                  if (x.round !== r) return null;
                  const xe = entry(x.id);
                  const xk = kaiOf(x.id);
                  const st =
                    mode === "recursive"
                      ? xk.attempts.some((a) => a.correct) ? "ok" : xk.attempts.length >= 2 ? "no" : i < index ? "skip" : ""
                      : xe.correct === true ? "ok" : xe.checks >= tries ? "no" : i < index ? "skip" : "";
                  return (
                    <li key={x.id} className={`${st}${i === index ? " now" : ""}`} aria-current={i === index ? "step" : undefined}>
                      <span className="sr-only">
                        Problem {i + 1}
                        {st === "ok" ? ", correct" : st === "no" ? ", not solved" : st === "skip" ? ", skipped" : ""}
                      </span>
                    </li>
                  );
                })}
              </ol>
            </div>
          ))}
        </nav>

        {mode === "recursive" ? (
          <>
            <KaiSolve
              key={q.id}
              q={q}
              entry={ke}
              busy={busy}
              disabled={over || !saved.chat.state}
              head={
                <span className="ptitle">
                  Round {q.round}, problem {inRound.indexOf(q) + 1} of {inRound.length}: {q.title}
                </span>
              }
              onSolve={() => void solveKai()}
              onClick={clickStep}
              onReteach={(m) => void reteach(m)}
            />
            <div className="pact">
              <span className="grow" />
              <button className="btn ghost small" onClick={() => void hint()} disabled={busy} title="Replay the part of the lesson that explains this (no answer)">
                <Play size={13} fill="currentColor" strokeWidth={0} /> Rewatch
              </button>
            </div>
          </>
        ) : (
          <section className="pq" key={q.id} aria-labelledby={`${q.id}-q`}>
            <div className="qt">
              <span className="ptitle">
                Round {q.round}, problem {inRound.indexOf(q) + 1} of {inRound.length}: {q.title}
              </span>
              <p id={`${q.id}-q`}>{q.prompt}</p>
            </div>
            <div className="pwork">
              <label className="sr-only" htmlFor={`${q.id}-work`}>Your working</label>
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
                <fieldset className="opts" aria-labelledby={`${q.id}-q`} disabled={over || finished}>
                  {q.options.map((o, k) => (
                    <label className="opt" key={k}>
                      <input type="radio" name={q.id} checked={e.answer === String(k)} onChange={() => (set(q.id, (x) => ({ ...x, answer: String(k), correct: x.correct === true ? true : null })), track("practice_option", { id: q.id, k }))} />
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
                    disabled={over || finished}
                    onChange={(ev) => set(q.id, (x) => ({ ...x, answer: ev.target.value, correct: null }))}
                    onBlur={(ev) => ev.target.value && track("practice_answer_typed", { id: q.id, answer: ev.target.value.slice(0, 40) })}
                    onKeyDown={(ev) => ev.key === "Enter" && void check()}
                  />
                  {q.unit && <span className="unit">{q.unit}</span>}
                </label>
              )}
              <div className="pact">
                {!finished && (
                  <button className="btn small" onClick={() => void check()} disabled={over || busy || !e.answer.trim()}>
                    <Check size={15} strokeWidth={2.6} /> {e.checks ? "Check again" : "Check"}
                  </button>
                )}
                <span className={`bulb ${lit}`} role="status" aria-live="polite">
                  <Lightbulb size={18} strokeWidth={2.2} />
                  {status}
                </span>
                <span className="grow" />
                <button className="btn ghost small" onClick={() => void hint()} disabled={busy} title="Replay the part of the lesson that explains this (no answer)">
                  <Play size={13} fill="currentColor" strokeWidth={0} /> Rewatch
                </button>
              </div>
            </div>
          </section>
        )}

        <div className="submitbar">
          <button className={`btn${finished ? " primary" : ""}`} onClick={next}>
            {last ? "Go to the final test" : finished ? "Next problem" : "Skip this problem"} <ArrowRight size={17} />
          </button>
          <span className="answered">
            Problem {index + 1} of {items.length}
          </span>
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

const mmssMs = (ms: number) => {
  const s = Math.ceil(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
};
