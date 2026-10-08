import { z } from "zod";

// Practice problems (chapter 3). Shared by the server (checking, solutions) and
// tests. Each solution step names the lesson facts it uses, so a later
// "Kai solves it" mode can build Kai's solution from the learner's notebook.

export const PracticeItem = z
  .object({
    id: z.string(),
    round: z.number().int().min(1).max(3).default(1), // round 2 repeats round 1's ideas in new settings
    idea: z.string().optional(), // which idea it practises (greedy, epsilon, ucb), to pair items across rounds
    // recursive feedback: the facts without which the answer can't be reached. Kai can only be right when its
    // notebook holds all of them, correctly explained (engine/tutor/solve.ts, gate). Default: every step's facts.
    needs: z.array(z.string()).min(1).optional(),
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
  const v = typeof answer === "number" ? answer : parseNumber(answer);
  if (v === null) return false;
  const tol = item.tolerance ?? 1e-9;
  // a probability may be typed as a percentage without the % sign ("85")
  return Math.abs(v - item.answer) <= tol || (item.answer > 0 && item.answer <= 1 && Math.abs(v / 100 - item.answer) <= tol);
}
