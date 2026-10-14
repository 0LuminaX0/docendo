import { z } from "zod";
import type { Bundle } from "../../content/schema";
import { checkPractice, parseNumber, type PracticeItem } from "../../content/practice";
import { chatJson, MODELS, type OnCall } from "../llm";
import { forbiddenTerms } from "./admit";
import { activeMisconceptions, latest, notesOf, type State } from "./state";
import { termsUsed } from "./judge";

// Recursive feedback: Kai solves a practice problem from its notebook alone.
// The solver model sees only the problem and Kai's numbered notes (the
// learner's own words, mistakes included), never the lesson's facts, the key or
// the worked solution. Each step cites the notes it relies on.
//
// A model told to "use only your notes" still reads rules out of the answer
// options or falls back on what it knows, so the code decides when Kai can be
// right: the GATE. Kai can only be right when its notebook holds every fact the
// problem needs (`needs` in practice.json), explained correctly, and it still
// believes no misconception about those ideas. Otherwise Kai's mistake has to
// come from its own reasoning, never from an answer swapped in at the end:
// - a misconception still believed: the model solves freely from the notes, so
//   the misconception leads it astray;
// - a fact missing: Kai reasons from a beginner's wrong rule for that fact (one
//   of the problem's `beliefs`, picked at random), so its wrong answer follows
//   from its steps.
// A right answer without the facts, or an answer that doesn't follow from the
// guess, is replaced by the offline attempt (also built on the guess). Without
// a model (demo mode) or when the model fails, the offline solver answers.

export type Step = { text: string; notes: number[] };
export type Gate = { needs: string[]; missing: string[]; absent: string[]; vague: string[]; misled: string[]; canBeRight: boolean };
export type Guess = { replaces: string; belief: string; answer: number };
export type Solution = {
  steps: Step[];
  answer: string; // option letter, or the number as Kai wrote it
  correct: boolean;
  notes: string[]; // Kai's notebook as numbered for this attempt (note n = notes[n - 1])
  leaked: string[]; // lesson terms Kai used that the learner never taught or used (for the log)
  by: "model" | "offline";
  gate: Gate;
  guess: Guess | null; // the beginner's rule Kai reasoned from, when a needed fact was missing
};

const LETTERS = "ABCDEF";

export { notesOf };

/** A need is a fact id, or alternatives "n11.f1|n11.f2": facts that each carry the rule the problem needs. */
export const alts = (need: string) => need.split("|");
const ideaOf = (fact: string) => fact.split(".")[0]!;

/**
 * Can Kai get this problem right? Only with every need met (one of its facts explained correctly; a vague,
 * partial explanation isn't enough) and no misconception left about the ideas involved.
 */
export function gate(item: PracticeItem, state: State): Gate {
  const needs = item.needs ?? [...new Set(item.steps.flatMap((s) => s.facts))];
  const facts = latest(state);
  const missing = needs.filter((n) => !alts(n).some((f) => facts.get(f)?.verdict === "correct"));
  const ideas = new Set(needs.flatMap(alts).map(ideaOf));
  const believed = activeMisconceptions(state).filter((m) => ideas.has(m.node));
  const misled = believed.map((m) => m.words);
  // a misconception is what Kai was told about its idea: those needs it reasons from, they get no guess
  const open = missing.filter((n) => !believed.some((m) => alts(n).some((f) => ideaOf(f) === m.node)));
  const absent = open.filter((n) => !alts(n).some((f) => facts.has(f))); // told nothing about it
  const vague = open.filter((n) => alts(n).some((f) => facts.has(f))); // told only vaguely (or wrongly) about it
  return { needs, missing, absent, vague, misled, canBeRight: !missing.length && !misled.length };
}

/** A small deterministic hash: a guess is random across notebooks but the same for the same notebook. */
function pick(seed: string, n: number): number {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) h = Math.imul(h ^ seed.charCodeAt(i), 16777619);
  return (h >>> 0) % n;
}

/** The beginner's rule Kai falls back on: one for a fact it was told nothing or only vaguely about, picked at random. */
export function chooseGuess(item: PracticeItem, g: Gate, seed: string): Guess | null {
  const all = item.beliefs ?? [];
  const ideas = new Set(g.misled.length ? (item.needs ?? []).flatMap(alts).map(ideaOf) : []);
  const forMissing = all.filter((b) => [...g.absent, ...g.vague].some((n) => alts(n).includes(b.replaces)));
  const pool = forMissing.length ? forMissing : all.filter((b) => ideas.has(ideaOf(b.replaces)));
  const list = pool.length ? pool : all;
  return list.length ? list[pick(seed, list.length)]! : null;
}

const answerText = (item: PracticeItem, answer: number) =>
  item.kind === "choice" ? `${LETTERS[answer]}) ${item.options![answer]}` : `about ${Math.round(answer)}${item.unit ? ` ${item.unit}` : ""}`;

const Reply = z.object({
  steps: z.array(z.object({ text: z.string(), notes: z.array(z.number().int()) })),
  answer: z.string(),
});

const SYSTEM = `You are Kai, a student who missed a lecture. Everything you know about its topic is in YOUR NOTES: what a classmate told you, in their words. You believe your notes, even where they might be wrong.

Solve the problem using ONLY your notes, thinking aloud like a student:
- Write 3 to 5 steps in the first person. Each step is one or two complete sentences and does one thing: applies one thing from your notes, works something out from the problem, or draws the conclusion. Each step follows from the one before.
- Each step lists in "notes" the numbers of the notes it relies on (none for a step that only uses the problem's numbers). Don't write note numbers in the text.
- Never use knowledge from outside your notes, even if you think you know better: no formulas, rules or technical words that are not in your notes or in the problem.
- The answer options are not notes. Never take a rule from an option's wording: an option only says what someone might answer.
- Do the arithmetic the problem needs, as your notes suggest it.
- In the last step, say your conclusion in words (not as an option number).
- answer: for a question with options, the number of the option you choose (1, 2, 3 or 4); for a number question, just the number.`;

// a misconception or a vague note: the model solves freely, its notes lead it
const UNSURE = `\n\nYour notes may not tell you everything this problem needs. Where they are silent, say so and guess like a beginner; never fill the gap with what you think the right rule is.`;

// a missing fact: Kai's own guess for it, and where that guess leads; the steps must get there honestly
const fromGuess = (guess: Guess, item: PracticeItem, vague: boolean) => `

${vague ? "Your notes are vague about one thing this problem needs, and you understood them this way" : "Your classmate never told you one thing this problem needs. For that part you rely on your own guess"}, which you believe:
"${guess.belief}"
Reason from your notes and this ${vague ? "understanding" : "guess"}, so that your conclusion follows from it: ${conclusion(item, guess.answer)}. When you first use it, say plainly that ${vague ? "this is how you understood what your classmate told you" : "it's your own guess because your classmate didn't tell you this"}. Never weigh other rules, never mention what the right rule might be, and never change your mind at the end.`;

// what the guess leads to, in words (option numbers stay out of Kai's steps)
const conclusion = (item: PracticeItem, answer: number) => (item.kind === "choice" ? `"${item.options![answer]}" (option ${answer + 1})` : `about ${Math.round(answer)}${item.unit ? ` ${item.unit}` : ""}`);

const STRICTER = `\n\nImportant: a previous try didn't follow these rules. Use only your notes and do exactly what is asked above.`;

// signs that the model argued its way to the key and then turned around
const TURNAROUND = /\b(on second thought|actually,? (?:the|it)|the (?:correct|right) (?:answer|rule|option)|(?:but|however),? (?:i(?:'m| am) (?:told|supposed)|i (?:have|need) to (?:pick|choose|go with))|i(?:'ll| will) (?:pick|choose|go with) (?:a |an )?(?:wrong|incorrect|different))/i;

export async function llmSolve(bundle: Bundle, item: PracticeItem, state: State, onCall?: OnCall, stricter = false): Promise<Solution> {
  const notes = notesOf(state);
  const g = gate(item, state);
  // a fact Kai was told nothing or only vaguely about: it reasons from a beginner's reading of it. (A misconception
  // is what it was told: the model reasons from that, and the gate's safety net catches a right answer.)
  const guess = g.absent.length || g.vague.length ? chooseGuess(item, g, `${item.id}|${notes.join("|")}`) : null;
  const vagueGuess = !!guess && g.vague.some((n) => alts(n).includes(guess.replaces));
  // options are numbered for the model: trucks and headlines are named by letters, and "B" must never be ambiguous
  const problem =
    item.kind === "choice"
      ? `${item.prompt}\n\nOptions:\n${item.options!.map((o, i) => `${i + 1}) ${o}`).join("\n")}`
      : `${item.prompt}\n\nAnswer with a number${item.unit ? ` (in ${item.unit})` : ""}.`;
  const r = await chatJson({
    model: MODELS.solver,
    name: "solution",
    schema: Reply,
    temperature: 0.3,
    maxTokens: 1600, // room to finish; a reply that hits it is retried, never cut
    // the learner is waiting: a slow model gives way to the offline attempt (and the route's 60 s limit holds)
    timeoutMs: 18_000,
    retries: 1,
    messages: [
      { role: "system", content: SYSTEM + (guess ? fromGuess(guess, item, vagueGuess) : g.canBeRight ? "" : UNSURE) + (stricter ? STRICTER : "") },
      { role: "user", content: `YOUR NOTES:\n${notes.length ? notes.map((n, i) => `[${i + 1}] "${n}"`).join("\n") : "(empty: you were told nothing)"}\n\nPROBLEM:\n${problem}` },
    ],
  });
  onCall?.({ role: "solver", model: MODELS.solver, ms: r.ms, usage: r.usage });
  // note numbers belong in `notes`; the text is kept whole (the model decides where a step ends)
  const steps = r.data.steps
    .map((s) => ({ text: s.text.replace(/\s*\((?:notes?\s*)?\d+(?:\s*(?:,|and)\s*\d+)*\)|\s*\[\d+(?:\s*,\s*\d+)*\]/gi, "").trim(), notes: [...new Set(s.notes)].filter((n) => n >= 1 && n <= notes.length) }))
    // the model sees the options numbered; the learner sees letters
    .map((s) => ({ ...s, text: item.kind === "choice" ? s.text.replace(/\boption (\d)\b/gi, (m, d: string) => (LETTERS[Number(d) - 1] ? `option ${LETTERS[Number(d) - 1]}` : m)) : s.text }))
    .filter((s) => s.text);
  if (steps.length < 2) throw new Error(`the solver returned ${steps.length} step(s)`);
  if (steps.length > 7) throw new Error(`the solver returned ${steps.length} steps`);
  let answer = r.data.answer.trim().slice(0, 40);
  if (item.kind === "choice") {
    const k = Number(/\d+/.exec(answer)?.[0]) - 1;
    if (!(k >= 0 && k < item.options!.length)) throw new Error(`the solver's answer is not an option (${answer})`);
    answer = LETTERS[k]!;
  }
  if (guess) {
    // the conclusion must be the guess's own, reached without a turnaround
    const lands = item.kind === "choice" ? LETTERS.indexOf(answer) === guess.answer : sameNumber(answer, guess.answer);
    if (!lands) throw new Error(`the solver didn't follow its guess (answered ${answer}, the guess leads to ${answerText(item, guess.answer)})`);
    if (steps.some((s) => TURNAROUND.test(s.text))) throw new Error("the solver argued for another answer and turned around");
  }
  return { steps, answer, correct: isRight(item, answer), notes, leaked: leaks(bundle, item, state, steps), by: "model", gate: g, guess };
}

/** The first number in Kai's answer, within 2% of the expected one. */
function sameNumber(answer: string, expected: number): boolean {
  const n = /-?\d[\d,.]*%?/.exec(answer)?.[0];
  const v = n ? parseNumber(n) : null;
  return v !== null && Math.abs(v - expected) <= Math.max(1, Math.abs(expected) * 0.02);
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

/** The problem's wrong rule that best matches what the learner said (shared content words), if any match. */
function closestBelief(item: PracticeItem, said: string): Guess | null {
  const words = (t: string) => new Set(t.toLowerCase().match(/[a-zε]{4,}/g) ?? []);
  const w = words(said);
  let best: Guess | null = null;
  let score = 0;
  for (const b of item.beliefs ?? []) {
    const n = [...words(b.belief)].filter((x) => w.has(x)).length;
    if (n > score) (best = b, (score = n));
  }
  return score >= 2 ? best : null;
}

/** A wrong answer at random, for a problem without beliefs. */
function wrongAnswer(item: PracticeItem, seed: string): number {
  if (item.kind === "choice") {
    const wrong = item.options!.map((_, i) => i).filter((i) => i !== item.answer);
    return wrong[pick(seed, wrong.length)]!;
  }
  const tol = item.tolerance ?? 0;
  const factors = [0.6, 0.8, 0.92, 1.1, 1.25].filter((f) => Math.abs(item.answer * f - item.answer) > tol * 2);
  return Math.round(item.answer * factors[pick(seed, factors.length)]!);
}

/**
 * Offline solver (demo mode, or when the model fails or doesn't follow the
 * rules): Kai follows the worked solution while the notebook holds what each
 * step needs, and at the first step whose needed fact is missing or
 * contradicted it goes with what it was told (a misconception) or with its own
 * guess, which decides its answer.
 */
export function offlineSolve(bundle: Bundle, item: PracticeItem, state: State): Solution {
  const notes = notesOf(state);
  const facts = latest(state);
  const g = gate(item, state);
  const misledIdeas = new Set(activeMisconceptions(state).map((m) => m.node));
  const seed = `${item.id}|${notes.join("|")}`;
  const guess = g.canBeRight ? null : chooseGuess(item, g, seed);
  const steps: Step[] = [];
  let broken = false;
  let followed: Guess | null = null;
  for (const s of item.steps) {
    const inNeed = (list: string[], f: string) => list.some((n) => alts(n).includes(f));
    const gap = s.facts.find((f) => inNeed(g.needs, f) && (inNeed(g.missing, f) || misledIdeas.has(ideaOf(f))));
    if (!gap || g.canBeRight) {
      const cite = s.facts.map((f) => (facts.get(f) ? notes.indexOf(facts.get(f)!.words) + 1 : 0)).filter((n) => n > 0);
      steps.push({ text: s.text, notes: [...new Set(cite)] });
      continue;
    }
    const told = facts.get(gap);
    const belief = activeMisconceptions(state).filter((m) => m.node === gap.split(".")[0]).at(-1);
    // what Kai was told wins (a misconception, or a wrong statement of the fact); otherwise its own guess
    const words = belief?.words ?? (told && told.verdict === "wrong" ? told.words : undefined);
    if (words) {
      steps.push({ text: `You told me: "${words}". So I go with that here.`, notes: [notes.indexOf(words) + 1].filter((n) => n > 0) });
      // the answer must be the one that follows from what Kai was told: the wrong rule closest in wording to it
      const match = closestBelief(item, words);
      if (match) followed = match;
    }
    else if (told && guess) steps.push({ text: `You only told me vaguely: "${told.words}". I understood it like this: ${guess.belief}`, notes: [notes.indexOf(told.words) + 1].filter((n) => n > 0) });
    else steps.push({ text: guess ? `You didn't tell me how this part works, so I'm guessing: ${guess.belief}` : "You didn't tell me how this part works, so I'll have to guess.", notes: [] });
    broken = true;
    break;
  }
  if (!g.canBeRight && !broken) {
    steps.push({ text: guess ? `You didn't tell me how this part works, so I'm guessing: ${guess.belief}` : "You didn't tell me how this part works, so I'll have to guess.", notes: [] });
    broken = true;
  }
  const value = g.canBeRight ? item.answer : (followed?.answer ?? guess?.answer ?? wrongAnswer(item, seed));
  const answer = item.kind === "choice" ? LETTERS[value]! : String(Math.round(value * 100) / 100);
  if (broken) steps.push({ text: `So my answer is ${answerText(item, value)}.`, notes: [] });
  return { steps, answer, correct: isRight(item, answer), notes, leaked: [], by: "offline", gate: g, guess };
}

/**
 * The model's attempt, or the offline one if there is no model, the model fails,
 * or the model got it right without the facts it needs (the gate's safety net).
 */
export async function solve(
  bundle: Bundle,
  item: PracticeItem,
  state: State,
  opts: { demo: boolean; onCall?: OnCall; onError?: (e: unknown) => void; model?: (b: Bundle, i: PracticeItem, s: State, onCall?: OnCall, stricter?: boolean) => Promise<Solution> },
): Promise<Solution> {
  if (opts.demo) return offlineSolve(bundle, item, state);
  const model = opts.model ?? llmSolve;
  const t0 = Date.now();
  let lastError: unknown = null;
  // a try that breaks the rules gets one more, with a reminder, while there's time (the learner is waiting)
  for (let tryNo = 0; tryNo < 2; tryNo++) {
    if (tryNo === 1 && Date.now() - t0 > 15_000) break;
    try {
      const s = await model(bundle, item, state, opts.onCall, tryNo === 1);
      if (s.correct && !s.gate.canBeRight) throw new Error(`right without the facts it needs (missing ${s.gate.missing.join(", ") || "none"}, misled ${s.gate.misled.length})`);
      return s;
    } catch (e) {
      lastError = e;
      opts.onError?.(e);
      // a timeout or a refused request won't get better by asking again
      if (e instanceof Error && (e.name === "TimeoutError" || /OpenRouter \d/.test(e.message))) break;
    }
  }
  void lastError;
  return offlineSolve(bundle, item, state);
}
