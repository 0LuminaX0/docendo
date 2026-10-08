import { z } from "zod";
import type { Bundle } from "../../content/schema";
import { checkPractice, parseNumber, type PracticeItem } from "../../content/practice";
import { chatJson, MODELS, type OnCall } from "../llm";
import { forbiddenTerms } from "./admit";
import { activeMisconceptions, latest, type State } from "./state";
import { termsUsed } from "./judge";

// Recursive feedback: Kai solves a practice problem from its notebook alone.
// The solver model sees only the problem and Kai's numbered notes (the
// learner's own words, mistakes included), never the lesson's facts, the key or
// the worked solution. Each step cites the notes it relies on; the learner sees
// those notes when they click a step.
//
// A model told to "use only your notes" still reads rules out of the answer
// options or falls back on what it knows, so the code enforces it: the GATE.
// Kai can only be right when its notebook holds every fact the problem needs
// (`needs` in practice.json), explained correctly, and it still believes no
// misconception about those ideas. Otherwise Kai cannot land on the key:
// - facts missing (choice problem): the code picks Kai's guess at random among
//   the wrong options, and the model only explains, from the notes, why that
//   guess seemed plausible to a beginner;
// - a misconception still believed, or a number problem: the model solves
//   freely (so the error comes from the misconception), and any right answer
//   without the facts is replaced by the offline attempt, which is wrong.
// Without a model (demo mode) or when it fails, the offline solver builds Kai's
// attempt from the worked solution and the notebook.

export type Step = { text: string; notes: number[] };
export type Solution = {
  steps: Step[];
  answer: string; // option letter, or the number as Kai wrote it
  correct: boolean;
  notes: string[]; // Kai's notebook as numbered for this attempt (note n = notes[n - 1])
  leaked: string[]; // lesson terms Kai used that the learner never taught or used (for the log)
  by: "model" | "offline";
  gate: Gate;
};
export type Gate = { needs: string[]; missing: string[]; misled: string[]; canBeRight: boolean };

const LETTERS = "ABCDEF";

/** Kai's notes, numbered: the latest word on each fact, then the misconceptions it still believes. */
export function notesOf(state: State): string[] {
  const out: string[] = [];
  for (const e of latest(state).values()) out.push(e.words);
  for (const m of activeMisconceptions(state)) if (!out.includes(m.words)) out.push(m.words);
  return out.slice(-40);
}

/** Can Kai get this problem right? Only with every needed fact explained correctly and no misconception left about them. */
export function gate(item: PracticeItem, state: State): Gate {
  const needs = item.needs ?? [...new Set(item.steps.flatMap((s) => s.facts))];
  const facts = latest(state);
  const missing = needs.filter((f) => facts.get(f)?.verdict !== "correct"); // a vague (partial) explanation isn't enough
  const ideas = new Set(needs.map((f) => f.split(".")[0]));
  const misled = activeMisconceptions(state).filter((m) => ideas.has(m.node)).map((m) => m.words);
  return { needs, missing, misled, canBeRight: !missing.length && !misled.length };
}

const Reply = z.object({
  steps: z.array(z.object({ text: z.string(), notes: z.array(z.number().int()) })),
  answer: z.string(),
});

const SYSTEM = `You are Kai, a student who missed a lecture. Everything you know about its topic is in YOUR NOTES: what a classmate told you, in their words. You believe your notes, even where they might be wrong.

Solve the problem using ONLY your notes:
- Write 2 to 4 short steps in the first person, like a student thinking aloud. Each step lists the numbers of the notes it relies on in "notes"; don't write the numbers in the step's text.
- If you need a rule your notes don't give, say so honestly in that step ("You didn't tell me how ..., so I'll guess ..."), make the guess a beginner would make, and list no notes for it.
- Never use knowledge from outside your notes, even if you think you know better: no formulas, rules or technical words that are not in your notes or in the problem.
- The answer options are not notes. Never take a rule from an option's wording: an option only says what someone might answer.
- Do the arithmetic the problem needs, as your notes suggest it.
- answer: the letter of the option you choose (A, B, …), or just the number for a number question.`;

const GUESSING = `\n\nYour notes don't tell you everything this problem needs. Where they are silent, guess like a beginner and say so; never fill the gap with what you think the right rule is.`;

const guessing = (letter: string, option: string) =>
  `\n\nYour notes don't tell you how to decide this problem, so you guessed: your answer is ${letter} ("${option}"). In 2 or 3 short steps, explain from your notes and the problem only why that guess seemed plausible to you, and say plainly that it is a guess because you weren't told how this works. Don't argue for any other option. answer: ${letter}.`;

export async function llmSolve(bundle: Bundle, item: PracticeItem, state: State, onCall?: OnCall): Promise<Solution> {
  const notes = notesOf(state);
  const g = gate(item, state);
  // facts missing on a choice problem: Kai's answer is a random wrong guess, picked here; the model only explains it
  const guess = !g.canBeRight && !g.misled.length && item.kind === "choice" ? wrongGuess(item, `${item.id}|${notes.join("|")}`) : null;
  const problem =
    item.kind === "choice"
      ? `${item.prompt}\n\nOptions:\n${item.options!.map((o, i) => `${LETTERS[i]}) ${o}`).join("\n")}`
      : `${item.prompt}\n\nAnswer with a number${item.unit ? ` (in ${item.unit})` : ""}.`;
  const rules = SYSTEM + (guess ? guessing(guess, item.options![LETTERS.indexOf(guess)]!) : g.canBeRight ? "" : GUESSING);
  const r = await chatJson({
    model: MODELS.writer,
    name: "solution",
    schema: Reply,
    temperature: 0.3,
    maxTokens: 900,
    // the learner is waiting: a slow model gives way to the offline attempt (and the route's 60 s limit holds)
    timeoutMs: 12_000,
    retries: 1,
    messages: [
      { role: "system", content: rules },
      { role: "user", content: `YOUR NOTES:\n${notes.length ? notes.map((n, i) => `[${i + 1}] "${n}"`).join("\n") : "(empty: you were told nothing)"}\n\nPROBLEM:\n${problem}` },
    ],
  });
  onCall?.({ role: "solver", model: MODELS.writer, ms: r.ms, usage: r.usage });
  // note numbers belong in `notes`; the learner sees the sources when clicking a step
  const steps = r.data.steps.slice(0, 5).map((s) => ({ text: s.text.replace(/\s*\((?:notes?\s*)?\d+(?:\s*(?:,|and)\s*\d+)*\)|\s*\[\d+(?:\s*,\s*\d+)*\]/gi, "").trim().slice(0, 500), notes: [...new Set(s.notes)].filter((n) => n >= 1 && n <= notes.length) }));
  if (!steps.length) throw new Error("the solver returned no steps");
  const answer = guess ?? r.data.answer.trim().slice(0, 40);
  if (item.kind === "choice" && LETTERS.indexOf(answer.charAt(0).toUpperCase()) < 0) throw new Error(`the solver's answer is not an option (${answer.slice(0, 40)})`);
  return { steps, answer, correct: isRight(item, answer), notes, leaked: leaks(bundle, item, state, steps), by: "model", gate: g };
}

/** Is Kai's answer the key? A letter for choice problems, a number otherwise. */
export function isRight(item: PracticeItem, answer: string): boolean {
  if (item.kind === "choice") {
    const k = LETTERS.indexOf(answer.trim().charAt(0).toUpperCase());
    return k >= 0 && checkPractice(item, k);
  }
  // "about 867 visitors" counts as 867: the first number Kai wrote
  const n = /-?\d[\d,.]*%?/.exec(answer)?.[0];
  return !!n && parseNumber(n) !== null && checkPractice(item, n);
}

/** Lesson terms in Kai's steps that neither the notes, the learner nor the problem itself brought in. */
function leaks(bundle: Bundle, item: PracticeItem, state: State, steps: Step[]): string[] {
  const given = termsUsed(bundle, `${item.prompt} ${(item.options ?? []).join(" ")} ${notesOf(state).join(" ")}`);
  const seen: State = { ...state, usedTerms: [...state.usedTerms, ...given] };
  return forbiddenTerms(bundle, seen, steps.map((s) => s.text).join(" "));
}

/** A small deterministic hash, so a guess is random-looking but the same for the same notebook. */
function pick(seed: string, n: number): number {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) h = Math.imul(h ^ seed.charCodeAt(i), 16777619);
  return (h >>> 0) % n;
}

/** A wrong answer, chosen at random among the wrong ones: a guess never lands on the key. */
function wrongGuess(item: PracticeItem, seed: string): string {
  if (item.kind === "choice") {
    const wrong = item.options!.map((_, i) => i).filter((i) => i !== item.answer);
    return LETTERS[wrong[pick(seed, wrong.length)]!]!;
  }
  const tol = item.tolerance ?? 0;
  const factors = [0.6, 0.8, 0.92, 1.1, 1.25].filter((f) => Math.abs(item.answer * f - item.answer) > tol * 2);
  return String(Math.round(item.answer * factors[pick(seed, factors.length)]!));
}

/**
 * Offline solver (demo mode, or when the model fails or answers right without
 * the facts): Kai follows the worked solution while the notebook holds what each
 * step needs, and goes wrong at the first step whose needed fact is missing or
 * contradicted by a misconception, quoting what it was told; its answer is then
 * a guess among the wrong ones.
 */
export function offlineSolve(bundle: Bundle, item: PracticeItem, state: State): Solution {
  const notes = notesOf(state);
  const facts = latest(state);
  const g = gate(item, state);
  const misledIdeas = new Set(activeMisconceptions(state).map((m) => m.node));
  const steps: Step[] = [];
  let broken = false;
  for (const s of item.steps) {
    const gap = s.facts.find((f) => g.needs.includes(f) && (g.missing.includes(f) || misledIdeas.has(f.split(".")[0]!)));
    if (!gap || g.canBeRight) {
      const cite = s.facts.map((f) => (facts.get(f) ? notes.indexOf(facts.get(f)!.words) + 1 : 0)).filter((n) => n > 0);
      steps.push({ text: s.text, notes: [...new Set(cite)] });
      continue;
    }
    const told = facts.get(gap);
    const belief = activeMisconceptions(state).filter((m) => m.node === gap.split(".")[0]).at(-1);
    // a stated misconception about this idea wins over a vague or wrong statement of the fact
    const words = belief?.words ?? (told && told.verdict !== "correct" ? told.words : undefined);
    steps.push(
      words
        ? { text: `You told me: "${words}". So I go with that here.`, notes: [notes.indexOf(words) + 1].filter((n) => n > 0) }
        : { text: "You didn't tell me how this part works, so I'll have to guess.", notes: [] },
    );
    broken = true;
    break;
  }
  if (!g.canBeRight && !broken) {
    steps.push({ text: "You didn't tell me how this part works, so I'll have to guess.", notes: [] });
    broken = true;
  }
  const answer = g.canBeRight ? (item.kind === "choice" ? LETTERS[item.answer]! : String(Math.round(item.answer * 100) / 100)) : wrongGuess(item, `${item.id}|${notes.join("|")}`);
  if (broken) steps.push({ text: `So my answer is ${item.kind === "choice" ? answer : answer + (item.unit ? ` ${item.unit}` : "")}.`, notes: [] });
  return { steps, answer, correct: isRight(item, answer), notes, leaked: [], by: "offline", gate: g };
}

/**
 * The model's attempt, or the offline one if there is no model, the model fails,
 * or the model got it right without the facts it needs (the gate's safety net).
 */
export async function solve(
  bundle: Bundle,
  item: PracticeItem,
  state: State,
  opts: { demo: boolean; onCall?: OnCall; onError?: (e: unknown) => void; model?: typeof llmSolve },
): Promise<Solution> {
  if (opts.demo) return offlineSolve(bundle, item, state);
  try {
    const s = await (opts.model ?? llmSolve)(bundle, item, state, opts.onCall);
    if (s.correct && !s.gate.canBeRight) throw new Error(`right without the facts it needs (missing ${s.gate.missing.join(", ") || "none"}, misled ${s.gate.misled.length})`);
    return s;
  } catch (e) {
    opts.onError?.(e);
    return offlineSolve(bundle, item, state);
  }
}
