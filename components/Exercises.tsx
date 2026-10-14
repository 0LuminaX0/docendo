"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Check } from "lucide-react";
import Scratchpad from "./Scratchpad";
import { Header } from "./ui";
import { useGuard } from "./useGuard";
import { post, save, useSaved, type GradeResult } from "@/lib/client/store";
import { track } from "@/lib/client/log";

export type TestItem = { id: string; section: string; kind: "choice" | "number"; prompt: string; options: string[] | null; unit: string | null };
const KEYS = "ABCDEF";

/**
 * The final test, laid out like a practice problem: the question, a working
 * field under it (the same one as in practice, with the calculator built in),
 * then the options or a box for a number. Graded on the server.
 */
export default function Exercises({ items }: { items: TestItem[] }) {
  const router = useRouter();
  const [saved, update] = useSaved();
  const allowed = useGuard(saved, "exercises");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (!allowed || !saved) return <div className="center">Loading…</div>;

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
    const r = await post<GradeResult>("/api/grade", { token: saved.token, answers: answers.map((a) => (typeof a === "string" ? a.trim().slice(0, 40) || null : a)), work });
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
            Ten questions: pick an option, or type a number. Work things out under each question if it helps; to calculate, end a calculation with =. You&apos;ll see the explanations afterwards.
          </p>
        </div>
        <div className="quiz">
          {sections(items).map(({ title, start, list }) => (
            <section key={title} style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              <h2 className="quiz-section">{title}</h2>
              <ol start={start + 1}>
                {list.map((q, j) => {
                  const i = start + j;
                  const a = answers[i];
                  return (
                    <li className="q" key={q.id}>
                      <p className="qt" id={`${q.id}-q`}>{q.prompt}</p>
                      <div className="qwork">
                        <Scratchpad
                          id={`${q.id}-work`}
                          where={`test:${q.id}`}
                          label={`Your working for question ${i + 1}`}
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

/** Consecutive questions with the same section form one group, in file order. */
export function sections<T extends { section: string }>(items: T[]) {
  const out: { title: string; start: number; list: T[] }[] = [];
  items.forEach((q, i) => {
    const last = out[out.length - 1];
    if (last && last.title === q.section) last.list.push(q);
    else out.push({ title: q.section, start: i, list: [q] });
  });
  return out;
}
