import type { z } from "zod";
import type { PretestItem } from "./pack";

// The pretest's rules, shared by the server (app/api/grade), the pretest page and the tests: which sets a session
// takes and in which order, and how its answers are read and scored. Background questions come first; then a set of
// knowledge items (a session takes the first set), or in a pilot (settings pretest.both) every set, one after the
// other, in an order that alternates with the session's test form (A: the file's order, B: the reverse), so it is
// balanced within each condition like the forms.

type Item = z.infer<typeof PretestItem>;

/** The knowledge sets, in file order ([""] for a pretest without sets). */
export const pretestSets = (items: Pick<Item, "kind" | "set">[]) => {
  const sets = [...new Set(items.filter((q) => q.kind === "knowledge").map((q) => q.set ?? ""))];
  return sets.length ? sets : [""];
};

/** The sets a session takes, in order: the first one, or (both) all of them, reversed for form B. */
export function setsFor(items: Pick<Item, "kind" | "set">[], both: boolean, form: "A" | "B"): string[] {
  const all = pretestSets(items);
  if (!both || all.length < 2) return all.slice(0, 1);
  return form === "B" ? [...all].reverse() : all;
}

/** The items a session answers for these sets: the background questions, then each set's items. */
export function pretestItems<T extends Pick<Item, "kind" | "set">>(items: T[], sets: string[]): T[] {
  return [...items.filter((q) => q.kind === "background"), ...sets.flatMap((s) => items.filter((q) => q.kind === "knowledge" && (q.set ?? "") === s))];
}

const DONT_KNOW = "I don't know";

/**
 * Score a session's pretest: one answer (an option's index) for every item of its sets, nothing else. Null when the
 * answers don't fit those items. The score counts knowledge items right, in all and per set; "I don't know" answers
 * are counted; a background answer marked `exclude` flags the session as excluded from the main analysis.
 */
export function gradePretest(items: Item[], raw: Record<string, number>, sets: string[]) {
  const known = pretestSets(items);
  if (!sets.length || new Set(sets).size !== sets.length || sets.some((s) => !known.includes(s))) return null;
  const asked = pretestItems(items, sets);
  const ids = new Set(asked.map((q) => q.id));
  if (Object.keys(raw).some((id) => !ids.has(id))) return null;
  if (asked.some((q) => !Number.isInteger(raw[q.id]) || raw[q.id]! < 0 || raw[q.id]! >= q.options.length)) return null;
  const answers = Object.fromEntries(asked.map((q) => [q.id, raw[q.id]!]));
  const knowledge = asked.filter((q) => q.kind === "knowledge");
  const right = (q: Item) => q.answer !== undefined && answers[q.id] === q.answer;
  const setScores = Object.fromEntries(
    sets.map((s) => {
      const mine = knowledge.filter((q) => (q.set ?? "") === s);
      return [s, { score: mine.filter(right).length, of: mine.length }];
    }),
  );
  return {
    answers,
    sets,
    score: knowledge.filter(right).length,
    of: knowledge.length,
    setScores,
    dontKnow: knowledge.filter((q) => q.options[answers[q.id]!] === DONT_KNOW).length,
    excluded: asked.some((q) => q.exclude !== undefined && answers[q.id] === q.exclude),
  };
}
