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
 */
export default function Exercises({ items }: { items: TestItem[] }) {
  const router = useRouter();
  const [saved, update] = useSaved();
  const allowed = useGuard(saved, "exercises");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // this learner's order, fixed the first time the test opens
  const order = saved?.testOrder?.length === items.length ? saved.testOrder : null;
  useEffect(() => {
    if (!allowed || !saved || order) return;
    const o = testOrder(items, seedOf(saved.token));
    update((s) => ({ ...s, testOrder: o }));
    track("test_order", { order: o });
  }, [allowed, saved, order, items, update]);
  if (!allowed || !saved || !order) return <div className="center">Loading…</div>;

  const answers = items.map((_, i) => saved.answers[i] ?? null);
  const isAnswered = (a: number | string | null) => a !== null && !(typeof a === "string" && !a.trim());
  const answered = answers.filter(isAnswered).length;
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
    const r = await post<GradeResult>("/api/grade", { token: saved.token, answers: answers.map((a) => (typeof a === "string" ? a.trim().slice(0, 40) || null : a)), work, order });
    setBusy(false);
    if (!r.ok) {
      if (r.expired) {
        save(null);
        router.replace("/");
        return;
      }
      return setError(r.error);
    }
    update((s) => ({ ...s, result: r.data, step: "results" }));
    router.push("/results");
  }

  return (
    <div className="shell">
      <Header phase={4} demo={saved.demo} />
      <main className="page narrow">
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <h1 className="title" style={{ fontSize: "clamp(24px, 3vw, 30px)" }}>Final test</h1>
          <p className="lede" style={{ fontSize: 15.5 }}>
            Ten questions in two parts: first pick an option, then work out a number. Work things out under each question if it helps; to calculate, end a calculation with =. You&apos;ll see the explanations afterwards.
          </p>
        </div>
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
          <button className="btn primary" onClick={() => void submit()} disabled={busy || answered < items.length}>
            {busy ? "Checking…" : <><Check size={17} strokeWidth={2.6} /> Check my answers</>}
          </button>
          <span className="answered">
            <span className="track" aria-hidden="true"><span className="fill" style={{ width: `${(answered / items.length) * 100}%` }} /></span>
            {answered} of {items.length} answered
          </span>
          {error && <p className="error" role="alert">{error}</p>}
        </div>
      </main>
    </div>
  );
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
