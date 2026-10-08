"use client";

import Link from "next/link";
import { Brain, Check, RotateCcw, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { Header, KaiFace } from "./ui";
import { useGuard } from "./useGuard";
import { sections } from "./Exercises";
import { save, useSaved } from "@/lib/client/store";

type Item = { id: string; section: string; prompt: string; options: string[] };
const KEYS = "ABCDEF";

export default function Results({ items }: { items: Item[] }) {
  const router = useRouter();
  const [saved] = useSaved();
  const allowed = useGuard(saved, "results");
  if (!allowed || !saved || !saved.result) return <div className="center">Loading…</div>;

  const r = saved.result;
  const minutes = Math.max(1, Math.round((Date.now() - saved.startedAt) / 60000));
  const taught = saved.chat.turns.filter((t) => t.role === "learner" && !t.help).length;
  const line =
    r.score >= 8 ? "That stuck really well." : r.score >= 5 ? "A solid base, with a few gaps to revisit." : "Some ideas didn't stick yet. The explanations below should help.";

  return (
    <div className="shell">
      <Header phase={4} label="Results" demo={saved.demo} />
      <main className="page narrow">
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <span className="eyebrow">Results</span>
          <div className="score">
            <div className="big">
              {r.score}
              <span> / {r.of}</span>
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              <h1 style={{ fontSize: 26 }}>{line}</h1>
              <div className="dots" aria-hidden="true">
                {r.items.map((x) => <i key={x.id} className={x.correct ? "ok" : "no"} />)}
              </div>
            </div>
          </div>
          <div className="hero-kai" style={{ marginTop: 8 }}>
            <KaiFace mood={saved.chat.done ? "great" : "okay"} size={40} />
            <div className="bubble">
              Thanks for teaching me! You sent me {taught} explanation{taught === 1 ? "" : "s"}
              {saved.chat.done ? " and I ended up feeling ready" : ""}, at {Math.round((saved.chat.mind?.understanding ?? saved.chat.progress) * 100)}% understanding. The whole session took about {minutes} minute{minutes === 1 ? "" : "s"}.{" "}
              <Link href="/mind" style={{ display: "inline-flex", alignItems: "center", gap: 5, verticalAlign: "bottom" }}>
                <Brain size={15} /> See what I learned
              </Link>
            </div>
          </div>
        </div>

        <div className="quiz">
          {sections(items).map(({ title, start, list }) => (
            <section key={title} style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              <h2 className="quiz-section">{title}</h2>
              <ol start={start + 1}>
                {list.map((q, j) => {
                  const g = r.items[start + j]!;
                  return (
                    <li className="q" key={q.id}>
                      <p className="qt">{q.prompt}</p>
                      <div className="opts">
                        {q.options.map((o, k) => (
                          <div key={k} className={`opt${k === g.answer ? " right" : k === g.chosen ? " wrong" : ""}`} style={{ cursor: "default" }}>
                            <span className="key" aria-hidden="true">{KEYS[k]}</span>
                            <span>
                              {o}
                              {k === g.chosen && <span className="sr-only"> (your answer)</span>}
                              {k === g.answer && <span className="sr-only"> (correct answer)</span>}
                            </span>
                          </div>
                        ))}
                      </div>
                      <div className="after">
                        <span className={`tag ${g.correct ? "ok" : "no"}`} style={{ alignSelf: "flex-start" }}>
                          {g.correct ? <Check size={13} strokeWidth={3} /> : <X size={13} strokeWidth={3} />}
                          {g.correct ? "Correct" : g.chosen === null ? "Not answered" : "Not quite"}
                        </span>
                        <p className="explain">{g.explain}</p>
                      </div>
                    </li>
                  );
                })}
              </ol>
            </section>
          ))}
        </div>

        <div className="row">
          <button
            className="btn"
            onClick={() => {
              save(null);
              router.push("/");
            }}
          >
            <RotateCcw size={16} /> Start a new session
          </button>
        </div>
      </main>
    </div>
  );
}
