"use client";

import { Fragment, useState } from "react";
import { Lightbulb, RotateCcw, Sparkles } from "lucide-react";
import { KaiFace } from "./ui";
import type { KaiAttempt, KaiEntry } from "@/lib/client/store";

type Item = { id: string; round: number; title: string; kind: "choice" | "number"; prompt: string; options: string[] | null; unit: string | null };
const KEYS = "ABCDEF";

/**
 * Recursive feedback: Kai solves the problem from its notebook, step by step,
 * and a light says whether its answer is right. After a wrong answer the
 * learner clicks the step they think is faulty, sees which of their own
 * statements Kai used there, and may correct Kai once; Kai then tries again.
 */
export default function KaiSolve({
  q,
  entry,
  busy,
  disabled,
  head,
  onSolve,
  onClick,
  onReteach,
}: {
  q: Item;
  entry: KaiEntry;
  busy: boolean;
  disabled: boolean;
  head: React.ReactNode;
  onSolve: () => void;
  onClick: (step: number) => void;
  onReteach: (message: string) => void;
}) {
  const [text, setText] = useState("");
  const [sel, setSel] = useState<number | null>(null);
  const attempts = entry.attempts;
  const last = attempts.at(-1);
  const canReteach = attempts.length === 1 && last && !last.correct && !entry.correction;
  const done = !!last && (last.correct || attempts.length >= 2);

  return (
    <section className="pq kai-solve" aria-labelledby={`${q.id}-q`}>
      <div className="qt">
        {head}
        <p id={`${q.id}-q`}>{q.prompt}</p>
      </div>
      {q.options && (
        <ol className="kopts" aria-label="Options">
          {q.options.map((o, k) => (
            <li key={k}>
              <span className="key" aria-hidden="true">{KEYS[k]}</span>
              <span>{o}</span>
            </li>
          ))}
        </ol>
      )}

      {!attempts.length && !busy && (
        <div className="pact">
          <button className="btn primary small" onClick={onSolve} disabled={disabled}>
            <Sparkles size={15} /> Let Kai solve it
          </button>
          <span className="note">Kai only knows what you taught it.</span>
        </div>
      )}

      {attempts.map((a, n) => (
        <Fragment key={n}>
          <Attempt
            a={a}
            n={n}
            q={q}
            clickable={!!canReteach && n === 0 && !disabled}
            selected={n === 0 ? (canReteach ? sel : (entry.clicks.at(-1) ?? null)) : null}
            onClick={(i) => (setSel(i), onClick(i))}
          />
          {/* the correction sits between Kai's two attempts */}
          {n === 0 && entry.correction && (
            <div className="msg you">
              <div className="col">
                <span className="who" style={{ textAlign: "right" }}>Your correction</span>
                <div className="bubble">{entry.correction}</div>
              </div>
            </div>
          )}
        </Fragment>
      ))}

      {busy && (
        <div className="msg">
          <KaiFace mood="thinking" size={32} />
          <div className="think" style={{ paddingLeft: 0 }}>
            <span className="levers" aria-hidden="true"><i /><i /><i /></span>
            {attempts.length ? "Kai is reading your correction and trying again" : "Kai is working on it"}
          </div>
        </div>
      )}

      {canReteach && !busy && (
        <div className="reteach">
          {sel === null ? (
            <p className="note">Click the step where you think Kai went wrong.</p>
          ) : (
            <>
              <label htmlFor={`${q.id}-fix`} className="eyebrow">Correct Kai (once)</label>
              <textarea
                id={`${q.id}-fix`}
                className="work"
                rows={3}
                maxLength={1500}
                placeholder="Explain to Kai what it got wrong in this step"
                value={text}
                disabled={disabled}
                onChange={(e) => setText(e.target.value)}
              />
              <div className="pact">
                <button className="btn primary small" disabled={disabled || !text.trim()} onClick={() => onReteach(text.trim())}>
                  <RotateCcw size={15} /> Send, and let Kai try again
                </button>
              </div>
            </>
          )}
        </div>
      )}

      {done && !last!.correct && <p className="note">Kai still got it wrong. You&apos;ll see the worked solution after the final test.</p>}
    </section>
  );
}

function Attempt({ a, n, q, clickable, selected, onClick }: { a: KaiAttempt; n: number; q: Item; clickable: boolean; selected: number | null; onClick: (i: number) => void }) {
  const k = KEYS.indexOf(a.answer.trim().charAt(0).toUpperCase());
  const shown = q.options && k >= 0 && q.options[k] ? `${KEYS[k]}: ${q.options[k]}` : `${a.answer}${q.unit && !a.answer.includes(q.unit) ? ` ${q.unit}` : ""}`;
  return (
    <div className="kattempt">
      <div className="who-row">
        <KaiFace mood={a.correct ? "great" : "confused"} size={30} />
        <b>{n === 0 ? "Kai's solution" : "Kai's second try"}</b>
      </div>
      <ol className="ksteps">
        {a.steps.map((s, i) => (
          <li key={i} className={selected === i ? "bad" : ""}>
            {clickable ? (
              <button type="button" onClick={() => onClick(i)} aria-pressed={selected === i}>
                {s.text}
              </button>
            ) : (
              <span>{s.text}</span>
            )}
            {selected === i && (
              <div className="knote">
                {s.notes.length ? (
                  <>
                    I got this from you. You said:{" "}
                    {s.notes.map((x, j) => (
                      <q key={j}>{a.notes[x - 1]}</q>
                    ))}
                  </>
                ) : (
                  <>You didn&apos;t tell me this, so I guessed.</>
                )}
              </div>
            )}
          </li>
        ))}
      </ol>
      <p className="kanswer">
        <span>Kai&apos;s answer:</span> {shown}
      </p>
      <span className={`bulb ${a.correct ? "on" : "off"}`} role="status">
        <Lightbulb size={18} strokeWidth={2.2} />
        {a.correct ? "Kai's answer is right" : "Kai's answer is wrong"}
      </span>
    </div>
  );
}
