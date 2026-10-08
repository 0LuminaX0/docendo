"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { ArrowRight, Check, Lightbulb, Play, Timer } from "lucide-react";
import { Header, Modal, VideoFrame, mmss } from "./ui";
import { track } from "@/lib/client/log";
import { useGuard } from "./useGuard";
import { blankEntry, post, save, useSaved, type PracticeEntry, type PracticeState, type Saved } from "@/lib/client/store";

type Item = { id: string; round: number; title: string; kind: "choice" | "number"; prompt: string; options: string[] | null; unit: string | null };
type Moment = { video: string; videoId: string; start: number; end: number; part: string };
const KEYS = "ABCDEF";

/**
 * Chapter 3, direct feedback: the learner solves the problems one at a time, in
 * two rounds (round 2 repeats round 1's ideas in new settings). Each problem
 * allows a first try and one retry, each answered with a right/wrong light; the
 * worked solutions come after the final test, as in the recursive condition,
 * where the light goes to Kai's answer instead. Time is fixed: when it runs out,
 * the final test starts.
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
      track("practice_leave", {
        why,
        leftMs: left,
        solved: es.filter((e) => e.correct).length,
        firstTry: es.filter((e) => e.firstCorrect).length,
        tried: es.filter((e) => e.checks > 0).length,
        reached: Math.min((p?.current ?? 0) + 1, items.length),
      });
      update((s: Saved) => ({ ...s, step: s.step === "practice" ? "exercises" : s.step }));
      router.push("/exercises");
    },
    [items, left, leaveProblem, router, saved?.practice, update],
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
  const finished = e.correct === true || e.checks >= tries;
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
      <Header phase={3} demo={saved.demo} right={clock} />
      <main className="page narrow">
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <span className="eyebrow">Step 3 of 4</span>
          <h1 className="title" style={{ fontSize: "clamp(26px, 4vw, 36px)" }}>Practice problems</h1>
          <p className="lede" style={{ fontSize: 16 }}>
            Two rounds of three problems, {minutes} minutes in all. Each problem gets a first try and one retry; a light tells you if your answer is right. Nothing here is graded, and the worked solutions come after the final test.
          </p>
        </div>

        <nav className="prog" aria-label="Problems">
          {rounds.map((r) => (
            <div className="prog-round" key={r}>
              <span>Round {r}</span>
              <ol>
                {items.map((x, i) => {
                  if (x.round !== r) return null;
                  const xe = entry(x.id);
                  const st = xe.correct === true ? "ok" : xe.checks >= tries ? "no" : i < index ? "skip" : "";
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
