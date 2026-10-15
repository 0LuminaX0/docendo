"use client";

import Link from "next/link";
import { Brain, Check, RotateCcw, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { Header, KaiFace } from "./ui";
import { useGuard } from "./useGuard";
import Survey from "./Survey";
import { parts, useTestItems } from "./Exercises";
import { save, useSaved } from "@/lib/client/store";
import { flush, track } from "@/lib/client/log";
import { useState } from "react";

const KEYS = "ABCDEF";

export default function Results() {
  const router = useRouter();
  const [saved, update] = useSaved();
  const allowed = useGuard(saved, "results");
  // the review starts with the questions the learner missed (their explanations matter most); "All" shows every one
  const [show, setShow] = useState<"missed" | "all" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const items = useTestItems(allowed, setError);
  if (!allowed || !saved || !saved.result || !items) return <div className="center">{error ?? "Loading…"}</div>;
  const delayed = saved.phase === "delayed";

  const r = saved.result;
  const missed = r.items.filter((x) => !x.correct).length;
  const view = show ?? (missed ? "missed" : "all");
  const minutes = Math.max(1, Math.round((Date.now() - saved.startedAt) / 60000));
  const taught = saved.chat.turns.filter((t) => t.role === "learner" && !t.help).length;
  const line =
    r.score >= 8 ? "That stuck really well." : r.score >= 5 ? "A solid base, with a few gaps to revisit." : "Some ideas didn't stick yet. The explanations below should help.";

  // after the final test (not the follow-up): a few questions before the score, so the score can't colour them
  if (!delayed && !saved.surveyDone)
    return (
      <div className="shell">
        <Header phase={4} label="Results" demo={saved.demo} />
        <main className="page narrow">
          <Survey onDone={() => update((x) => ({ ...x, surveyDone: true }))} />
        </main>
      </div>
    );

  return (
    <div className="shell">
      <Header phase={4} label={delayed ? "Follow-up results" : "Results"} demo={saved.demo} />
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
          {!delayed && (
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
          )}
        </div>

        {/* asked while the session is fresh: at the bottom of a long review most people never reached it */}
        <Feedback sent={!!saved.feedbackSent} onSent={() => update((x) => ({ ...x, feedbackSent: true }))} />

        <div className="review-head">
          <h2>Your answers</h2>
          {missed > 0 && (
            <div className="seg" role="group" aria-label="Which questions to show">
              <button type="button" aria-pressed={view === "missed"} onClick={() => (setShow("missed"), track("results_filter", { to: "missed" }))}>
                <span className="lbl">Missed ({missed})</span>
              </button>
              <button type="button" aria-pressed={view === "all"} onClick={() => (setShow("all"), track("results_filter", { to: "all" }))}>
                <span className="lbl">All {r.items.length}</span>
              </button>
            </div>
          )}
          {missed === 0 && <span className="note">All right: the explanations are below.</span>}
        </div>

        <div className="quiz">
          {parts(items, saved.testOrder).map(({ title, start, list }) => {
            const shown = list.map((x, j) => ({ ...x, n: start + j + 1 })).filter(({ i }) => view === "all" || !r.items[i]!.correct);
            if (!shown.length) return null;
            return (
            <section key={title} style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              <h2 className="quiz-section">{title}</h2>
              <ol>
                {shown.map(({ q, i, n }) => {
                  const g = r.items[i]!;
                  return (
                    <li className="q" key={q.id} style={{ counterSet: `q ${n}` }}>
                      <p className="qt">{q.prompt}</p>
                      {q.options ? (
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
                      ) : (
                        <p className="qnum">
                          <span>Your answer</span> <b className={g.correct ? "ok" : "no"}>{g.chosen === null ? "none" : `${g.chosen}${q.unit && !String(g.chosen).includes(q.unit) ? ` ${q.unit}` : ""}`}</b>
                          {!g.correct && (
                            <>
                              <span>The answer</span> <b>{g.key ?? g.answer}</b>
                            </>
                          )}
                        </p>
                      )}
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
            );
          })}
        </div>

        {r.practice && r.practice.length > 0 && (
          <section className="review" aria-labelledby="review-h">
            <h2 className="quiz-section" id="review-h">Practice problems: worked solutions</h2>
            {r.practice.map((p, i) => {
              const e = saved.practice?.items[p.id];
              // recursive feedback: the outcome is Kai's, after the learner's teaching (and correction)
              const kai = saved.practice?.kai?.[p.id]?.attempts ?? [];
              const kaiLast = kai.at(-1);
              const kaiKey = kaiLast ? "ABCDEF".indexOf(kaiLast.answer.trim().charAt(0).toUpperCase()) : -1;
              const kaiAnswer = !kaiLast ? null : p.options && kaiKey >= 0 ? (p.options[kaiKey] ?? kaiLast.answer) : kaiLast.answer;
              const solved = kai.length ? kai.some((x) => x.correct) : !!e?.correct;
              const mine = kai.length ? kaiAnswer : !e?.answer ? null : p.options ? (p.options[Number(e.answer)] ?? null) : e.answer;
              const how = kai.length
                ? kai[0]!.correct ? "Kai got it right on the first try" : kai[1]?.correct ? "Kai got it right after your correction" : "Kai didn't solve it"
                : !e || !e.checks ? "Not tried" : e.correct ? (e.firstCorrect ? "Correct on the first try" : "Correct on the second try") : "Not solved";
              return (
                <article className="pq" key={p.id}>
                  <div className="qt">
                    <span className="ptitle">
                      Round {p.round}, problem {i + 1}: {p.title}
                    </span>
                    <p>{p.prompt}</p>
                  </div>
                  <p className="note" style={{ margin: 0 }}>
                    <span className={`tag ${solved ? "ok" : "no"}`} style={{ marginRight: 10 }}>
                      {solved ? <Check size={13} strokeWidth={3} /> : <X size={13} strokeWidth={3} />}
                      {how}
                    </span>
                    {mine && !solved ? <>{kai.length ? "Kai's last answer" : "Your last answer"}: {mine}</> : null}
                  </p>
                  <div className="explain solution">
                    <ol>
                      {p.steps.map((st, k) => (
                        <li key={k}>{st}</li>
                      ))}
                    </ol>
                    <p>
                      <b>Answer:</b> {p.answer}
                    </p>
                  </div>
                </article>
              );
            })}
          </section>
        )}

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

/** An optional word at the end, for the study team (shown in the admin panel). */
function Feedback({ sent, onSent }: { sent: boolean; onSent: () => void }) {
  const [rating, setRating] = useState<number | null>(null);
  const [text, setText] = useState("");
  if (sent) return <p className="note fb-thanks">Thanks for your feedback.</p>;
  return (
    <section className="fb" aria-labelledby="fb-h">
      <h2 id="fb-h">How was it?</h2>
      <div className="fb-rate" role="radiogroup" aria-label="Your rating, from 1 to 5">
        {[1, 2, 3, 4, 5].map((n) => (
          <button key={n} type="button" role="radio" aria-checked={rating === n} className={rating === n ? "on" : ""} onClick={() => setRating(n)}>
            {n}
          </button>
        ))}
        <span className="note">1 not good, 5 great</span>
      </div>
      <label className="sr-only" htmlFor="fb-t">Anything you'd like to tell us</label>
      <textarea id="fb-t" className="work" rows={3} maxLength={1500} placeholder="Anything you'd like to tell us? What was confusing, what Kai did well or badly… (optional)" value={text} onChange={(e) => setText(e.target.value)} />
      <div className="row">
        <button
          type="button"
          className="btn small"
          disabled={rating === null && !text.trim()}
          onClick={() => {
            track("feedback", { rating, text: text.trim().slice(0, 1500) });
            flush();
            onSent();
          }}
        >
          Send feedback
        </button>
      </div>
    </section>
  );
}
