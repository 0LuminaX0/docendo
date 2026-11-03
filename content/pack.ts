import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import { Bundle } from "./schema";
import { PracticeFile } from "./practice";
import { FIGURES, FORMULAS } from "../lib/lesson";
import { SurveyItem, TopicCopy } from "../lib/settings";

// The files a topic pack gives the app (besides the bundle): the final test's forms, the pretest, the questions after
// the test and the participant-facing words. One set of schemas for the server (lib/server/content.ts parses the pack
// with them) and for `pnpm content validate`, which checks the whole pack before it ships.

export const Exercise = z
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
export const ExercisesFile = z.object({ title: z.string(), items: z.array(Exercise).min(1) });

// The text lesson (optional; lesson.json): read on the lesson step instead of the videos. Paragraphs take **bold**; a
// figure or formula is named by id (lib/lesson.ts, components/lesson/). Each section names the ideas it explains, for
// the help passage that matches Kai's question or a practice problem.
export const LessonBlock = z.union([z.object({ p: z.string().min(1) }), z.object({ formula: z.string() }), z.object({ figure: z.string(), caption: z.string() })]);
export const LessonFile = z.object({
  note: z.string().optional(),
  title: z.string(),
  minutes: z.number().positive(), // reading time, for the welcome page and the step cards
  minSeconds: z.number().int().min(0).default(0), // "Continue" opens after this long on the page
  remindSeconds: z.number().int().min(0).default(0), // a gentle reminder to move on after this long (0: none)
  intro: z.string(),
  // Kai's reply to a message copied from the text (COPIED_RUN shared words in a row, lib/lesson.ts): nothing is judged
  copied: z.string().default("That sounds like the reading, and I didn't get it from there. Can you say it in your own words, or give me an example?"),
  sections: z.array(z.object({ id: z.string().regex(/^[a-z0-9-]+$/), title: z.string(), nodes: z.array(z.string()).default([]), blocks: z.array(LessonBlock).min(1) })).min(1),
  end: z.string(),
});
export type LessonFile = z.infer<typeof LessonFile>;

export const PretestItem = z.object({
  id: z.string(),
  kind: z.enum(["background", "knowledge"]),
  prompt: z.string(),
  options: z.array(z.string()).min(2).max(6),
  answer: z.number().int().min(0).optional(), // knowledge items
  exclude: z.number().int().min(0).optional(), // background: this answer flags the session as excluded from the analysis
});
export const PretestFile = z.object({ title: z.string(), items: z.array(PretestItem).min(1) });
export const SurveyFile = z.object({ items: z.array(SurveyItem) });

type Issue = { level: "error" | "warn"; where: string; msg: string };

/** Everything the app will read from topics/<slug>/, checked as the server will parse it, plus what ties it together. */
export function checkPack(slug: string, root = process.cwd()): Issue[] {
  const dir = join(root, "topics", slug);
  const issues: Issue[] = [];
  const err = (where: string, msg: string) => issues.push({ level: "error", where, msg });
  const warn = (where: string, msg: string) => issues.push({ level: "warn", where, msg });
  const read = <T extends z.ZodType>(file: string, schema: T, required = true): z.infer<T> | null => {
    const path = join(dir, file);
    if (!existsSync(path)) {
      if (required) err(file, "missing");
      return null;
    }
    const r = schema.safeParse(JSON.parse(readFileSync(path, "utf8")));
    if (!r.success) {
      for (const i of r.error.issues.slice(0, 5)) err(file, `${i.path.join(".") || "(file)"}: ${i.message}`);
      return null;
    }
    return r.data;
  };

  const bundle = read("bundle.json", Bundle);
  read("copy.json", TopicCopy);
  read("survey.json", SurveyFile, false);
  const practice = read("practice.json", PracticeFile);
  const tests = read("exercises.json", ExercisesFile);
  const lesson = read("lesson.json", LessonFile, false);
  const pretest = read("pretest.json", PretestFile, false);
  const facts = new Set(bundle?.nodes.flatMap((n) => n.facts.map((f) => f.id)) ?? []);

  // practice: what Kai's gate needs must be real facts
  for (const p of practice?.items ?? [])
    for (const need of p.needs ?? []) for (const f of need.split("|")) if (bundle && !facts.has(f)) err("practice.json", `${p.id} needs ${f}, which isn't a fact in the bundle`);
  // Kai's assumptions: one per fact, copied word for word, and one for every need that leads to a wrong option
  const factById = new Map(bundle?.nodes.flatMap((n) => n.facts.map((f) => [f.id, f] as const)) ?? []);
  for (const p of practice?.items ?? []) {
    for (const b of p.beliefs ?? []) {
      const f = factById.get(b.replaces);
      const own = b.when === "vague" ? f?.assumeVague : f?.assume;
      if (bundle && own && b.belief !== own) err("practice.json", `${p.id}: the assumption for ${b.replaces} differs from the fact's ${b.when === "vague" ? "assumeVague" : "assume"} in the graph`);
      if (p.kind === "choice" && !(b.answer >= 0 && b.answer < (p.options?.length ?? 0))) err("practice.json", `${p.id}: the assumption for ${b.replaces} leads to no option`);
    }
    for (const need of p.needs ?? []) {
      const absent = (p.beliefs ?? []).find((b) => need.split("|").includes(b.replaces) && b.when !== "vague");
      if (p.beliefs && !absent) err("practice.json", `${p.id}: no assumption for ${need}, so Kai can't fail there with a named cause`);
      else if (absent && absent.answer === p.answer) err("practice.json", `${p.id}: the assumption for ${need} leads to the key, so ${need} isn't needed`);
    }
  }

  // the final test: ids unique, forms the same length, each twin real
  if (tests) {
    const ids = tests.items.map((q) => q.id);
    for (const id of ids.filter((x, i) => ids.indexOf(x) !== i)) err("exercises.json", `item ${id} appears twice`);
    const a = tests.items.filter((q) => q.form === "A");
    const b = tests.items.filter((q) => q.form === "B");
    if (b.length && a.length !== b.length) err("exercises.json", `form A has ${a.length} items and form B ${b.length}: parallel forms must match`);
    for (const q of b) if (q.pair && !a.some((x) => x.id === q.pair)) err("exercises.json", `${q.id} is the twin of ${q.pair}, which isn't in form A`);
    if (!b.length) warn("exercises.json", "one test form only: the follow-up test can't be switched on");
  }
  if (pretest) for (const q of pretest.items) if (q.kind === "knowledge" && q.answer === undefined) err("pretest.json", `${q.id} is a knowledge item without an answer`);

  // the videos' transcripts, for Rewatch moments and Kai's help
  for (const v of bundle?.videos ?? []) if (!existsSync(join(dir, "sources", "chunks", `${v.id}.json`))) warn("sources", `no transcript chunks for ${v.id}: no Rewatch moments or help in it`);
  // the text lesson: figures and formulas that exist, ideas that are in the bundle, each lesson idea in some section
  if (lesson) {
    for (const s of lesson.sections) {
      for (const b of s.blocks) {
        if ("figure" in b && !(FIGURES as readonly string[]).includes(b.figure)) err("lesson.json", `${s.id}: no figure "${b.figure}" (lib/lesson.ts)`);
        if ("formula" in b && !(FORMULAS as readonly string[]).includes(b.formula)) err("lesson.json", `${s.id}: no formula "${b.formula}" (lib/lesson.ts)`);
      }
      for (const n of s.nodes) if (bundle && !bundle.nodes.some((x) => x.id === n)) err("lesson.json", `${s.id} explains ${n}, which isn't an idea in the bundle`);
    }
    for (const n of bundle?.nodes.filter((x) => x.inLesson !== false) ?? []) if (!lesson.sections.some((s) => s.nodes.includes(n.id))) warn("lesson.json", `no section explains ${n.id} (${n.label}): no help passage for it`);
  }

  // the app knows only registered packs
  const registry = join(root, "lib", "server", "topics.ts");
  if (existsSync(registry) && !readFileSync(registry, "utf8").includes(`topics/${slug}/`)) warn("registry", `not in lib/server/topics.ts yet: the app can't run it`);
  return issues;
}
