import { z } from "zod";

// Practice problems (chapter 3). Shared by the server (checking, solutions) and
// tests. Each solution step names the lesson facts it uses, so a later
// "Kai solves it" mode can build Kai's solution from the learner's notebook.

// recursive feedback: one planted misreading of a problem (see `caveat` below)
export const Caveat = z.object({
  id: z.string().optional(),
  about: z.string().min(10),
  misreading: z.string().min(10),
  answer: z.number(),
  covered: z.string().min(3),
  requires: z.array(z.string()).optional(),
  ideas: z.array(z.string()).optional(),
  alone: z.boolean().optional(),
  always: z.boolean().optional(),
  opening: z.string().optional(),
});
export type Caveat = z.infer<typeof Caveat>;

export const PracticeItem = z
  .object({
    id: z.string(),
    round: z.number().int().min(1).max(3).default(1), // round 2 repeats round 1's ideas in new settings
    idea: z.string().optional(), // which idea it practises (greedy, epsilon, ucb), to pair items across rounds
    // recursive feedback: the facts without which the answer can't be reached. Kai can only be right when its
    // notebook holds all of them, correctly explained (engine/tutor/solve.ts, gate). "a|b": either fact carries the
    // rule (UCB's "average plus bonus, pick the highest" is n11.f1 or n11.f2). Default: every step's facts.
    needs: z.array(z.string()).min(1).optional(),
    // recursive feedback: Kai's assumption for a needed fact (the fact's `assume` in the graph, word for word) and the
    // answer it leads to here. When Kai lacks the fact, it says it is guessing and reasons from this, so its wrong
    // answer follows from its own reasoning. `when`: only for a fact Kai was told nothing about ("absent") or only
    // vaguely ("vague", the fact's `assumeVague`); unset, both. A vague reading may lead to the key: then a vague
    // explanation is enough for this problem.
    beliefs: z.array(z.object({ replaces: z.string(), belief: z.string(), answer: z.number(), when: z.enum(["absent", "vague"]).optional() })).optional(),
    // recursive feedback: the problem's caveat (2026-11-05), a nuance learners rarely put into words (`about`). When Kai
    // would otherwise solve every problem, its first try at the first problem whose caveat its notes leave open reads
    // the gap the plausible wrong way (`misreading`, leading to `answer`); never against what the notes say. `covered`:
    // a pattern for notes that say it (screened in code; the solver model makes the final call and then follows them).
    // Several (2026-11-16, P7): tried in order, the first the notes leave open is in play; `id` names it in the log,
    // `requires` the facts Kai must have a note on for the misreading to make sense (it reads that note the wrong way),
    // `ideas` the ideas (node ids) whose notes `covered` reads (else every note: "every time" in a note on UCB's bonus
    // isn't greedy switching), `alone` puts it in play whenever Kai could solve this problem, whatever the problems
    // after it, `always` whenever Kai could solve this problem, whatever came before or after and on the retry too
    // (2026-11-16, P8's slowing: a part of a fact the judge may credit without it, so the gate's backstop rather than
    // a planted slip), and `opening` is the offline attempt's first step (else the worked solution's).
    caveat: z.union([Caveat, z.array(Caveat).min(1)]).optional(),
    title: z.string(),
    kind: z.enum(["choice", "number"]),
    prompt: z.string(),
    options: z.array(z.string()).min(2).max(6).optional(),
    unit: z.string().optional(),
    answer: z.number(),
    tolerance: z.number().min(0).optional(),
    steps: z.array(z.object({ text: z.string(), facts: z.array(z.string()) })).min(1),
  })
  .refine((p) => (p.kind === "choice" ? !!p.options && Number.isInteger(p.answer) && p.answer < p.options.length : true), "choice items need options and a valid answer index");
export type PracticeItem = z.infer<typeof PracticeItem>;

/** A problem's planted misreadings, in the order they are tried (none, one, or a list). */
export const caveatsOf = (item: PracticeItem): Caveat[] => (item.caveat ? (Array.isArray(item.caveat) ? item.caveat : [item.caveat]) : []);

export const PracticeFile = z.object({ title: z.string(), minutes: z.number().positive(), items: z.array(PracticeItem).min(1) });

/** Parse a typed answer: "0.85", "85%", "1,234", "0,85", "≈ 210" all work. */
export function parseNumber(raw: string): number | null {
  const s = raw.trim().replace(/[≈~\s]/g, "").replace(/(\d),(\d{3})\b/g, "$1$2").replace(",", ".");
  const m = /^(-?\d+(?:\.\d+)?)(%)?$/.exec(s);
  if (!m) return null;
  const v = Number(m[1]);
  return m[2] ? v / 100 : v;
}

export function checkPractice(item: PracticeItem, answer: string | number): boolean {
  if (item.kind === "choice") return Number(answer) === item.answer;
  return checkNumber(answer, item.answer, item.tolerance);
}

/** A typed number against its key (practice and the final test). */
export function checkNumber(answer: string | number, key: number, tolerance?: number): boolean {
  const v = typeof answer === "number" ? answer : parseNumber(answer);
  if (v === null) return false;
  const tol = tolerance ?? 1e-9;
  // a probability may be typed as a percentage without the % sign ("85")
  return Math.abs(v - key) <= tol + 1e-9 || (key > 0 && key <= 1 && Math.abs(v / 100 - key) <= tol + 1e-9);
}
