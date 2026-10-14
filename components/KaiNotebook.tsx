"use client";

/**
 * Kai's notebook during recursive feedback: everything Kai knows, in the
 * learner's own words, as Kai reads it when solving (numbered like the solver's
 * notes, so a step's markers point at lines here). After a correction, notes
 * that no longer hold are struck through in pencil, and new ones are written in
 * a second ink. It never shows lesson text: only what the learner said.
 */
export default function KaiNotebook({
  notes,
  before,
  lit,
  onLight,
  children,
}: {
  notes: string[]; // the notes Kai solved with, note n = notes[n - 1]
  before?: string[]; // the notes of Kai's previous try, to show what the correction changed
  lit: string[]; // notes to highlight (the ones the step under the pointer used), by their text
  onLight: (notes: string[]) => void;
  children?: React.ReactNode; // the page's last lines: where the learner writes a correction
}) {
  const crossed = before ? before.filter((b) => !notes.includes(b)) : [];
  const fresh = new Set(before ? notes.filter((n) => !before.includes(n)) : []);
  const unchanged = !!before && !crossed.length && !fresh.size;

  return (
    <aside className="nb" aria-label="Kai's notebook">
      <div className="nb-head">
        <h3>Kai&apos;s notebook</h3>
        <span>{before ? "after your correction" : "what you taught Kai, in your words"}</span>
      </div>
      <div className="nb-paper">
        <div className="nb-body ruled">
        {notes.length === 0 && !crossed.length ? (
          <p className="nb-empty">Empty. You haven&apos;t taught Kai anything it could write down.</p>
        ) : (
          <ol className="nb-lines">
            {crossed.map((t, i) => (
              <li key={`x${i}`} className={`nb-line crossed${lit.includes(t) ? " lit" : ""}`} aria-label={`Crossed out: ${t}`}>
                <span className="nb-n" aria-hidden="true" />
                <span className="nb-t">
                  <s>{t}</s>
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
                <span className="nb-t">{t}</span>
              </li>
            ))}
          </ol>
        )}
        {unchanged && <p className="nb-pencil">Kai couldn&apos;t find anything new to write down from your correction.</p>}
        </div>
        {children && <div className="nb-foot">{children}</div>}
      </div>
    </aside>
  );
}
