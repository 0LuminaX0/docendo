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
// the worked solution, so Kai's mistakes come from the teaching. Each step
// cites the notes it relies on; the learner sees those notes when they click a
// step. Without a model (demo mode) or when the model fails, an offline solver
// builds Kai's attempt from which of the problem's facts the notebook holds.

export type Step = { text: string; notes: number[] };
export type Solution = {
  steps: Step[];
  answer: string; // option letter, or the number as Kai wrote it
  correct: boolean;
  notes: string[]; // Kai's notebook as numbered for this attempt (note n = notes[n - 1])
  leaked: string[]; // lesson terms Kai used that the learner never taught or used (for the log)
  by: "model" | "offline";
};

const LETTERS = "ABCDEF";

/** Kai's notes, numbered: the latest word on each fact (vague ones marked), then the misconceptions it was told. */
export function notesOf(state: State): string[] {
  const out: string[] = [];
  for (const e of latest(state).values()) out.push(e.words);
  for (const m of activeMisconceptions(state)) if (!out.includes(m.words)) out.push(m.words);
  return out.slice(-40);
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
- Do the arithmetic the problem needs, as your notes suggest it.
- answer: the letter of the option you choose (A, B, …), or just the number for a number question.`;

export async function llmSolve(bundle: Bundle, item: PracticeItem, state: State, onCall?: OnCall): Promise<Solution> {
  const notes = notesOf(state);
  const problem =
    item.kind === "choice"
      ? `${item.prompt}\n\nOptions:\n${item.options!.map((o, i) => `${LETTERS[i]}) ${o}`).join("\n")}`
      : `${item.prompt}\n\nAnswer with a number${item.unit ? ` (in ${item.unit})` : ""}.`;
  const r = await chatJson({
    model: MODELS.writer,
    name: "solution",
    schema: Reply,
    temperature: 0.3,
    maxTokens: 900,
    // the learner is waiting: a slow model gives way to the offline attempt (and the route's 60 s limit holds)
    timeoutMs: 15_000,
    retries: 1,
    messages: [
      { role: "system", content: SYSTEM },
      { role: "user", content: `YOUR NOTES:\n${notes.length ? notes.map((n, i) => `[${i + 1}] "${n}"`).join("\n") : "(empty: you were told nothing)"}\n\nPROBLEM:\n${problem}` },
    ],
  });
  onCall?.({ role: "solver", model: MODELS.writer, ms: r.ms, usage: r.usage });
  // note numbers belong in `notes`; the learner sees the sources when clicking a step
  const steps = r.data.steps.slice(0, 5).map((s) => ({ text: s.text.replace(/\s*\((?:notes?\s*)?\d+(?:\s*(?:,|and)\s*\d+)*\)|\s*\[\d+(?:\s*,\s*\d+)*\]/gi, "").trim().slice(0, 500), notes: [...new Set(s.notes)].filter((n) => n >= 1 && n <= notes.length) }));
  if (!steps.length) throw new Error("the solver returned no steps");
  const answer = r.data.answer.trim().slice(0, 40);
  return { steps, answer, correct: isRight(item, answer), notes, leaked: leaks(bundle, item, state, steps), by: "model" };
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

/**
 * Offline solver (demo mode, or when the model fails): Kai follows the worked
 * solution while the notebook holds each step's facts, and goes wrong at the
 * first step whose fact is missing or was taught wrongly, quoting what it was
 * told. It never sees more than the model does in spirit: the step it gets
 * wrong is exactly where the notebook falls short.
 */
export function offlineSolve(bundle: Bundle, item: PracticeItem, state: State): Solution {
  const notes = notesOf(state);
  const facts = latest(state);
  const steps: Step[] = [];
  let broken = false;
  for (const s of item.steps) {
    const gap = s.facts.find((f) => facts.get(f)?.verdict !== "correct");
    if (!gap) {
      const cite = s.facts.map((f) => notes.indexOf(facts.get(f)!.words) + 1).filter((n) => n > 0);
      steps.push({ text: s.text, notes: [...new Set(cite)] });
      continue;
    }
    const told = facts.get(gap);
    const idea = gap.split(".")[0];
    const belief = activeMisconceptions(state).filter((m) => m.node === idea).at(-1);
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
  let answer: string;
  if (!broken) answer = item.kind === "choice" ? LETTERS[item.answer]! : String(Math.round(item.answer * 100) / 100);
  else if (item.kind === "choice") answer = LETTERS[(item.answer + 1) % item.options!.length]!;
  else answer = String(Math.round(item.answer * 0.92));
  if (broken) steps.push({ text: `So my answer is ${item.kind === "choice" ? answer : answer + (item.unit ? ` ${item.unit}` : "")}.`, notes: [] });
  return { steps, answer, correct: isRight(item, answer), notes, leaked: [], by: "offline" };
}

/** The model's attempt, or the offline one if there is no model or it fails. */
export async function solve(bundle: Bundle, item: PracticeItem, state: State, opts: { demo: boolean; onCall?: OnCall; onError?: (e: unknown) => void }): Promise<Solution> {
  if (opts.demo) return offlineSolve(bundle, item, state);
  try {
    return await llmSolve(bundle, item, state, opts.onCall);
  } catch (e) {
    opts.onError?.(e);
    return offlineSolve(bundle, item, state);
  }
}
