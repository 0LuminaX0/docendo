import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import { Bundle } from "./schema";
import { PracticeFile } from "./practice";
import { SurveyItem, TopicCopy } from "../lib/settings";

// The files a topic pack gives the app (besides the bundle): the final test's forms, the pretest, the questions after
// the test and the participant-facing words. One set of schemas for the server (lib/server/content.ts parses the pack
// with them) and for `pnpm content validate`, which checks the whole pack before it ships.

export const Exercise = z
  .object({
    id: z.string(),
    goal: z.string(),
    type: z.string(), // what it asks of the learner (near or far transfer, a changed rule, …)
    section: z.string(), // the rule it is about
    // two forms: one for the final test, the other for the delayed test (or both in the final test: settings test.both)
    form: z.enum(["A", "B"]).default("A"),
    pair: z.string().optional(), // a form B item: its twin in form A
    same: z.string().optional(), // identical to this item of the other form (an anchor): asked once when a session takes both
    title: z.string().optional(), // a short name for the team (admin panel); never sent to the browser
    kind: z.enum(["choice", "multi", "number"]).default("choice"), // pick an option, tick every true statement, or type a number
    prompt: z.string(),
    table: z.object({ head: z.array(z.string()).min(2), rows: z.array(z.array(z.string())).min(1) }).optional(), // under the prompt
    question: z.string().optional(), // asked under the table
    options: z.array(z.string()).min(2).max(6).optional(),
    unit: z.string().optional(),
    // choice: the option's index; multi: the true statements' indices; number: the value
    answer: z.union([z.number(), z.array(z.number().int().min(0)).min(1)]),
    tolerance: z.number().min(0).optional(),
    dontKnow: z.boolean().default(false), // offers "I don't know" (graded wrong, logged as such)
    reason: z.boolean().default(false), // asks for the reason in a sentence or two (scored later against the rubric)
    explain: z.string(), // shown with the results
    // for the team only, never sent to the browser: how a reason is scored, what each option shows (correct, or the
    // misconception it reflects), the share correct the team expects, and where the item comes from
    rubric: z.string().optional(),
    diagnosis: z.array(z.string()).optional(),
    estimate: z.number().min(0).max(1).optional(),
    note: z.string().optional(),
  })
  .refine((q) => {
    const n = q.options?.length ?? 0;
    if (q.kind === "choice") return n > 0 && typeof q.answer === "number" && Number.isInteger(q.answer) && q.answer >= 0 && q.answer < n;
    if (q.kind === "multi") return n > 0 && Array.isArray(q.answer) && new Set(q.answer).size === q.answer.length && q.answer.every((k) => k < n);
    return !q.options && typeof q.answer === "number";
  }, "choice items need options and a valid key, multi-select items options and the true statements' indices; number items have no options");
export type Exercise = z.infer<typeof Exercise>;
export const ExercisesFile = z.object({ title: z.string(), items: z.array(Exercise).min(1) });

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
  const pretest = read("pretest.json", PretestFile, false);
  const facts = new Set(bundle?.nodes.flatMap((n) => n.facts.map((f) => f.id)) ?? []);

  // practice: what Kai's gate needs must be real facts
  for (const p of practice?.items ?? [])
    for (const need of p.needs ?? []) for (const f of need.split("|")) if (bundle && !facts.has(f)) err("practice.json", `${p.id} needs ${f}, which isn't a fact in the bundle`);

  // the final test: ids unique, forms the same length, each twin real, each anchor identical to its twin, one
  // diagnosis per option, tables with full rows
  if (tests) {
    const ids = tests.items.map((q) => q.id);
    for (const id of ids.filter((x, i) => ids.indexOf(x) !== i)) err("exercises.json", `item ${id} appears twice`);
    const a = tests.items.filter((q) => q.form === "A");
    const b = tests.items.filter((q) => q.form === "B");
    if (b.length && a.length !== b.length) err("exercises.json", `form A has ${a.length} items and form B ${b.length}: parallel forms must match`);
    for (const q of b) if (q.pair && !a.some((x) => x.id === q.pair)) err("exercises.json", `${q.id} is the twin of ${q.pair}, which isn't in form A`);
    if (!b.length) warn("exercises.json", "one test form only: the follow-up test can't be switched on");
    const shown = (q: (typeof tests.items)[number]) => JSON.stringify([q.kind, q.prompt, q.table ?? null, q.question ?? null, q.options ?? null, q.answer]);
    for (const q of tests.items) {
      const twin = q.same ? tests.items.find((x) => x.id === q.same) : null;
      if (q.same && (!twin || twin.form === q.form)) err("exercises.json", `${q.id} is the same as ${q.same}, which isn't an item of the other form`);
      else if (twin && shown(twin) !== shown(q)) err("exercises.json", `${q.id} is marked the same as ${q.same} but differs from it: an anchor must be identical`);
      if (q.diagnosis && q.diagnosis.length !== (q.options?.length ?? 0)) err("exercises.json", `${q.id}: ${q.diagnosis.length} diagnoses for ${q.options?.length ?? 0} options`);
      if (q.table && q.table.rows.some((r) => r.length !== q.table!.head.length)) err("exercises.json", `${q.id}: a table row doesn't match the head`);
      if (q.reason && !q.rubric) warn("exercises.json", `${q.id} asks for a reason but has no rubric to score it`);
    }
  }
  if (pretest) for (const q of pretest.items) if (q.kind === "knowledge" && q.answer === undefined) err("pretest.json", `${q.id} is a knowledge item without an answer`);

  // the videos' transcripts, for Rewatch moments and Kai's help
  for (const v of bundle?.videos ?? []) if (!existsSync(join(dir, "sources", "chunks", `${v.id}.json`))) warn("sources", `no transcript chunks for ${v.id}: no Rewatch moments or help in it`);

  // the app knows only registered packs
  const registry = join(root, "lib", "server", "topics.ts");
  if (existsSync(registry) && !readFileSync(registry, "utf8").includes(`topics/${slug}/`)) warn("registry", `not in lib/server/topics.ts yet: the app can't run it`);
  return issues;
}
