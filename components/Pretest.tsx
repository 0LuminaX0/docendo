"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { ArrowRight } from "lucide-react";
import { Header } from "./ui";
import { useGuard } from "./useGuard";
import { post, save, useSaved } from "@/lib/client/store";
import { track } from "@/lib/client/log";

type Item = { id: string; prompt: string; options: string[] };
const KEYS = "ABCDEF";

/**
 * Before the video: two background questions and three short knowledge items.
 * Graded and recorded on the server for the analysis; nothing is shown back.
 */
export default function Pretest({ items }: { items: Item[] }) {
  const router = useRouter();
  const [saved, update] = useSaved();
  const allowed = useGuard(saved, "pretest");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (!allowed || !saved) return <div className="center">Loading…</div>;

  const answers = items.map((_, i) => saved.pretest?.[i] ?? null);
  const answered = answers.filter((a) => a !== null).length;
  const choose = (i: number, k: number) => {
    track("pretest_option", { q: items[i]!.id, k });
    update((s) => {
      const a = items.map((_, j) => s.pretest?.[j] ?? null);
      a[i] = k;
      return { ...s, pretest: a };
    });
  };

  async function submit() {
    if (!saved || answered < items.length) return;
    setBusy(true);
    setError(null);
    track("pretest_submit");
    const r = await post<{ ok: true }>("/api/grade", { token: saved.token, kind: "pretest", answers });
    setBusy(false);
    if (!r.ok) {
      if (r.expired) {
        save(null);
        router.replace("/");
        return;
      }
      return setError(r.error);
    }
    update((s) => ({ ...s, step: s.step === "pretest" ? "watch" : s.step }));
    router.push("/watch");
  }

  return (
    <div className="shell">
      <Header phase={0} label="Before you start" demo={saved.demo} />
      <main className="page narrow">
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <span className="eyebrow">Before you start</span>
          <h1 className="title" style={{ fontSize: "clamp(26px, 4vw, 36px)" }}>Five quick questions</h1>
          <p className="lede" style={{ fontSize: 16 }}>
            So we know where you&apos;re starting from. It&apos;s fine not to know: pick &quot;I don&apos;t know&quot; rather than guess. This isn&apos;t graded, and you won&apos;t see the answers.
          </p>
        </div>
        <ol className="quiz">
          {items.map((q, i) => (
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
          ))}
        </ol>
        <div className="submitbar">
          <button className="btn primary" onClick={() => void submit()} disabled={busy || answered < items.length}>
            {busy ? "Saving…" : <>On to the lesson <ArrowRight size={17} /></>}
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
