"use client";

import { Fragment, useEffect, useRef, useState } from "react";
import { BookOpen, Send } from "lucide-react";
import { KaiFace } from "./ui";
import KaiNotebook from "./KaiNotebook";
import Scratchpad from "./Scratchpad";
import type { KaiAttempt, KaiEntry } from "@/lib/client/store";

type Item = { id: string; round: number; title: string; kind: "choice" | "number"; prompt: string; options: string[] | null; unit: string | null };
const KEYS = "ABCDEF";

/**
 * Recursive feedback: Kai solves the problem from its notebook while the learner
 * reads it, step by step, and a light says whether its answer is right. Each
 * step is marked with the notebook lines it used. After a wrong answer the
 * learner writes one correction (without being told which step is wrong); it
 * goes into Kai's notebook and Kai tries once more.
 *
 * Two columns: the task (the problem, then Kai's tries) and Kai's notebook,
 * tall and sticky beside it. The correction box sits under the notebook: the
 * learner tells Kai, and Kai writes down what it takes from it (the notebook is
 * Kai's, so the learner never writes in it).
 */
export default function KaiSolve({
  q,
  entry,
  notebook,
  busy,
  disabled,
  head,
  tools,
  onReteach,
  onRetry,
  failed,
}: {
  q: Item;
  entry: KaiEntry;
  notebook: string[]; // Kai's notes before it has tried (shown while it works)
  busy: boolean;
  disabled: boolean;
  head: React.ReactNode;
  tools: React.ReactNode; // under Kai's work: Rewatch
  onReteach: (message: string) => void;
  onRetry: () => void;
  failed: boolean;
}) {
  const [text, setText] = useState("");
  const [lit, setLit] = useState<string[]>([]);
  const attempts = entry.attempts;
  const last = attempts.at(-1);
  const canReteach = attempts.length === 1 && !!last && !last.correct && !entry.correction;
  const done = !!last && (last.correct || attempts.length >= 2);
  // when the correction box appears, bring it into view (only as far as needed: the notebook column is sticky)
  const fixBox = useRef<HTMLDivElement>(null);
  const asking = canReteach && !busy;
  useEffect(() => {
    if (asking) fixBox.current?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [asking]);

  return (
    <section className="pq kai-solve" aria-labelledby={`${q.id}-q`}>
      <div className="ks-task">
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

        {attempts.map((a, n) => (
          <Fragment key={n}>
            {n === 1 && entry.correction && (
              <div className="ks-fix-shown">
                <span className="eyebrow">Your correction</span>
                <p>{entry.correction}</p>
              </div>
            )}
            <Attempt a={a} n={n} q={q} lit={lit} onLight={setLit} numbered={n === attempts.length - 1} />
          </Fragment>
        ))}

        {busy && (
          <div className="msg ks-think">
            <KaiFace mood="thinking" size={30} />
            <div className="think" style={{ paddingLeft: 0 }}>
              <span className="levers" aria-hidden="true"><i /><i /><i /></span>
              {attempts.length ? "Kai is adding your correction to its notebook and trying again" : "Kai is solving it from its notebook"}
            </div>
          </div>
        )}
        {failed && !busy && !attempts.length && (
          <p className="note">
            Kai couldn&apos;t start.{" "}
            <button type="button" className="linkish" onClick={onRetry}>
              Try again
            </button>
          </p>
        )}
        {done && !last!.correct && <p className="note ks-end">Kai still got it wrong. You&apos;ll see the worked solution after the final test.</p>}
        {done && last!.correct && attempts.length === 2 && <p className="note ks-end">Your correction did it: Kai got it right this time.</p>}
        <div className="pact">
          <span className="grow" />
          {tools}
        </div>
      </div>

      <div className="ks-note">
        <KaiNotebook notes={last?.notes ?? notebook} before={attempts.length === 2 ? attempts[0]!.notes : undefined} lit={lit} onLight={setLit} />
        {asking && (
          <div className="ks-fix" ref={fixBox}>
            <h3>Correct Kai</h3>
            <p className="note">Kai got it wrong. Tell it what it should know (you aren&apos;t told which step is wrong). Kai writes down what it takes from it and tries once more.</p>
            <Scratchpad
              id={`${q.id}-fix`}
              where={`practice-fix:${q.id}`}
              label="Your correction for Kai"
              value={text}
              onChange={setText}
              rows={3}
              maxLength={1500}
              disabled={disabled}
              placeholder="For example: when ε-greedy explores, it picks…"
            />
            <div className="pact">
              <span className="grow" />
              <button className="btn primary small" disabled={disabled || !text.trim()} onClick={() => onReteach(text.trim())}>
                <Send size={14} /> Send to Kai
              </button>
            </div>
          </div>
        )}
      </div>
    </section>
  );
}

function Attempt({ a, n, q, lit, onLight, numbered }: { a: KaiAttempt; n: number; q: Item; lit: string[]; onLight: (notes: string[]) => void; numbered: boolean }) {
  const used = (s: { notes: number[] }) => s.notes.map((x) => a.notes[x - 1]).filter((t): t is string => !!t);
  const k = KEYS.indexOf(a.answer.trim().charAt(0).toUpperCase());
  const option = q.options && k >= 0 ? q.options[k] : undefined;
  return (
    <div className="kattempt">
      <div className="who-row">
        <KaiFace mood={a.correct ? "great" : "confused"} size={30} />
        <b>{n === 0 ? "Kai's solution" : "Kai's second try"}</b>
        <span className={`light ${a.correct ? "on" : "off"}`} role="status">
          <i aria-hidden="true" />
          {a.correct ? "Right" : "Wrong"}
        </span>
      </div>
      <ol className="ksteps">
        {a.steps.map((s, i) => (
          <li
            key={i}
            style={{ animationDelay: `${i * 260}ms` }}
            className={used(s).some((t) => lit.includes(t)) ? "lit" : ""}
            onMouseEnter={() => onLight(used(s))}
            onMouseLeave={() => onLight([])}
            tabIndex={s.notes.length ? 0 : -1}
            onFocus={() => onLight(used(s))}
            onBlur={() => onLight([])}
          >
            <span>{s.text}</span>
            {s.notes.length > 0 && (
              <span className="kcite" aria-label={numbered ? `from notebook line${s.notes.length > 1 ? "s" : ""} ${s.notes.join(", ")}` : "from Kai's notebook"}>
                {numbered ? s.notes.map((x) => <i key={x}>{x}</i>) : <i><BookOpen size={10} strokeWidth={2.6} /></i>}
              </span>
            )}
          </li>
        ))}
      </ol>
      <p className={`kanswer ${a.correct ? "on" : "off"}`} style={{ animationDelay: `${a.steps.length * 260}ms` }}>
        <span className="lbl">Kai&apos;s answer</span>
        {option ? (
          <>
            <span className="key" aria-hidden="true">{KEYS[k]}</span>
            <span className="sr-only">{KEYS[k]}: </span>
            <span>{option}</span>
          </>
        ) : (
          <span>{`${a.answer}${q.unit && !a.answer.includes(q.unit) ? ` ${q.unit}` : ""}`}</span>
        )}
      </p>
    </div>
  );
}
