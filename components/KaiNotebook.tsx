"use client";

import { useEffect, useRef } from "react";
import Quoted from "./Quoted";

/**
 * Kai's notebook during recursive feedback: everything Kai knows, in the
 * learner's own words (with the few words Kai added to make each a whole sentence, in a lighter ink), as Kai reads it when solving (numbered like the solver's
 * notes, so a step's markers point at lines here). After a correction, notes
 * that no longer hold are struck through in pencil, and new ones are written in
 * a second ink. It never shows lesson text: only what the learner said.
 * A long notebook scrolls inside the paper; pointing at a step of Kai's
 * scrolls to the lines it used.
 */
export default function KaiNotebook({
  notes,
  before,
  lit,
  onLight,
  quotes = {},
}: {
  notes: string[]; // the notes Kai solved with, note n = notes[n - 1]
  before?: string[]; // the notes of Kai's previous try, to show what the correction changed
  lit: string[]; // notes to highlight (the ones the step under the pointer used), by their text
  onLight: (notes: string[]) => void;
  quotes?: Record<string, string>; // per note, the learner's own words inside it (shown in bold)
}) {
  const body = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = body.current;
    const line = el?.querySelector<HTMLElement>(".nb-line.lit");
    if (!el || !line || el.scrollHeight <= el.clientHeight) return;
    const top = line.offsetTop - el.offsetTop;
    if (top < el.scrollTop || top + line.offsetHeight > el.scrollTop + el.clientHeight) {
      // land on a ruled line, one line above the note, so no line is sliced at the paper's top edge
      const first = el.querySelector<HTMLElement>(".nb-line");
      const lh = parseFloat(getComputedStyle(line).lineHeight) || 40;
      const base = first ? first.offsetTop - el.offsetTop : 0;
      const target = Math.max(0, base + Math.floor((top - base - lh) / lh) * lh);
      el.scrollTo({ top: target, behavior: "smooth" });
    }
  }, [lit]);

  const crossed = before ? before.filter((b) => !notes.includes(b)) : [];
  const fresh = new Set(before ? notes.filter((n) => !before.includes(n)) : []);
  const unchanged = !!before && !crossed.length && !fresh.size;

  return (
    <aside className="nb" aria-label="Kai's notebook">
      <div className="nb-head">
        <h3>Kai&apos;s notebook</h3>
        <span>{before ? "after your correction" : notes.some((t) => quotes[t]) ? "your words; Kai's own additions in lighter ink" : "what you taught Kai, in your words"}</span>
      </div>
      <div className="nb-paper">
        <div className="nb-body ruled" ref={body}>
        {notes.length === 0 && !crossed.length ? (
          <p className="nb-empty">Empty. You haven&apos;t taught Kai anything it could write down.</p>
        ) : (
          <ol className="nb-lines">
            {crossed.map((t, i) => (
              <li key={`x${i}`} className={`nb-line crossed${lit.includes(t) ? " lit" : ""}`} aria-label={`Crossed out: ${t}`}>
                <span className="nb-n" aria-hidden="true" />
                <span className="nb-t">
                  <s>
                    <Quoted text={t} quote={quotes[t]} />
                  </s>
                </span>
              </li>
            ))}
            {notes.map((t, i) => (
              <li
                key={`${i}-${t.slice(0, 20)}`}
                className={`nb-line${fresh.has(t) ? " fresh" : ""}${lit.includes(t) ? " lit" : ""}`}
                onMouseEnter={() => onLight([t])}
                onMouseLeave={() => onLight([])}
              >
                <span className="nb-n">{i + 1}</span>
                <span className="nb-t">
                  <Quoted text={t} quote={quotes[t]} />
                </span>
              </li>
            ))}
          </ol>
        )}
        {unchanged && <p className="nb-pencil">Kai couldn&apos;t find anything new to write down from your correction.</p>}
        </div>
      </div>
    </aside>
  );
}
