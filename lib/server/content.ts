import "server-only";
import { createHash } from "node:crypto";
import { Bundle } from "../../content/schema";
import { PracticeFile, checkPractice } from "../../content/practice";
import { BOX_H, BOX_W, layout, routePath } from "../../content/layout";
import { DEFAULT_TOPIC, RAW_PACKS } from "./topics";
import { makeMoments } from "./moments";
import { LessonFile } from "../../content/pack";
import { lessonWords, makeOverlap, type Passage } from "../lesson";
import { TopicCopy } from "../settings";
import { ExercisesFile, PretestFile, ScriptFile, SurveyFile, type Exercise } from "../../content/pack";
export type { Exercise };
import { pretestItems, pretestSets } from "../../content/pretest";

// A topic pack, parsed and ready to serve (lib/server/topics.ts lists the packs). Every route and page asks for the
// pack it needs: a session's own (its token names the topic it started with), or the study's current one (Settings).
// Built once per topic and kept.

export type Form = "A" | "B";
export const FORMS: Form[] = ["A", "B"];
export const otherForm = (form: Form): Form => (form === "A" ? "B" : "A");

// grading one answer, the key as shown, and which items a session answers: content/test.ts (shared with the tests)
export { checkExercise, gradeTest, isKey, keyText } from "../../content/test";
import { sessionItems } from "../../content/test";
export { checkPractice };

function build(slug: string) {
  const raw = RAW_PACKS[slug];
  if (!raw) throw new Error(`No topic pack "${slug}" (lib/server/topics.ts)`);
  const bundle: Bundle = Bundle.parse(raw.bundle);
  const exercises = ExercisesFile.parse(raw.exercises).items;
  // the pretest: every item, and what a session takes unless a pilot runs every set (content/pretest.ts)
  const pretestAll = PretestFile.parse(raw.pretest).items;
  const pretest = pretestItems(pretestAll, pretestSets(pretestAll).slice(0, 1));
  const practiceFile = PracticeFile.parse(raw.practice);
  const practice = practiceFile.items;
  const survey = SurveyFile.parse(raw.survey).items;
  const lesson = raw.lesson ? LessonFile.parse(raw.lesson) : null;
  const copy = TopicCopy.parse(raw.copy);
  const script = raw.script ? ScriptFile.parse(raw.script) : null;
  const formItems = (form: Form) => exercises.filter((q) => q.form === form);
  const forms = FORMS.filter((f) => formItems(f).length > 0);
  let graph: GraphView | null = null;

  return {
    slug,
    title: bundle.title,
    copy,
    /** Kai's fixed teaching questions, or null: Kai then chooses its questions from the lesson's ideas. */
    script,
    bundle,
    exercises,
    /** The test forms this pack has (a follow-up test needs two). */
    forms,
    /** One form's items, in file order (the order the server grades in). */
    formItems,
    /** A fingerprint of a form's content, logged with every graded test: answers to an edited item stay apart. */
    testVersion: (form: Form) => createHash("sha1").update(JSON.stringify(formItems(form))).digest("hex").slice(0, 8),
    /** The items a session answers: its form, or (both) its form and then the other, an anchor asked once. */
    sessionItems: (form: Form, both = false) => sessionItems(exercises, form, both),
    /** What the browser may see before grading: the session's questions, no answers, no explanations, nothing for the
     * team (rubric, diagnosis). Sent per session, so the other form's questions aren't in the page before the delayed
     * test. */
    publicExercises: (form: Form, both = false) =>
      sessionItems(exercises, form, both).map(({ id, form, section, kind, prompt, table, question, options, unit, dontKnow, reason }) => ({ id, form, section, kind, prompt, table: table ?? null, question: question ?? null, options: options ?? null, unit: unit ?? null, dontKnow, reason })),
    pretest,
    /** Every pretest item (a pilot takes every set), the sets in file order, and a fingerprint of the content. */
    pretestAll,
    pretestSets: pretestSets(pretestAll),
    pretestVersion: createHash("sha1").update(JSON.stringify(pretestAll)).digest("hex").slice(0, 8),
    /** No answers, no exclusion rule, nothing for the team: the browser only shows the questions, every set's (the
     * page takes the session's sets). */
    publicPretest: pretestAll.map(({ id, kind, set, prompt, options }) => ({ id, kind, set: set ?? "", prompt, options })),
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
    /** The text lesson, read instead of the videos (lesson.json), or null. */
    lesson,
    /** How much of a learner's message comes word for word from the text lesson (null without one). */
    lessonOverlap: lesson ? makeOverlap(lessonWords(lesson)) : null,
    /** The lesson's section about an idea (Kai's focus): its title, and its text once help is open. Null without a text lesson. */
    passageFor: (node: string | null | undefined, open: boolean): Passage | null => {
      const s = lesson && node ? lesson.sections.find((x) => x.nodes.includes(node)) : null;
      return s ? { section: s.id, title: s.title, ...(open ? { blocks: s.blocks } : {}) } : null;
    },
    /** The sections that explain these facts' ideas, in lesson order (a practice problem's help), at most `max`. */
    passagesFor: (facts: string[], max = 2): Required<Passage>[] => {
      if (!lesson) return [];
      const ideas = new Set(facts.map((f) => f.split(".")[0]!));
      return lesson.sections.filter((s) => s.nodes.some((n) => ideas.has(n))).slice(0, max).map((s) => ({ section: s.id, title: s.title, blocks: s.blocks }));
    },
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
