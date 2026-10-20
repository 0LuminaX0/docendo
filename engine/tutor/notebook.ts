import type { Belief, Entry, State } from "./state";

// Kai's notebook as Kai reads it: plain functions over the saved state, without the schemas (state.ts), so the
// practice page can show the notebook without shipping the validation library to the browser.

/** Latest verdict per fact: a later verdict on the same fact replaces earlier ones. */
export function latest(state: State): Map<string, Entry> {
  const m = new Map<string, Entry>();
  for (const e of state.notebook) m.set(e.fact, e);
  return m;
}

/**
 * Misconceptions Kai still believes: a later correct explanation of any fact of
 * the same idea replaces them, as a later verdict replaces an earlier one on a
 * fact. (All stay in `state.misconceptions` for the log.)
 */
export function activeMisconceptions(state: State): Belief[] {
  const corrected = (m: Belief) => state.notebook.some((e) => e.verdict === "correct" && e.turn > m.turn && e.fact.split(".")[0] === m.node);
  return (state.misconceptions ?? []).filter((m) => !corrected(m));
}

/**
 * Kai's notes as it reads them when solving: the latest word on each fact, then
 * the misconceptions it still believes, numbered from 1. The solver cites these
 * numbers, and the practice page's notebook shows the same list.
 */
export function notesOf(state: State): string[] {
  return noteParts(state).map((n) => n.text);
}

/** Every note Kai ever wrote (also ones a correction replaced), mapped to the learner's words inside it. */
export function quotesOf(state: State): Record<string, string> {
  const out: Record<string, string> = {};
  for (const e of [...state.notebook, ...(state.misconceptions ?? [])]) if (e.note) out[e.note] = e.words;
  return out;
}

/** Kai's notes with the learner's words in each: `text` is the note as written (the whole sentence, or just the
 * learner's words when there is none), `quote` the learner's own words inside it (shown in bold). */
export function noteParts(state: State): { text: string; quote: string }[] {
  // one message can explain several facts, and the judge quotes a span of it per fact, so quotes overlap: a note whose
  // words are already inside another is dropped, and the longer one keeps the place of the first
  const norm = (t: string) => t.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
  const out: { text: string; quote: string }[] = [];
  const keys: string[] = [];
  for (const e of [...latest(state).values(), ...activeMisconceptions(state)]) {
    const k = norm(e.words);
    if (!k) continue;
    const part = { text: e.note || e.words, quote: e.words };
    const i = keys.findIndex((o) => o.includes(k) || k.includes(o));
    if (i < 0) (out.push(part), keys.push(k));
    else if (k.length > keys[i]!.length) ((out[i] = part), (keys[i] = k));
  }
  return out.slice(-40);
}
