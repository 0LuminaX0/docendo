import "server-only";
import { createHash } from "node:crypto";
import { z } from "zod";
import { Bundle } from "../../content/schema";
import { PracticeFile, checkNumber, checkPractice } from "../../content/practice";
import { BOX_H, BOX_W, layout, routePath } from "../../content/layout";
import { DEFAULT_TOPIC, RAW_PACKS } from "./topics";
import { makeMoments } from "./moments";
import { SurveyItem, TopicCopy } from "../settings";

// A topic pack, parsed and ready to serve (lib/server/topics.ts lists the packs). Every route and page asks for the
// pack it needs: a session's own (its token names the topic it started with), or the study's current one (Settings).
// Built once per topic and kept.

const Exercise = z
  .object({
    id: z.string(),
    goal: z.string(),
    type: z.string(),
    section: z.string(),
    form: z.enum(["A", "B"]).default("A"), // two parallel forms: one for the final test, the other for the delayed test
    pair: z.string().optional(), // a form B item: its twin in form A
    kind: z.enum(["choice", "number"]).default("choice"), // pick an option, or type a number
    prompt: z.string(),
    options: z.array(z.string()).min(2).max(6).optional(),
    unit: z.string().optional(),
    answer: z.number(), // choice: the option's index; number: the value
    tolerance: z.number().min(0).optional(),
    explain: z.string(),
  })
  .refine((q) => (q.kind === "choice" ? !!q.options && Number.isInteger(q.answer) && q.answer >= 0 && q.answer < q.options.length : !q.options), "choice items need options and a valid key; number items have none");
export type Exercise = z.infer<typeof Exercise>;
export type Form = "A" | "B";
export const FORMS: Form[] = ["A", "B"];
export const otherForm = (form: Form): Form => (form === "A" ? "B" : "A");

const PretestItem = z.object({
  id: z.string(),
  kind: z.enum(["background", "knowledge"]),
  prompt: z.string(),
  options: z.array(z.string()).min(2).max(6),
  answer: z.number().int().min(0).optional(), // knowledge items
  exclude: z.number().int().min(0).optional(), // background: this answer flags the session as excluded from the analysis
});

/** Grade one answer: an option's index, or a typed number. */
export function checkExercise(q: Exercise, a: number | string | null): boolean {
  if (a === null) return false;
  return q.kind === "choice" ? a === q.answer : checkNumber(String(a), q.answer, q.tolerance);
}
/** The key as the results page shows it. */
export const keyText = (q: Exercise) => (q.kind === "choice" ? q.options![q.answer]! : `${q.answer}${q.unit ? ` ${q.unit}` : ""}`);
export { checkPractice };

function build(slug: string) {
  const raw = RAW_PACKS[slug];
  if (!raw) throw new Error(`No topic pack "${slug}" (lib/server/topics.ts)`);
  const bundle: Bundle = Bundle.parse(raw.bundle);
  const exercises = z.object({ title: z.string(), items: z.array(Exercise).min(1) }).parse(raw.exercises).items;
  const pretest = z.object({ title: z.string(), items: z.array(PretestItem).min(1) }).parse(raw.pretest).items;
  const practiceFile = PracticeFile.parse(raw.practice);
  const practice = practiceFile.items;
  const survey = z.object({ items: z.array(SurveyItem) }).parse(raw.survey).items;
  const copy = TopicCopy.parse(raw.copy);
  const formItems = (form: Form) => exercises.filter((q) => q.form === form);
  const forms = FORMS.filter((f) => formItems(f).length > 0);
  let graph: GraphView | null = null;

  return {
    slug,
    title: bundle.title,
    copy,
    bundle,
    exercises,
    /** The test forms this pack has (a follow-up test needs two). */
    forms,
    /** One form's items, in file order (the order the server grades in). */
    formItems,
    /** A fingerprint of a form's content, logged with every graded test: answers to an edited item stay apart. */
    testVersion: (form: Form) => createHash("sha1").update(JSON.stringify(formItems(form))).digest("hex").slice(0, 8),
    /** What the browser may see before grading: one form's questions, no answers, no explanations. Sent per session
     * (the learner's form only), so the other form's questions aren't in the page before the delayed test. */
    publicExercises: (form: Form) => formItems(form).map(({ id, section, kind, prompt, options, unit }) => ({ id, section, kind, prompt, options: options ?? null, unit: unit ?? null })),
    pretest,
    /** No answers, no exclusion rule: the browser only shows the questions. */
    publicPretest: pretest.map(({ id, prompt, options }) => ({ id, prompt, options })),
    practiceFile,
    practice,
    /** What the browser may see before checking: no answers, no solutions. */
    publicPractice: practice.map(({ id, round, title, kind, prompt, options, unit }) => ({ id, round, title, kind, prompt, options: options ?? null, unit: unit ?? null })),
    /** The worked solutions, for the results page: sent only with the graded final test. */
    practiceReview: practice.map((p) => ({
      id: p.id,
      round: p.round,
      title: p.title,
      prompt: p.prompt,
      options: p.options ?? null,
      // large numbers (visitors, days) as whole numbers, small ones (shares, scores) to two decimals
      answer: p.kind === "choice" ? p.options![p.answer]! : `about ${Math.abs(p.answer) >= 10 ? Math.round(p.answer) : Math.round(p.answer * 100) / 100}${p.unit ? ` ${p.unit}` : ""}`,
      answerIndex: p.kind === "choice" ? p.answer : null,
      steps: p.steps.map((s) => s.text),
    })),
    survey,
    /** Video list for the watch page and the help card. */
    videos: bundle.videos.map((v, i) => ({ ...v, part: i + 1 })),
    /** The lesson graph's shape for Kai's mind (positions, labels, prerequisites; no fact text), laid out once. */
    get graphView(): GraphView {
      return (graph ??= graphOf(bundle));
    },
    ...makeMoments(bundle, raw.coverage, raw.chunks),
  };
}
export type Pack = ReturnType<typeof build>;

const built = new Map<string, Pack>();
/** A topic's pack; an unknown slug (a stale setting, an old token) falls back to the default topic. */
export function packFor(slug: string | null | undefined): Pack {
  const s = slug && RAW_PACKS[slug] ? slug : DEFAULT_TOPIC;
  let p = built.get(s);
  if (!p) built.set(s, (p = build(s)));
  return p;
}
export const topicSlugs = () => Object.keys(RAW_PACKS);
export const hasTopic = (slug: string) => slug in RAW_PACKS;
export { DEFAULT_TOPIC };

export type PublicExercise = ReturnType<Pack["publicExercises"]>[number];
export type PublicPractice = Pack["publicPractice"][number];

function graphOf(bundle: Bundle) {
  const l = layout(bundle.nodes);
  // crop to what is drawn: the layout's grid can leave an empty row above and room below
  const ys = [...Object.values(l.pos).flatMap((p) => [p.y, p.y + BOX_H]), ...Object.values(l.routes).flatMap((pts) => pts.map((p) => p.y))];
  const top = Math.max(0, Math.min(...ys) - 16);
  const height = Math.min(l.height, Math.max(...ys) + 16) - top;
  const pos = Object.fromEntries(Object.entries(l.pos).map(([id, p]) => [id, { x: p.x, y: p.y - top }]));
  const routes = Object.fromEntries(Object.entries(l.routes).map(([k, pts]) => [k, pts.map((p) => ({ x: p.x, y: p.y - top }))]));
  return {
    nodes: bundle.nodes.map((n) => ({ id: n.id, label: n.label, kind: n.kind, needs: n.needs, goals: n.goals, inLesson: n.inLesson })),
    // SVG path per prerequisite edge, keyed "from>to"
    edges: Object.entries(routes).map(([key, pts]) => {
      const [from, to] = key.split(">") as [string, string];
      return { from, to, d: routePath(pts) };
    }),
    goals: bundle.goals.map((g) => ({ id: g.id, level: g.level, text: g.text })),
    pos,
    width: l.width,
    height,
    box: { w: BOX_W, h: BOX_H },
  };
}
export type GraphView = ReturnType<typeof graphOf>;
