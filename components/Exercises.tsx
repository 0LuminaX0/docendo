"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Check } from "lucide-react";
import { Header } from "./ui";
import { useGuard } from "./useGuard";
import { post, save, useSaved, type GradeResult } from "@/lib/client/store";

type Item = { id: string; section: string; prompt: string; options: string[] };
const KEYS = "ABCDEF";

export default function Exercises({ items }: { items: Item[] }) {
  const router = useRouter();
  const [saved, update] = useSaved();
  const allowed = useGuard(saved, "exercises");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (!allowed || !saved) return <div className="center">Loading…</div>;

  const answers = items.map((_, i) => saved.answers[i] ?? null);
  const answered = answers.filter((a) => a !== null).length;
  const choose = (i: number, k: number) =>
    update((s) => {
      const a = items.map((_, j) => s.answers[j] ?? null);
      a[i] = k;
      return { ...s, answers: a };
    });

  async function submit() {
    if (!saved) return;
    setBusy(true);
    setError(null);
    const r = await post<GradeResult>("/api/grade", { token: saved.token, answers });
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
      <Header phase={3} demo={saved.demo} />
      <main className="page narrow">
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <span className="eyebrow">Step 3 · Exercises</span>
          <h1 className="title" style={{ fontSize: "clamp(26px, 4vw, 36px)" }}>Ten questions on what you taught</h1>
          <p className="lede" style={{ fontSize: 16 }}>No calculator needed. Pick one answer per question; you&apos;ll see the explanations afterwards.</p>
        </div>
        <div className="quiz">
          {sections(items).map(({ title, start, list }) => (
            <section key={title} style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              <h2 className="quiz-section">{title}</h2>
              <ol start={start + 1}>
                {list.map((q, j) => {
                  const i = start + j;
                  return (
                    <li className="q" key={q.id}>
                      <p className="qt" id={`${q.id}-q`}>{q.prompt}</p>
                      <fieldset className="opts" aria-labelledby={`${q.id}-q`}>
                        {q.options.map((o, k) => (
                          <label className="opt" key={k}>
                            <input type="radio" name={q.id} checked={answers[i] === k} onChange={() => choose(i, k)} />
                            <span className="key" aria-hidden="true">{KEYS[k]}</span>
                            <span>{o}</span>
                          </label>
                        ))}
                      </fieldset>
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
