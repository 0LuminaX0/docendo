import { Formula } from "./Formula";
import { FIGURE } from "./Figures";
import { withLn } from "./Ln";
import type { LessonBlock, LessonSection } from "@/lib/lesson";

// The text lesson as participants read it: sections of paragraphs (**bold** for the terms it introduces), formulas and
// figures. No state, so the reading page renders it on the server; the help passages reuse it in the browser.

/** A paragraph's text with its **bold** terms. */
function Para({ text }: { text: string }) {
  const parts = text.split(/\*\*(.+?)\*\*/g);
  return <p>{parts.map((t, i) => (i % 2 ? <strong key={i}>{withLn(t)}</strong> : <span key={i}>{withLn(t)}</span>))}</p>;
}

export function Block({ b }: { b: LessonBlock }) {
  if ("p" in b) return <Para text={b.p} />;
  if ("formula" in b) return <Formula id={b.formula} />;
  const Fig = FIGURE[b.figure];
  return Fig ? (
    <figure className="lesson-fig">
      <Fig />
      <figcaption>{b.caption}</figcaption>
    </figure>
  ) : null;
}

export function Section({ s, heading = "h2" }: { s: LessonSection; heading?: "h2" | "h3" }) {
  const H = heading;
  return (
    <section className="lesson-section" id={`lesson-${s.id}`} data-section={s.id}>
      <H>{s.title}</H>
      {s.blocks.map((b, i) => <Block key={i} b={b} />)}
    </section>
  );
}
