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

  // the app knows only registered packs
  const registry = join(root, "lib", "server", "topics.ts");
  if (existsSync(registry) && !readFileSync(registry, "utf8").includes(`topics/${slug}/`)) warn("registry", `not in lib/server/topics.ts yet: the app can't run it`);
  return issues;
}
