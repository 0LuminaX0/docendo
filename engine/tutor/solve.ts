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
// - a fact missing: Kai says it is guessing and reasons from its own assumption
//   for that fact (the fact's `assume` in the graph, one per fact, copied into
//   the problem's `beliefs` with the answer it leads to), so its wrong answer
//   follows from its steps and has a named cause. With several facts missing,
//   the first in `needs` order (the order the steps use them) decides. A vague
//   explanation counts as missing, except where the problem lists a vague
//   reading that still leads to the key (the bonus "grows", without "ever more
//   slowly", is enough to see that it grows).
// A right answer without the facts, or an answer that doesn't follow from the
// guess, is replaced by the offline attempt (also built on the guess). Without
// a model (demo mode) or when the model fails, the offline solver answers.

export type Step = { text: string; notes: number[] };
export type Gate = { needs: string[]; missing: string[]; absent: string[]; vague: string[]; misled: string[]; canBeRight: boolean };
export type Guess = { replaces: string; belief: string; answer: number; when?: "absent" | "vague" };
export type Solution = {
  steps: Step[];
  answer: string; // option letter, or the number as Kai wrote it
  correct: boolean;
  notes: string[]; // Kai's notebook as numbered for this attempt (note n = notes[n - 1])
  leaked: string[]; // lesson terms Kai used that the learner never taught or used (for the log)
  by: "model" | "offline";
  gate: Gate;
  guess: Guess | null; // the beginner's rule Kai reasoned from, when a needed fact was missing
  planted?: boolean; // the planted slip: Kai overlooked one of its notes on purpose (the gate was open)
};
export type Slip = NonNullable<PracticeItem["slip"]>;

const LETTERS = "ABCDEF";
const lowerFirst = (t: string) => (/^[A-Z][a-z]/.test(t) ? t.charAt(0).toLowerCase() + t.slice(1) : t).replace(/[.\s]+$/u, "");

export { notesOf };

/** A need is a fact id, or alternatives "n11.f1|n11.f2": facts that each carry the rule the problem needs. */
export const alts = (need: string) => need.split("|");
const ideaOf = (fact: string) => fact.split(".")[0]!;

/** Does this answer (an option index, or a number) count as the key? */
const leadsToKey = (item: PracticeItem, answer: number) => checkPractice(item, item.kind === "choice" ? answer : String(answer));

/** Kai's assumption for a need, as told nothing about it ("absent") or only vaguely ("vague"): the problem's belief for
 * that case, else the one for both. */
export function beliefFor(item: PracticeItem, need: string, how: "absent" | "vague"): Guess | null {
  const mine = (item.beliefs ?? []).filter((b) => alts(need).includes(b.replaces));
  return mine.find((b) => b.when === how) ?? mine.find((b) => !b.when) ?? null;
}

/**
 * Can Kai get this problem right? Only with every need met (one of its facts explained correctly; a vague,
 * partial explanation isn't enough unless the problem's vague reading of it still leads to the key) and no
 * misconception left about the ideas involved.
 */
export function gate(item: PracticeItem, state: State): Gate {
  const needs = item.needs ?? [...new Set(item.steps.flatMap((s) => s.facts))];
  const facts = latest(state);
  const missing = needs.filter((n) => !alts(n).some((f) => facts.get(f)?.verdict === "correct"));
  // a wrong belief blocks the fact it contradicts (one that contradicts none of them blocks nothing; older notebooks,
  // without the fact, block by idea)
  const hits = (m: { node: string; fact?: string | null }, n: string) => alts(n).some((f) => (m.fact === undefined ? ideaOf(f) === m.node : f === m.fact));
  const believed = activeMisconceptions(state).filter((m) => needs.some((n) => hits(m, n)));
  const misled = believed.map((m) => m.words);
  // a misconception is what Kai was told about its fact: those needs it reasons from, they get no guess
  const open = missing.filter((n) => !believed.some((m) => hits(m, n)));
  const absent = open.filter((n) => !alts(n).some((f) => facts.has(f))); // told nothing about it
  const vague = open.filter((n) => alts(n).some((f) => facts.has(f))); // told only vaguely (or wrongly) about it
  // a vague explanation whose reading still gets there is enough for this problem
  const enough = (n: string) => vague.includes(n) && (() => { const b = beliefFor(item, n, "vague"); return !!b && b.when === "vague" && leadsToKey(item, b.answer); })();
  return { needs, missing, absent, vague, misled, canBeRight: !misled.length && missing.every(enough) };
}

/** A small deterministic hash: a guess is random across notebooks but the same for the same notebook. */
function pick(seed: string, n: number): number {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) h = Math.imul(h ^ seed.charCodeAt(i), 16777619);
  return (h >>> 0) % n;
}

/**
 * The assumption Kai reasons from when the gate is shut: for the first need in `needs` order (the order the steps use
 * them) that Kai was told nothing or only vaguely about and whose assumption leads to a wrong answer. Deterministic, so
 * the same notebook always fails at the same place. Without one (content without beliefs, or only a misconception
 * shuts the gate), a beginner's rule picked at random as before.
 */
export function chooseGuess(item: PracticeItem, g: Gate, seed: string): Guess | null {
  for (const n of g.needs) {
    const how = g.absent.includes(n) ? "absent" : g.vague.includes(n) ? "vague" : null;
    if (!how) continue;
    const b = beliefFor(item, n, how);
    if (b && !leadsToKey(item, b.answer)) return b;
  }
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
- Write 2 to 5 steps in the first person: as many as your notes give you something to work with, so only 2 or 3 when they say little. Each step is one or two complete sentences and does one thing: applies one thing from your notes, works something out from the problem, or draws the conclusion. Each step follows from the one before.
- Each step lists in "notes" the numbers of the notes it relies on (none for a step that only uses the problem's numbers). Don't write note numbers in the text.
- Never use knowledge from outside your notes, even if you think you know better: no formulas, rules or technical words that are not in your notes or in the problem.
- The answer options are not notes. Never take a rule from an option's wording: an option only says what someone might answer.
- Do the arithmetic the problem needs, as your notes suggest it.
- When you compare two totals made of parts, say for each part which of the two is ahead. If the same one is ahead in every part, its total is larger, whatever the exact sizes: say so, and don't call it undecided. Only when different parts favour different ones can the exact sizes matter.
- In the last step, say your conclusion in words (not as an option number).
- answer: for a question with options, the number of the option you choose (1, 2, 3 or 4); for a number question, just the number.`;

// a misconception or a vague note: the model solves freely, its notes lead it
const UNSURE = `\n\nYour notes may not tell you everything this problem needs. Where they are silent, say so and guess like a beginner; never fill the gap with what you think the right rule is.`;

// a guess is a beginner's hunch, not a rule: said once, briefly and unsure, in Kai's own words, and without blaming the
// classmate. With next to nothing in the notes Kai keeps it short: a beginner doing their best, not a worked solution
const HUNCH = (hunch: string | undefined, thin: boolean) =>
  `\n\nHow you say it: as a hunch, once, in your own plain words, short and unsure${hunch ? `, for example: "${hunch}"` : ""}. Don't recite it as a rule, and don't blame your classmate ("you never told me"): it's your notes that are thin on this.` +
  (thin ? ` Your notes have little or nothing for this problem, so keep the whole thing short and simple: 2 or 3 steps, no long working, like someone trying their best with little to go on.` : "");

// a missing fact: Kai's own guess for it, and where that guess leads; the steps must get there honestly
const fromGuess = (guess: Guess, item: PracticeItem, vague: boolean) => `

${vague ? "Your notes are vague about one thing this problem needs, and you understood them this way" : "Your notes say nothing about one thing this problem needs. For that part you go with your own guess"}, which you believe:
"${guess.belief}"
Reason from your notes and this ${vague ? "understanding" : "guess"}, so that your conclusion follows from it: ${conclusion(item, guess.answer)}. When you first use it, say plainly that ${vague ? "this is how you understood your notes" : "it's your own guess, since your notes don't cover it"}. Never weigh other rules, never mention what the right rule might be, and never change your mind at the end.`;

/** How Kai words its guess: the hunch the graph pairs with that assumption (assume → hunch, assumeVague → hunchVague). */
export function hunchFor(bundle: Bundle, guess: Guess): string | undefined {
  const f = bundle.nodes.flatMap((n) => n.facts).find((x) => x.id === guess.replaces);
  return guess.belief === f?.assumeVague ? f?.hunchVague : guess.belief === f?.assume ? f?.hunch : undefined;
}

// what the guess leads to, in words (option numbers stay out of Kai's steps)
const conclusion = (item: PracticeItem, answer: number) => (item.kind === "choice" ? `"${item.options![answer]}" (option ${answer + 1})` : `about ${Math.round(answer)}${item.unit ? ` ${item.unit}` : ""}`);

/** The longest one try at solving can take (llmSolve: two attempts of 18 s). */
export const SOLVE_TRY_MS = 37_000;

const STRICTER = `\n\nImportant: a previous try went wrong. Use only your notes, do exactly what is asked above, and check each comparison and calculation before you conclude.`;

// signs that the model argued its way to the key and then turned around
const TURNAROUND = /\b(on second thought|actually,? (?:the|it)|the (?:correct|right) (?:answer|rule|option)|(?:but|however),? (?:i(?:'m| am) (?:told|supposed)|i (?:have|need) to (?:pick|choose|go with))|i(?:'ll| will) (?:pick|choose|go with) (?:a |an )?(?:wrong|incorrect|different))/i;

// the planted slip: one honest mistake with the notes in hand, said with confidence (never "I'm guessing")
const SLIP = (slip: Slip, item: PracticeItem) =>
  `\n\nIn this attempt you make one honest slip, the way a student does: at the step that compares the options you overlook what one of your notes says, and you reason like this: "${slip.says}" Don't say you're guessing or that your notes are silent: you believe you're right. Cite your notes for the other steps as usual. Your answer is the one this slip leads to: ${conclusion(item, slip.answer)}.`;

export async function llmSolve(bundle: Bundle, item: PracticeItem, state: State, onCall?: OnCall, stricter = false, slip?: Slip): Promise<Solution> {
  const notes = notesOf(state);
  const g = gate(item, state);
  // a fact Kai was told nothing or only vaguely about: it reasons from a beginner's reading of it. (A misconception
  // is what it was told: the model reasons from that, and the gate's safety net catches a right answer.)
  const guess = !g.canBeRight && (g.absent.length || g.vague.length) ? chooseGuess(item, g, `${item.id}|${notes.join("|")}`) : null;
  const vagueGuess = !!guess && g.vague.some((n) => alts(n).includes(guess.replaces));
  // thin: the notebook meets none of the problem's needs
  const thin = g.missing.length === g.needs.length;
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
    maxTokens: 2200, // room to finish; a reply that hits it is retried, never cut
    // the learner is waiting: a slow model gives way to the offline attempt (and the route's 60 s limit holds)
    timeoutMs: 18_000,
    retries: 1,
    messages: [
      { role: "system", content: SYSTEM + (slip ? SLIP(slip, item) : guess ? fromGuess(guess, item, vagueGuess) + HUNCH(hunchFor(bundle, guess), thin) : g.canBeRight ? "" : UNSURE) + (stricter && !slip ? STRICTER : "") },
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
  if (slip) {
    const lands = item.kind === "choice" ? LETTERS.indexOf(answer) === slip.answer : sameNumber(answer, slip.answer);
    if (!lands) throw new Error(`the solver didn't make its planted slip (answered ${answer})`);
    if (steps.some((s) => TURNAROUND.test(s.text))) throw new Error("the solver argued for another answer and turned around");
    return { steps, answer, correct: isRight(item, answer), notes, leaked: leaks(bundle, item, state, steps), by: "model", gate: g, guess: null, planted: true };
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
export function offlineSolve(bundle: Bundle, item: PracticeItem, state: State, slip?: Slip): Solution {
  const notes = notesOf(state);
  const facts = latest(state);
  const g = gate(item, state);
  if (slip) {
    // the planted slip: the worked solution up to the step that needs the overlooked note, then the slip, sure of itself
    const steps: Step[] = [];
    for (const s of item.steps) {
      if (s.facts.includes(slip.need)) break;
      const cite = s.facts.map((f) => (facts.get(f) ? notes.indexOf(facts.get(f)!.words) + 1 : 0)).filter((n) => n > 0);
      steps.push({ text: s.text, notes: [...new Set(cite)] });
    }
    steps.push({ text: slip.says, notes: [] });
    steps.push({ text: item.kind === "choice" ? `So I'd say ${LETTERS[slip.answer]}: ${lowerFirst(item.options![slip.answer]!)}.` : `So I'd say ${answerText(item, slip.answer)}.`, notes: [] });
    const answer = item.kind === "choice" ? LETTERS[slip.answer]! : String(slip.answer);
    return { steps, answer, correct: isRight(item, answer), notes, leaked: [], by: "offline", gate: g, guess: null, planted: true };
  }
  // as in the gate: a wrong belief blocks the fact it contradicts (none: nothing; older notebooks: its idea)
  const blocking = activeMisconceptions(state).filter((m) => m.fact !== null);
  const misledOn = (f: string) => blocking.some((m) => (m.fact === undefined ? m.node === ideaOf(f) : m.fact === f));
  const seed = `${item.id}|${notes.join("|")}`;
  const guess = g.canBeRight ? null : chooseGuess(item, g, seed);
  const steps: Step[] = [];
  let broken = false;
  let followed: Guess | null = null;
  const inNeed = (list: string[], f: string) => list.some((n) => alts(n).includes(f));
  // where Kai goes wrong: the first step that uses the fact it is guessing about, or an idea it was told wrongly about
  const fails = (f: string) => inNeed(g.needs, f) && (guess ? f === guess.replaces || misledOn(f) : inNeed(g.missing, f) || misledOn(f));
  for (const s of item.steps) {
    const gap = s.facts.find(fails);
    if (!gap || g.canBeRight) {
      const cite = s.facts.map((f) => (facts.get(f) ? notes.indexOf(facts.get(f)!.words) + 1 : 0)).filter((n) => n > 0);
      steps.push({ text: s.text, notes: [...new Set(cite)] });
      continue;
    }
    const told = facts.get(gap);
    const belief = blocking.filter((m) => (m.fact === undefined ? m.node === ideaOf(gap) : m.fact === gap)).at(-1);
    // what Kai was told wins (a misconception, or a wrong statement of the fact); otherwise its own guess
    const words = belief?.words ?? (told && told.verdict === "wrong" ? told.words : undefined);
    if (words) {
      steps.push({ text: `My notes say “${words.replace(/[.!\s]+$/u, "")}”, so I'll go by that here.`, notes: [notes.indexOf(words) + 1].filter((n) => n > 0) });
      // the answer must be the one that follows from what Kai was told: the wrong rule closest in wording to it
      const match = closestBelief(item, words);
      if (match) followed = match;
    }
    else if (told && guess) steps.push({ text: `My notes only say "${told.words}". ${hunchFor(bundle, guess) ?? `I understood it like this: ${guess.belief}`}`, notes: [notes.indexOf(told.words) + 1].filter((n) => n > 0) });
    else steps.push({ text: guess ? `My notes don't cover this part. ${hunchFor(bundle, guess) ?? `I'm guessing: ${guess.belief}`}` : "My notes don't cover this part, so I'll have to guess.", notes: [] });
    broken = true;
    break;
  }
  if (!g.canBeRight && !broken) {
    steps.push({ text: guess ? `My notes don't cover this part. ${hunchFor(bundle, guess) ?? `I'm guessing: ${guess.belief}`}` : "My notes don't cover this part, so I'll have to guess.", notes: [] });
    broken = true;
  }
  const value = g.canBeRight ? item.answer : (followed?.answer ?? guess?.answer ?? wrongAnswer(item, seed));
  const answer = item.kind === "choice" ? LETTERS[value]! : String(Math.round(value * 100) / 100);
  // guessing: "my best guess"; going by what Kai was told: "I'd say"
  const lead = followed ? "So I'd say" : "So my best guess is";
  if (broken) steps.push({ text: item.kind === "choice" ? `${lead} ${LETTERS[value]}: ${lowerFirst(item.options![value]!)}.` : `${lead} ${answerText(item, value)}.`, notes: [] });
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
  // deadline: when the caller must have its answer (the practice route: 55 s after the request came in)
  // slip: the planted slip, for this attempt (the caller decides: app/api/practice/route.ts)
  opts: { demo: boolean; onCall?: OnCall; onError?: (e: unknown) => void; deadline?: number; slip?: Slip; model?: (b: Bundle, i: PracticeItem, s: State, onCall?: OnCall, stricter?: boolean, slip?: Slip) => Promise<Solution> },
): Promise<Solution> {
  if (opts.demo) return offlineSolve(bundle, item, state, opts.slip);
  const model = opts.model ?? llmSolve;
  const t0 = Date.now();
  let lastError: unknown = null;
  // a try that breaks the rules gets another, with a reminder, while there's time (the learner is waiting; the route
  // has 60 s for a correction's judge and these tries). Breaking the rules: right without the facts it needs, or
  // wrong with them (the gate open: the notebook holds every needed fact and no wrong belief about them, so a wrong
  // answer is the model's slip, not the learner's teaching, and the learner mustn't be marked down for it). When the
  // tries run out the offline attempt answers, which follows the worked solution exactly that far.
  // a retry starts only when a whole try still fits before the deadline (a try: two model attempts of 18 s at most)
  const deadline = opts.deadline ?? t0 + 55_000;
  for (let tryNo = 0; tryNo < 3; tryNo++) {
    if (tryNo > 0 && deadline - Date.now() < SOLVE_TRY_MS) break;
    try {
      const s = await model(bundle, item, state, opts.onCall, tryNo > 0, opts.slip);
      if (opts.slip) return s; // checked in llmSolve: it lands on the slip's answer
      if (s.correct && !s.gate.canBeRight) throw new Error(`right without the facts it needs (missing ${s.gate.missing.join(", ") || "none"}, misled ${s.gate.misled.length})`);
      if (!s.correct && s.gate.canBeRight) throw new Error(`wrong with every fact it needs (answered ${s.answer}): a slip`);
      return s;
    } catch (e) {
      lastError = e;
      opts.onError?.(e);
      // a timeout or a refused request won't get better by asking again
      if (e instanceof Error && (e.name === "TimeoutError" || /OpenRouter \d/.test(e.message))) break;
    }
  }
  void lastError;
  return offlineSolve(bundle, item, state, opts.slip);
}

/**
 * The planted slip (2026-11-05): Kai's first try on the problem that carries one, when the learner taught well enough
 * that Kai would solve every problem (the gate open for each, its notebook as it stands) and Kai hasn't been wrong yet
 * in practice. Kai is a student: with good notes it can still overlook one, and the learner is told so before practice.
 */
export function plantSlip(items: PracticeItem[], item: PracticeItem, state: State, wrongSoFar: number): Slip | undefined {
  if (!item.slip || wrongSoFar > 0) return undefined;
  return items.every((p) => gate(p, state).canBeRight) ? item.slip : undefined;
}
