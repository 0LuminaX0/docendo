import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import { Bundle } from "./schema";
import { PracticeFile } from "./practice";
import { FIGURES, FORMULAS } from "../lib/lesson";
import { SurveyItem, TopicCopy } from "../lib/settings";
import { hasTerm } from "./terms";

// The files a topic pack gives the app (besides the bundle): the final test's forms, the pretest, the questions after
// the test and the participant-facing words. One set of schemas for the server (lib/server/content.ts parses the pack
// with them) and for `pnpm content validate`, which checks the whole pack before it ships.

export const Exercise = z
  .object({
    id: z.string(),
    // left out of the test, kept with its key and notes (2026-11-05: the session cut to about 40 minutes, five items a
    // form); the app never serves or grades it, and the parallel-form checks count only the items in use
    off: z.boolean().optional(),
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
// order: "shuffled" (each learner their own order, lib/order.ts) or "fixed" (the file's order: since 2026-11-05 the
// forms go from understanding greedy to a changed UCB, and the order is part of the design)
export const ExercisesFile = z.object({ title: z.string(), order: z.enum(["shuffled", "fixed"]).default("shuffled"), items: z.array(Exercise).min(1) });

// The text lesson (optional; lesson.json): read on the lesson step instead of the videos. Paragraphs take **bold**; a
// figure or formula is named by id (lib/lesson.ts, components/lesson/). Each section names the ideas it explains, for
// the help passage that matches Kai's question or a practice problem.
export const LessonBlock = z.union([z.object({ p: z.string().min(1) }), z.object({ formula: z.string() }), z.object({ figure: z.string(), caption: z.string() })]);
export const LessonFile = z.object({
  note: z.string().optional(),
  title: z.string(),
  minutes: z.number().positive(), // the text's own reading estimate (the pages show the study's time instead, Study setup's watch.minutes; "{minutes}" in the intro is replaced by it)
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
  off: z.boolean().optional(), // left out, kept (2026-11-05: one set, C1; the harder C2 was for calibrating in the pilot)
  id: z.string(),
  kind: z.enum(["background", "knowledge"]),
  prompt: z.string(),
  options: z.array(z.string()).min(2).max(6),
  answer: z.number().int().min(0).optional(), // knowledge items
  exclude: z.number().int().min(0).optional(), // background: this answer flags the session as excluded from the analysis
  // knowledge items: the set it belongs to (a session takes the first set, a pilot all of them: settings pretest.both);
  // for the team only, never sent to the browser: the first set's item it is a harder version of, what it measures,
  // what each option shows, why the key is right, the share correct the team expects, and notes
  set: z.string().regex(/^[A-Za-z0-9_-]{1,12}$/).optional(),
  pair: z.string().optional(),
  measures: z.string().optional(),
  diagnosis: z.array(z.string()).optional(),
  explain: z.string().optional(),
  estimate: z.number().min(0).max(1).optional(),
  note: z.string().optional(),
});
export const PretestFile = z.object({ title: z.string(), items: z.array(PretestItem).min(1) });
export const SurveyFile = z.object({ items: z.array(SurveyItem) });

// Kai's fixed teaching questions (optional): with them Kai asks the same questions of everyone, in order, instead of
// choosing its next question from the lesson's ideas (engine/tutor/script.ts).
export const ScriptFile = z.object({
  note: z.string().optional(),
  opening: z.string().min(10), // Kai's first words, before the first question
  minutes: z.number().positive().default(10), // Kai wraps up at the first message after this long
  shortWords: z.number().int().positive().default(15), // an answer shorter than this gets "Can you say more about that?"
  // lesson terms Kai knows before anyone teaches it (the topic's and the rules' names, from the slides): its questions
  // and reactions may use them
  known: z.array(z.string()).default([]),
  questions: z
    .array(
      z.object({
        id: z.string().regex(/^[a-z0-9-]+$/),
        node: z.string().nullable().default(null), // the idea it is about: Kai's focus (Kai's mind, the help card)
        sayMore: z.boolean().default(false), // a short answer gets one "say more" (questions without targets only)
        text: z.string().min(10),
        // the teachable facts it is there to elicit: once all are credited it is skipped, and after an answer each one
        // still missing gets its follow-up (once). Kai never asks a question naming a lesson term the learner hasn't used
        targets: z.array(z.string()).default([]),
        follow: z.array(z.object({ fact: z.string(), text: z.string().min(10) })).default([]),
      }),
    )
    .min(1),
  lines: z.object({
    wrote: z.string().includes("{notes}"), // before the next question: what Kai wrote down, in the learner's words
    wroteNothing: z.string(),
    sayMore: z.string(),
    dontKnow: z.string(),
    moveOn: z.string(),
    notAnswer: z.string(),
    askedKai: z.string(),
    back: z.string().default("Can we go back to one I'm still stuck on?"), // before a question left unanswered, asked again
    ready: z.string(), // the wrap-up, followed by Kai's notes
    readyEmpty: z.string(),
  }),
});
export type ScriptFile = z.infer<typeof ScriptFile>;

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
  const script = read("script.json", ScriptFile, false);
  const facts = new Set(bundle?.nodes.flatMap((n) => n.facts.map((f) => f.id)) ?? []);

  // practice: what Kai's gate needs must be real facts
  for (const p of practice?.items ?? [])
    for (const need of p.needs ?? []) for (const f of need.split("|")) if (bundle && !facts.has(f)) err("practice.json", `${p.id} needs ${f}, which isn't a fact in the bundle`);
  // the judge's evidence patterns must compile (an invalid one would be skipped at run time)
  for (const f of bundle?.nodes.flatMap((n) => n.facts) ?? []) {
    if (!f.evidence) continue;
    try {
      new RegExp(f.evidence, "iu");
    } catch (e) {
      err("graph", `${f.id}: its evidence pattern doesn't compile (${String(e).slice(0, 80)})`);
    }
  }
  // how Kai says each assumption when it guesses: a hunch for every assume (and assumeVague)
  for (const f of bundle?.nodes.flatMap((n) => n.facts) ?? []) {
    if (f.assume && !f.hunch) warn("graph", `${f.id} has an assumption but no hunch: Kai would recite the assumption as a rule`);
    if (f.assumeVague && !f.hunchVague) warn("graph", `${f.id} has a vague assumption but no hunchVague`);
  }
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

  // the final test: ids unique, forms the same length, each twin real, each anchor identical to its twin, one
  // diagnosis per option, tables with full rows
  if (tests) {
    const ids = tests.items.map((q) => q.id);
    for (const id of ids.filter((x, i) => ids.indexOf(x) !== i)) err("exercises.json", `item ${id} appears twice`);
    const a = tests.items.filter((q) => q.form === "A" && !q.off);
    const b = tests.items.filter((q) => q.form === "B" && !q.off);
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
  // Kai's fixed questions: about real ideas, and naming no lesson term beyond the rules' names (they leak nothing)
  if (script && bundle) {
    const ids = script.questions.map((q) => q.id);
    for (const id of ids.filter((x, i) => ids.indexOf(x) !== i)) err("script.json", `question ${id} appears twice`);
    for (const q of script.questions) if (q.node && !bundle.nodes.some((n) => n.id === q.node)) err("script.json", `${q.id} is about ${q.node}, which isn't an idea in the bundle`);
    // the graph's order: no question about an idea before a question about an idea it builds on
    const nodeOf = new Map(bundle.nodes.map((n) => [n.id, n]));
    const builds = (id: string, on: string, seen = new Set<string>()): boolean =>
      (nodeOf.get(id)?.needs ?? []).some((p) => p === on || (!seen.has(p) && (seen.add(p), builds(p, on, seen))));
    // terms: the names Kai knows from the slides anywhere; a question may also name terms of its own idea and the ideas
    // it builds on (Kai asks it only once the learner has used them: engine/tutor/script.ts); nothing else
    const known = new Set(script.known.map((t) => t.toLowerCase()));
    const own = (node: string | null) => new Set(bundle.nodes.filter((n) => node && (n.id === node || builds(node, n.id))).flatMap((n) => n.lexicon.map((t) => t.toLowerCase())));
    const texts = [{ id: "opening", node: null as string | null, text: script.opening }, ...script.questions.flatMap((q) => [{ id: q.id, node: q.node, text: q.text }, ...q.follow.map((f) => ({ id: `${q.id} (${f.fact})`, node: q.node, text: f.text }))])];
    for (const q of texts)
      for (const n of bundle.nodes)
        for (const t of n.lexicon)
          if (!known.has(t.toLowerCase()) && !own(q.node).has(t.toLowerCase()) && hasTerm(q.text, t)) warn("script.json", `${q.id} uses "${t}" (${n.id}): Kai's questions may name only the rules' names and terms of their own idea`);
    // a question naming a term of its own idea waits until the learner has used it: say so (put the rules' names, which
    // Kai knows from the slides, in `known`, or Kai never asks about the rules)
    for (const q of script.questions)
      for (const n of bundle.nodes)
        for (const t of n.lexicon)
          if (!known.has(t.toLowerCase()) && own(q.node).has(t.toLowerCase()) && hasTerm(q.text, t)) warn("script.json", `${q.id} is asked only once the learner has used "${t}" (fine if meant; if Kai knows it from the slides, add it to known)`);
    // targets: teachable facts, every one asked about; follow-ups for a question's own targets
    const teachable = new Set(bundle.nodes.flatMap((n) => n.facts.filter((f) => f.required && f.teachable && f.assume).map((f) => f.id)));
    for (const q of script.questions) {
      for (const f of q.targets) if (!facts.has(f)) err("script.json", `${q.id} targets ${f}, which isn't a fact in the bundle`);
      for (const f of q.follow) if (!q.targets.includes(f.fact)) err("script.json", `${q.id}: a follow-up for ${f.fact}, which isn't one of its targets`);
    }
    for (const f of teachable) if (!script.questions.some((q) => q.targets.includes(f))) warn("script.json", `no question asks about ${f}: a learner who doesn't bring it up leaves it out of Kai's notebook`);
    script.questions.forEach((q, i) => {
      for (const later of script.questions.slice(i + 1)) if (q.node && later.node && builds(q.node, later.node)) warn("script.json", `${q.id} (${q.node}) comes before ${later.id} (${later.node}), which it builds on`);
    });
  }

  // the pretest's sets: every knowledge item in one when any is, sets of the same size, pairs in the first set, keys
  // and exclusions on real options, one diagnosis per option
  if (pretest) {
    const knowledge = pretest.items.filter((q) => q.kind === "knowledge");
    const sets = [...new Set(knowledge.flatMap((q) => (q.set ? [q.set] : [])))];
    if (sets.length && knowledge.some((q) => !q.set)) err("pretest.json", "some knowledge items have a set and some don't");
    const size = (s: string) => knowledge.filter((q) => q.set === s).length;
    if (sets.some((s) => size(s) !== size(sets[0]!))) warn("pretest.json", `the sets differ in size (${sets.map((s) => `${s}: ${size(s)}`).join(", ")})`);
    for (const q of pretest.items) {
      if (q.answer !== undefined && q.answer >= q.options.length) err("pretest.json", `${q.id}: the key is not an option`);
      if (q.exclude !== undefined && q.exclude >= q.options.length) err("pretest.json", `${q.id}: the excluding answer is not an option`);
      if (q.pair && !knowledge.some((x) => x.id === q.pair && x.set === sets[0])) err("pretest.json", `${q.id} pairs ${q.pair}, which isn't in the first set`);
      if (q.diagnosis && q.diagnosis.length !== q.options.length) err("pretest.json", `${q.id}: ${q.diagnosis.length} diagnoses for ${q.options.length} options`);
    }
  }

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
