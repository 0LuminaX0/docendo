"use client";

import Link from "next/link";
import { Brain, CalendarClock, Check, Minus, RotateCcw, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { Header, KaiFace } from "./ui";
import { useGuard } from "./useGuard";
import Survey from "./Survey";
import { useStudySettings } from "./SettingsContext";
import { parts, REASON_PROMPT, TestTable, useTestItems } from "./Exercises";
import { DONT_KNOW } from "@/lib/answers";
import { save, useSaved } from "@/lib/client/store";
import { flush, track } from "@/lib/client/log";
import { useState } from "react";

const KEYS = "ABCDEF";

export default function Results() {
  const router = useRouter();
  const [saved, update] = useSaved();
  const allowed = useGuard(saved, "results");
  const study = useStudySettings();
  // Kai's mind: Study setup's switch for the study runs; the team's debug session (the shared code) always has it
  const showMind = study.mind || !!saved?.debug;
  const { survey } = study;
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
    r.score >= 0.8 * r.of ? "That stuck really well." : r.score >= 0.5 * r.of ? "A solid base, with a few gaps to revisit." : "Some ideas didn't stick yet. The explanations below should help.";

  // after the final test (not the follow-up): a few questions before the score, so the score can't colour them
  if (!delayed && !saved.surveyDone && survey)
    return (
      <div className="shell">
        <Header step="results" label="Results" demo={saved.demo} />
        <main className="page narrow">
          <Survey onDone={() => update((x) => ({ ...x, surveyDone: true }))} />
        </main>
      </div>
    );

  return (
    <div className="shell">
      <Header step="results" label={delayed ? "Follow-up results" : "Results"} demo={saved.demo} />
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
              {/* a pilot's two forms: the score in each part */}
              {r.parts && r.parts.length > 1 && (
                <p className="note parts-score">{r.parts.map((p, k) => `Part ${k + 1}: ${p.score} of ${p.of}`).join(", ")}</p>
              )}
            </div>
          </div>
          {!delayed && (
          <div className="hero-kai" style={{ marginTop: 8 }}>
            <KaiFace mood={saved.chat.done ? "great" : "okay"} size={40} />
            <div className="bubble">
              Thanks for teaching me! You sent me {taught} explanation{taught === 1 ? "" : "s"}
              {saved.chat.done ? " and I ended up feeling ready" : ""}, at {Math.round((saved.chat.mind?.understanding ?? saved.chat.progress) * 100)}% understanding. The whole session took about {minutes} minute{minutes === 1 ? "" : "s"}.{" "}
              {showMind && <Link href="/mind" style={{ display: "inline-flex", alignItems: "center", gap: 5, verticalAlign: "bottom" }}>
                <Brain size={15} /> See what I learned
              </Link>}
            </div>
          </div>
          )}
        </div>

        {/* the follow-up test: when to come back, and how (only for a code that names this person) */}
        {!delayed && r.followUp && (
          <section className="followup-card" aria-labelledby="fu-h">
            <CalendarClock size={22} aria-hidden="true" />
            <div>
              <h2 id="fu-h">One more short test, later</h2>
              <p>
                {r.followUp.opensAt <= Date.now()
                  ? "Your follow-up test is open now."
                  : `From ${new Date(r.followUp.opensAt).toLocaleDateString(undefined, { weekday: "long", day: "numeric", month: "long" })}, you can take a follow-up test.`}{" "}
                It has {r.of} new questions on the same ideas and takes about {r.of} minutes. Come back to this site on this device, or enter the same access code. It helps us see what stays with you over time.
              </p>
            </div>
          </section>
        )}

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
            <section key={title || "items"} style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              {title && <h2 className="quiz-section">{title}</h2>}
              <ol>
                {shown.map(({ q, i, n }) => {
                  const g = r.items[i]!;
                  // multi-select: the true statements, and the ones the learner ticked
                  const isKey = (k: number) => (Array.isArray(g.answer) ? g.answer.includes(k) : k === g.answer);
                  const mine = (k: number) => (Array.isArray(g.chosen) ? g.chosen.includes(k) : k === g.chosen);
                  const reason = q.reason ? saved.testWork?.[q.id]?.trim() : null;
                  return (
                    <li className="q" key={q.id} style={{ counterSet: `q ${n}` }}>
                      <div className="qt">
                        <p>{q.prompt}</p>
                        {q.table && <TestTable table={q.table} />}
                        {q.question && <p>{q.question}</p>}
                      </div>
                      {q.options ? (
                      <div className="opts">
                        {q.options.map((o, k) => (
                          <div key={k} className={`opt${isKey(k) ? " right" : mine(k) ? " wrong" : ""}${q.kind === "multi" && mine(k) ? " ticked" : ""}`} style={{ cursor: "default" }}>
                            <span className="key" aria-hidden="true">{KEYS[k]}</span>
                            <span>
                              {o}
                              {q.kind === "multi" && <span className="note"> {isKey(k) ? "(true)" : "(false)"}</span>}
                              {mine(k) && <span className={q.kind === "multi" ? "tick-mark" : "sr-only"}>{q.kind === "multi" ? " ✓ ticked" : " (your answer)"}</span>}
                              {isKey(k) && q.kind !== "multi" && <span className="sr-only"> (correct answer)</span>}
                            </span>
                          </div>
                        ))}
                        {g.chosen === DONT_KNOW && <p className="note">You answered “I don&apos;t know”.</p>}
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
                          {g.correct ? "Correct" : g.chosen === null ? "Not answered" : g.chosen === DONT_KNOW ? "Not known" : "Not quite"}
                        </span>
                        {reason && (
                          <p className="note your-reason">
                            <span className="sr-only">{REASON_PROMPT} </span>Your reason: {reason}
                          </p>
                        )}
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
              const untried = !kai.length && (!e || !e.checks);
              const mine = kai.length ? kaiAnswer : !e?.answer ? null : p.options ? (p.options[Number(e.answer)] ?? null) : e.answer;
              const how = kai.length
                ? kai[0]!.correct ? "Kai got it right on the first try" : kai[1]?.correct ? "Kai got it right after your correction" : "Kai didn't solve it"
                : !e || !e.checks ? "Not tried" : e.correct ? (e.firstCorrect ? "Correct on the first try" : "Correct on the second try") : "Not solved";
              return (
                <article className="pq" key={p.id}>
                  <div className="qt">
                    <span className="ptitle">
                      {new Set((r.practice ?? []).map((x) => x.round)).size > 1 ? `Round ${p.round}, problem` : "Problem"} {i + 1}: {p.title}
                    </span>
                    <p>{p.prompt}</p>
                  </div>
                  <p className="note" style={{ margin: 0 }}>
                    {/* a problem never reached isn't a failure: a neutral tag */}
                    <span className={`tag ${solved ? "ok" : untried ? "skip" : "no"}`} style={{ marginRight: 10 }}>
                      {solved ? <Check size={13} strokeWidth={3} /> : untried ? <Minus size={13} strokeWidth={3} /> : <X size={13} strokeWidth={3} />}
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
