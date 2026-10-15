import "server-only";
import { createHash } from "node:crypto";
import { z } from "zod";
import bundleJson from "../../topics/bandits/bundle.json";
import exercisesJson from "../../topics/bandits/exercises.json";
import practiceJson from "../../topics/bandits/practice.json";
import pretestJson from "../../topics/bandits/pretest.json";
import { Bundle } from "../../content/schema";
import { PracticeFile, checkNumber, checkPractice } from "../../content/practice";
import { BOX_H, BOX_W, layout, routePath } from "../../content/layout";
import { config } from "./env";

// The MVP serves one topic. To switch topics, point these imports at another
// topics/<slug>/ folder after running `pnpm content bundle <slug>`.

export const bundle: Bundle = Bundle.parse(bundleJson);

const Exercise = z
  .object({
    id: z.string(),
    goal: z.string(),
    type: z.string(),
    section: z.string(),
    kind: z.enum(["choice", "number"]).default("choice"), // pick an option, or type a number
    prompt: z.string(),
    options: z.array(z.string()).min(2).max(6).optional(),
    unit: z.string().optional(),
    answer: z.number(), // choice: the option's index; number: the value
    tolerance: z.number().min(0).optional(),
    explain: z.string(),
  })
  .refine((q) => (q.kind === "choice" ? !!q.options && Number.isInteger(q.answer) && q.answer >= 0 && q.answer < q.options.length : !q.options), "choice items need options and a valid key; number items have none");
export const exercises = z.object({ title: z.string(), items: z.array(Exercise).min(1) }).parse(exercisesJson).items;

/** A fingerprint of the test's content, logged with every graded test: answers to an edited item stay apart. */
export const testVersion = createHash("sha1").update(JSON.stringify(exercises)).digest("hex").slice(0, 8);

/** Grade one answer: an option's index, or a typed number. */
export function checkExercise(q: (typeof exercises)[number], a: number | string | null): boolean {
  if (a === null) return false;
  return q.kind === "choice" ? a === q.answer : checkNumber(String(a), q.answer, q.tolerance);
}
/** The key as the results page shows it. */
export const keyText = (q: (typeof exercises)[number]) => (q.kind === "choice" ? q.options![q.answer]! : `${q.answer}${q.unit ? ` ${q.unit}` : ""}`);

/** What the browser may see before grading: no answers, no explanations. */
export const publicExercises = exercises.map(({ id, section, kind, prompt, options, unit }) => ({ id, section, kind, prompt, options: options ?? null, unit: unit ?? null }));
export type PublicExercise = (typeof publicExercises)[number];

// ---------- pretest (before the video) ----------

const PretestItem = z.object({
  id: z.string(),
  kind: z.enum(["background", "knowledge"]),
  prompt: z.string(),
  options: z.array(z.string()).min(2).max(6),
  answer: z.number().int().min(0).optional(), // knowledge items
  exclude: z.number().int().min(0).optional(), // background: this answer flags the session as excluded from the analysis
});
export const pretest = z.object({ title: z.string(), items: z.array(PretestItem).min(1) }).parse(pretestJson).items;
/** No answers, no exclusion rule: the browser only shows the questions. */
export const publicPretest = pretest.map(({ id, prompt, options }) => ({ id, prompt, options }));

// ---------- practice (chapter 3) ----------

const practiceFile = PracticeFile.parse(practiceJson);
export const practice = practiceFile.items;
export const practiceMinutes = config.practiceMinutes ?? practiceFile.minutes;
export { checkPractice };

/** What the browser may see before checking: no answers, no solutions. */
export const publicPractice = practice.map(({ id, round, title, kind, prompt, options, unit }) => ({ id, round, title, kind, prompt, options: options ?? null, unit: unit ?? null }));
export type PublicPractice = (typeof publicPractice)[number];

/** The worked solutions, for the results page: sent only with the graded final test. */
export const practiceReview = practice.map((p) => ({
  id: p.id,
  round: p.round,
  title: p.title,
  prompt: p.prompt,
  options: p.options ?? null,
  // large numbers (visitors, days) as whole numbers, small ones (shares, scores) to two decimals
  answer: p.kind === "choice" ? p.options![p.answer]! : `about ${Math.abs(p.answer) >= 10 ? Math.round(p.answer) : Math.round(p.answer * 100) / 100}${p.unit ? ` ${p.unit}` : ""}`,
  answerIndex: p.kind === "choice" ? p.answer : null,
  steps: p.steps.map((s) => s.text),
}));

/** Video list for the watch page and the help card. */
export const videos = bundle.videos.map((v, i) => ({ ...v, part: i + 1 }));

/**
 * The lesson graph's shape for the "Kai's mind" view: positions, labels and
 * prerequisites only. Fact text and Kai's questions stay on the server.
 */
export const graphView = (() => {
  const l = layout(bundle.nodes);
  // crop to what is drawn: the layout's grid can leave an empty row above and room below
  const ys = [...Object.values(l.pos).flatMap((p) => [p.y, p.y + BOX_H]), ...Object.values(l.routes).flatMap((pts) => pts.map((p) => p.y))];
  const top = Math.max(0, Math.min(...ys) - 16);
  const height = Math.min(l.height, Math.max(...ys) + 16) - top;
  const pos = Object.fromEntries(Object.entries(l.pos).map(([id, p]) => [id, { x: p.x, y: p.y - top }]));
  const routes = Object.fromEntries(Object.entries(l.routes).map(([k, pts]) => [k, pts.map((p) => ({ x: p.x, y: p.y - top }))]));
  const width = l.width;
  return {
    nodes: bundle.nodes.map((n) => ({ id: n.id, label: n.label, kind: n.kind, needs: n.needs, goals: n.goals, inLesson: n.inLesson })),
    // SVG path per prerequisite edge, keyed "from>to"
    edges: Object.entries(routes).map(([key, pts]) => {
      const [from, to] = key.split(">") as [string, string];
      return { from, to, d: routePath(pts) };
    }),
    goals: bundle.goals.map((g) => ({ id: g.id, level: g.level, text: g.text })),
    pos,
    width,
    height,
    box: { w: BOX_W, h: BOX_H },
  };
})();
export type GraphView = typeof graphView;
