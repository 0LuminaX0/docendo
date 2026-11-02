"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { ArrowRight, Check } from "lucide-react";
import { Header } from "./ui";
import { useGuard, useNext } from "./useGuard";
import { post, save, useSaved } from "@/lib/client/store";
import { track } from "@/lib/client/log";
import { Count } from "@/lib/words";
import { pretestItems, setsFor } from "@/content/pretest";

type Item = { id: string; kind: "background" | "knowledge"; set: string; prompt: string; options: string[] };
const KEYS = "ABCDEF";

/** The session's test form, read from its token (signed, not secret): it sets the order of a pilot's sets. */
function formOf(token: string): "A" | "B" {
  try {
    const p = JSON.parse(atob((token.split(".")[0] ?? "").replace(/-/g, "+").replace(/_/g, "/"))) as { form?: string };
    return p.form === "B" ? "B" : "A";
  } catch {
    return "A";
  }
}

/**
 * Before the lesson: background questions, then a short set of knowledge items, each with "I don't know".
 * Graded and recorded on the server for the analysis; nothing is shown back. In a pilot (settings pretest.both) every
 * set, one after the other as parts, in an order that alternates with the session's test form (content/pretest.ts);
 * the next part opens once a part is complete, and the part before is then locked. The sets are fixed the first time
 * the page opens.
 */
export default function Pretest({ items, both }: { items: Item[]; both: boolean }) {
  const router = useRouter();
  const [saved, update] = useSaved();
  const allowed = useGuard(saved, "pretest");
  const next = useNext();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fixed = saved?.pretestSets;
  useEffect(() => {
    if (!allowed || !saved || fixed) return;
    const sets = setsFor(items, both, formOf(saved.token));
    update((s) => ({ ...s, pretestSets: sets }));
    track("pretest_sets", { sets });
  }, [allowed, saved, fixed, items, both, update]);
  if (!allowed || !saved || !fixed) return <div className="center">Loading…</div>;

  const sets = fixed.filter((s) => items.some((q) => q.set === s));
  const shown = pretestItems(items, sets.length ? sets : [""]);
  // part 1: the background questions and the first set; then one part per further set
  const partOf = (q: Item) => (q.kind === "background" ? 0 : Math.max(0, sets.indexOf(q.set)));
  const parts = Math.max(1, sets.length);
  const current = Math.min(saved.pretestPart ?? 0, parts - 1);
  const answers = saved.pretestAnswers ?? {};
  const answered = shown.filter((q) => answers[q.id] !== undefined).length;
  const partDone = (p: number) => shown.filter((q) => partOf(q) === p).every((q) => answers[q.id] !== undefined);
  const choose = (id: string, k: number) => {
    track("pretest_option", { q: id, k });
    update((s) => ({ ...s, pretestAnswers: { ...s.pretestAnswers, [id]: k } }));
  };

  function nextPart() {
    if (!partDone(current)) return;
    track("pretest_part", { part: current + 1, of: parts });
    update((s) => ({ ...s, pretestPart: current + 1 }));
    window.scrollTo({ top: 0 });
  }

  async function submit() {
    if (!saved || answered < shown.length) return;
    setBusy(true);
    setError(null);
    track("pretest_submit");
    const mine = Object.fromEntries(shown.map((q) => [q.id, answers[q.id]!]));
    const r = await post<{ ok: true }>("/api/grade", { token: saved.token, kind: "pretest", answers: mine, sets });
    setBusy(false);
    if (!r.ok) {
      if (r.expired) {
        save(null);
        router.replace("/");
        return;
      }
      return setError(r.error);
    }
    const n = next("pretest");
    update((s) => ({ ...s, step: s.step === "pretest" ? n.step : s.step }));
    router.push(n.path);
  }

  const start = shown.filter((q) => partOf(q) < current).length;
  return (
    <div className="shell">
      <Header step="pretest" label="Before you start" demo={saved.demo} />
      <main className="page narrow">
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <span className="eyebrow">Before you start</span>
          <h1 className="title" style={{ fontSize: "clamp(26px, 4vw, 36px)" }}>{Count(shown.length, "quick question")}</h1>
          <p className="lede" style={{ fontSize: 16 }}>
            So we know where you&apos;re starting from. It&apos;s fine not to know: pick &quot;I don&apos;t know&quot; rather than guess. This isn&apos;t graded, and you won&apos;t see the answers.
            {parts > 1 && ` ${Count(parts, "part")}, one after the other: once you go on, you can't change the part before.`}
          </p>
        </div>
        <div className="quiz">
          {Array.from({ length: current }, (_, p) => (
            <p className="pre-done" key={`done-${p}`}>
              <Check size={16} strokeWidth={2.6} aria-hidden="true" /> <b>Part {p + 1} of {parts} done.</b>
            </p>
          ))}
          <section style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            {parts > 1 && <h2 className="quiz-section">Part {current + 1} of {parts}</h2>}
            <ol style={{ counterReset: `q ${start}` }}>
              {shown
                .filter((q) => partOf(q) === current)
                .map((q) => (
                  <li className="q" key={q.id} data-q={q.id}>
                    <p className="qt" id={`${q.id}-q`}>{q.prompt}</p>
                    <fieldset className="opts" aria-labelledby={`${q.id}-q`}>
                      {q.options.map((o, k) => (
                        <label className="opt" key={k}>
                          <input type="radio" name={q.id} checked={answers[q.id] === k} onChange={() => choose(q.id, k)} />
                          <span className="key" aria-hidden="true">{KEYS[k]}</span>
                          <span>{o}</span>
                        </label>
                      ))}
                    </fieldset>
                  </li>
                ))}
            </ol>
          </section>
        </div>
        <div className="submitbar">
          {current < parts - 1 ? (
            <button className="btn primary" onClick={nextPart} disabled={!partDone(current)}>
              Go on to part {current + 2} <ArrowRight size={17} />
            </button>
          ) : (
            <button className="btn primary" onClick={() => void submit()} disabled={busy || answered < shown.length}>
              {busy ? "Saving…" : <>On to the lesson <ArrowRight size={17} /></>}
            </button>
          )}
          <span className="answered">
            <span className="track" aria-hidden="true"><span className="fill" style={{ width: `${(answered / shown.length) * 100}%` }} /></span>
            {answered} of {shown.length} answered
          </span>
          {error && <p className="error" role="alert">{error}</p>}
        </div>
      </main>
    </div>
  );
}
