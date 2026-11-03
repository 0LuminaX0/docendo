import { checkNumber } from "./practice";
import type { Exercise } from "./pack";
import { DONT_KNOW, type TestAnswer } from "../lib/answers";

// The final test's rules, shared by the server (app/api/grade) and the tests: which items a session answers, how one
// answer is read and graded, and the score per form. A session takes one form, or (the pilot, settings test.both)
// both forms one after the other, its own form first. An item marked `same` is identical in both forms (the anchor):
// a session that takes both forms answers it once, and that answer counts for both forms.

type Form = Exercise["form"];

/** The items a session answers, in the order of its parts: its own form, then (both) the other form without the
 * items it has already answered under the other form's id. */
export function sessionItems(items: Exercise[], first: Form, both: boolean): Exercise[] {
  const mine = items.filter((q) => q.form === first);
  if (!both) return mine;
  return [...mine, ...items.filter((q) => q.form !== first && !twinIn(q, mine))];
}

/** The item of `asked` that is the same as `q` (either one names the other in `same`), if any. */
export const twinIn = (q: Exercise, asked: Exercise[]) => asked.find((x) => x.id !== q.id && x.form !== q.form && (x.id === q.same || x.same === q.id));

/** An answer as the server keeps it: anything that isn't a valid answer to this item counts as unanswered (null). */
export function answerOf(q: Exercise, a: unknown): TestAnswer {
  if (a === DONT_KNOW) return q.dontKnow ? DONT_KNOW : null;
  const n = q.options?.length ?? 0;
  if (q.kind === "choice") return typeof a === "number" && Number.isInteger(a) && a >= 0 && a < n ? a : null;
  if (q.kind === "multi") {
    if (!Array.isArray(a)) return null;
    const ticked = [...new Set(a)].filter((k): k is number => typeof k === "number" && Number.isInteger(k) && k >= 0 && k < n).sort((x, y) => x - y);
    return ticked.length ? ticked : null;
  }
  return typeof a === "string" && a.trim() ? a.trim().slice(0, 40) : null;
}

/** Grade one answer: the key's option; exactly the true statements (multi); a typed number within the tolerance.
 * "I don't know" and no answer are wrong. */
export function checkExercise(q: Exercise, a: TestAnswer): boolean {
  if (a === null || a === DONT_KNOW) return false;
  if (q.kind === "choice") return a === q.answer;
  if (q.kind === "multi") {
    const key = Array.isArray(q.answer) ? [...q.answer].sort((x, y) => x - y) : [q.answer];
    return Array.isArray(a) && a.length === key.length && [...a].sort((x, y) => x - y).every((k, i) => k === key[i]);
  }
  return typeof q.answer === "number" && !Array.isArray(a) && checkNumber(String(a), q.answer, q.tolerance);
}

/** The key as the results page and the admin panel show it. */
export function keyText(q: Exercise): string {
  if (q.kind === "number") return `${String(q.answer)}${q.unit ? ` ${q.unit}` : ""}`;
  const keys = Array.isArray(q.answer) ? q.answer : [q.answer];
  return keys.map((k) => q.options?.[k] ?? "").join(" | ");
}
/** Whether option k is (one of) the key(s). */
export const isKey = (q: Exercise, k: number) => (Array.isArray(q.answer) ? q.answer.includes(k) : q.answer === k);

export type Graded = { q: Exercise; chosen: TestAnswer; correct: boolean };

/**
 * A session's test, graded: the items it answered (in `sessionItems` order, as the answers come), the items it
 * didn't see because it answered their twin (they take the twin's answer), the score over what it answered, and
 * the score per form, each form complete (its anchor included).
 */
export function gradeTest(items: Exercise[], first: Form, both: boolean, raw: unknown[]) {
  const asked = sessionItems(items, first, both);
  const graded: Graded[] = asked.map((q, i) => {
    const chosen = answerOf(q, raw[i] ?? null);
    return { q, chosen, correct: checkExercise(q, chosen) };
  });
  const forms: Form[] = both ? [first, first === "A" ? "B" : "A"] : [first];
  const copies = items
    .filter((q) => forms.includes(q.form) && !asked.includes(q))
    .flatMap((q) => {
      const twin = twinIn(q, asked);
      const g = twin ? graded.find((x) => x.q === twin) : undefined;
      return g ? [{ q, from: twin!.id, chosen: g.chosen, correct: g.correct }] : [];
    });
  const perForm = Object.fromEntries(
    forms.map((f) => {
      const all = [...graded.filter((x) => x.q.form === f), ...copies.filter((x) => x.q.form === f)];
      return [f, { score: all.filter((x) => x.correct).length, of: all.length }];
    }),
  ) as Partial<Record<Form, { score: number; of: number }>>;
  return { asked: graded, copies, forms, perForm, score: graded.filter((x) => x.correct).length, of: graded.length };
}
