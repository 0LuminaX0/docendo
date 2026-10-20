"use client";

import { useState } from "react";
import { ArrowRight } from "lucide-react";
import { flush, track } from "@/lib/client/log";
import { useStudySettings } from "./SettingsContext";
import { Count } from "@/lib/words";


/**
 * A few questions after the final test, before the score: effort, responsibility for Kai, how well the learner thinks
 * they understand, how much practice helped, enjoyment, and the manipulation check (what the practice's light was
 * about). The same in both conditions; optional.
 */
export default function Survey({ onDone }: { onDone: () => void }) {
  const ITEMS = useStudySettings().survey ?? [];
  const [a, setA] = useState<Record<string, number>>({});
  const all = ITEMS.every((q) => a[q.id] !== undefined);
  const send = (skipped: boolean) => {
    track("survey", { skipped, ...(skipped ? {} : a) }); // one field per question (scales 1 to 7; lights: option index)
    flush();
    onDone();
  };
  return (
    <section className="survey" aria-labelledby="survey-h">
      <div className="survey-head">
        <span className="eyebrow">Before your score</span>
        <h1 id="survey-h">{Count(ITEMS.length, "quick question")}</h1>
        <p className="lede">Your answers help us understand how learning by teaching works. There are no right answers.</p>
      </div>
      <ol className="survey-list">
        {ITEMS.map((q, i) => (
          <li key={q.id}>
            <p className="qt" id={`sv-${q.id}`}>
              <span className="survey-n">{i + 1}</span>
              {q.prompt}
            </p>
            {q.kind === "scale" ? (
              <div className="survey-scale" role="radiogroup" aria-labelledby={`sv-${q.id}`}>
                <span className="survey-end">{q.low}</span>
                <span className="survey-dots">
                  {[1, 2, 3, 4, 5, 6, 7].map((v) => (
                    <button key={v} type="button" role="radio" aria-checked={a[q.id] === v} aria-label={`${v} of 7`} className={a[q.id] === v ? "on" : ""} onClick={() => setA((x) => ({ ...x, [q.id]: v }))}>
                      {v}
                    </button>
                  ))}
                </span>
                <span className="survey-end">{q.high}</span>
              </div>
            ) : (
              <div className="survey-choices" role="radiogroup" aria-labelledby={`sv-${q.id}`}>
                {q.options!.map((o, k) => (
                  <button key={o} type="button" role="radio" aria-checked={a[q.id] === k} className={a[q.id] === k ? "on" : ""} onClick={() => setA((x) => ({ ...x, [q.id]: k }))}>
                    {o}
                  </button>
                ))}
              </div>
            )}
          </li>
        ))}
      </ol>
      <div className="row">
        <button className="btn primary" disabled={!all} onClick={() => send(false)}>
          See my results <ArrowRight size={17} />
        </button>
        <button className="linkish survey-skip" onClick={() => send(true)}>
          Skip these questions
        </button>
      </div>
    </section>
  );
}
