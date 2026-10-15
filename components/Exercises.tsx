"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { Check } from "lucide-react";
import Scratchpad from "./Scratchpad";
import { Header } from "./ui";
import { useGuard } from "./useGuard";
import { post, save, useSaved, type GradeResult } from "@/lib/client/store";
import { track } from "@/lib/client/log";
import { seedOf, testOrder } from "@/lib/order";

export type TestItem = { id: string; section: string; kind: "choice" | "number"; prompt: string; options: string[] | null; unit: string | null };
const KEYS = "ABCDEF";

/**
 * The final test, laid out like a practice problem: the question, a working
 * field under it (the same one as in practice, with the calculator built in),
 * then the options or a box for a number. Graded on the server.
 *
 * Two parts, the choice items first and then the number items, each in an
 * order of the learner's own (lib/order.ts), kept in the session and logged.
 *
 * The questions come from the server for this session's form (A or B): the
 * final test takes one, the delayed test (a session of its own, days later)
 * the other, which also asks first whether the learner has studied it since.
 */
const SINCE = [
  ["no", "No"],
  ["a little", "A little (for example a quick look at my notes)"],
  ["a lot", "Yes, quite a bit (videos, reading, a course)"],
] as const;

export default function Exercises() {
  const router = useRouter();
  const [saved, update] = useSaved();
  const allowed = useGuard(saved, "exercises");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const items = useTestItems(allowed, setError);
  // this learner's order, fixed the first time the test opens
  const order = items && saved?.testOrder?.length === items.length ? saved.testOrder : null;
  useEffect(() => {
    if (!allowed || !saved || !items || order) return;
    const o = testOrder(items, seedOf(saved.token));
    update((s) => ({ ...s, testOrder: o }));
    track("test_order", { order: o });
  }, [allowed, saved, order, items, update]);
  if (!allowed || !saved || !items || !order) return <div className="center">{error ?? "Loading…"}</div>;
  const delayed = saved.phase === "delayed";

  const answers = items.map((_, i) => saved.answers[i] ?? null);
  const isAnswered = (a: number | string | null) => a !== null && !(typeof a === "string" && !a.trim());
  const answered = answers.filter(isAnswered).length + (delayed && saved.since ? 1 : 0);
  const total = items.length + (delayed ? 1 : 0);
  const setAnswer = (i: number, a: number | string) =>
    update((s) => {
      const next = items.map((_, j) => s.answers[j] ?? null);
      next[i] = a;
      return { ...s, answers: next };
    });
  const choose = (i: number, k: number) => {
    track("test_option", { q: items[i]!.id, k, changed: saved.answers[i] != null && saved.answers[i] !== k });
    setAnswer(i, k);
  };
  const setWork = (id: string, v: string) => update((s) => ({ ...s, testWork: { ...s.testWork, [id]: v } }));

  async function submit() {
    if (!saved) return;
    setBusy(true);
    setError(null);
    track("test_submit", { answered });
    const work = Object.fromEntries(Object.entries(saved.testWork ?? {}).filter(([, v]) => v.trim()).map(([k, v]) => [k, v.slice(0, 2000)]));
    const r = await post<GradeResult>("/api/grade", { token: saved.token, answers: answers.map((a) => (typeof a === "string" ? a.trim().slice(0, 40) || null : a)), work, order, ...(delayed ? { since: saved.since } : {}) });
    setBusy(false);
    if (!r.ok) {
      if (r.expired) {
        save(null);
        router.replace("/");
        return;
      }
      return setError(r.error);
    }
    update((s) => ({ ...s, result: r.data, step: "results", finishedAt: Date.now() }));
    router.push("/results");
  }

  return (
    <div className="shell">
      <Header phase={4} demo={saved.demo} label={delayed ? "Follow-up test" : undefined} />
      <main className="page narrow">
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <h1 className="title" style={{ fontSize: "clamp(24px, 3vw, 30px)" }}>{delayed ? "Follow-up test" : "Final test"}</h1>
          <p className="lede" style={{ fontSize: 15.5 }}>
            {delayed
              ? "Welcome back. Ten new questions on the same ideas as last time, in the same two parts: first pick an option, then work out a number. To calculate, end a calculation with =. You'll see the explanations afterwards."
              : "Ten questions in two parts: first pick an option, then work out a number. Work things out under each question if it helps; to calculate, end a calculation with =. You'll see the explanations afterwards."}
          </p>
        </div>
        {delayed && (
          <fieldset className="opts since" aria-labelledby="since-q">
            <p className="qt" id="since-q">
              First: since your session, have you looked at multi-armed bandits again (videos, notes, reading, a course)?
            </p>
            {SINCE.map(([v, text]) => (
              <label className="opt" key={v}>
                <input type="radio" name="since" checked={saved.since === v} onChange={() => (update((s) => ({ ...s, since: v })), track("test_since", { since: v }))} />
                <span>{text}</span>
              </label>
            ))}
          </fieldset>
        )}
        <div className="quiz">
          {parts(items, order).map(({ title, start, list }) => (
            <section key={title} style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              <h2 className="quiz-section">{title}</h2>
              <ol start={start + 1}>
                {list.map(({ q, i }, j) => {
                  const a = answers[i];
                  return (
                    <li className="q" key={q.id} data-q={q.id}>
                      <p className="qt" id={`${q.id}-q`}>{q.prompt}</p>
                      <div className="qwork">
                        <Scratchpad
                          id={`${q.id}-work`}
                          where={`test:${q.id}`}
                          label={`Your working for question ${start + j + 1}`}
                          value={saved.testWork?.[q.id] ?? ""}
                          onChange={(v) => setWork(q.id, v)}
                          rows={2}
                          placeholder="Work it out here if it helps"
                          onUse={q.kind === "number" ? (v) => setAnswer(i, String(Math.round(v * 1000) / 1000)) : undefined}
                        />
                      </div>
                      {q.kind === "choice" && q.options ? (
                        <fieldset className="opts" aria-labelledby={`${q.id}-q`}>
                          {q.options.map((o, k) => (
                            <label className="opt" key={k}>
                              <input type="radio" name={q.id} checked={a === k} onChange={() => choose(i, k)} />
                              <span className="key" aria-hidden="true">{KEYS[k]}</span>
                              <span>{o}</span>
                            </label>
                          ))}
                        </fieldset>
                      ) : (
                        <label className="pans qans">
                          <span>Answer</span>
                          <input
                            className="input"
                            inputMode="decimal"
                            autoComplete="off"
                            maxLength={40}
                            value={typeof a === "string" ? a : ""}
                            onChange={(e) => setAnswer(i, e.target.value)}
                            onBlur={(e) => e.target.value && track("test_number", { q: q.id, answer: e.target.value.slice(0, 40) })}
                          />
                          {q.unit && <span className="unit">{q.unit}</span>}
                        </label>
                      )}
                    </li>
                  );
                })}
              </ol>
            </section>
          ))}
        </div>
        <div className="submitbar">
          <button className="btn primary" onClick={() => void submit()} disabled={busy || answered < total}>
            {busy ? "Checking…" : <><Check size={17} strokeWidth={2.6} /> Check my answers</>}
          </button>
          <span className="answered">
            <span className="track" aria-hidden="true"><span className="fill" style={{ width: `${(answered / total) * 100}%` }} /></span>
            {answered} of {total} answered
          </span>
          {error && <p className="error" role="alert">{error}</p>}
        </div>
      </main>
    </div>
  );
}

/** This session's questions (its form), fetched once from the server and kept in the session. */
export function useTestItems(allowed: boolean, onError: (e: string) => void): TestItem[] | null {
  const router = useRouter();
  const [saved, update] = useSaved();
  useEffect(() => {
    if (!allowed || !saved || saved.testItems) return;
    void post<{ items: TestItem[] }>("/api/grade", { token: saved.token, kind: "items" }).then((r) => {
      if (r.ok) update((s) => ({ ...s, testItems: r.data.items }));
      else if (r.expired) (save(null), router.replace("/"));
      else onError(r.error);
    });
  }, [allowed, saved, update, router, onError]);
  return saved?.testItems ?? null;
}

/**
 * The test in the learner's order, as two parts. Each entry keeps the item's index in the file (`i`), which is
 * where its answer lives and how the server grades it. Without an order (older sessions): file order.
 */
export function parts<T extends { id: string; kind: string }>(items: T[], order: string[] | null | undefined) {
  const at = new Map(items.map((q, i) => [q.id, i]));
  const seq = (order?.length === items.length ? order : items.map((q) => q.id)).map((id) => ({ q: items[at.get(id)!]!, i: at.get(id)! }));
  const choose = seq.filter((x) => x.q.kind !== "number");
  const work = seq.filter((x) => x.q.kind === "number");
  return [
    { title: "Part 1: choose an answer", start: 0, list: choose },
    { title: "Part 2: work out a number", start: choose.length, list: work },
  ].filter((p) => p.list.length);
}
