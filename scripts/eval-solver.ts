// Evaluate Kai's solver (recursive feedback): the item check from the team's design.
//   pnpm eval:solver                                   every practice problem, every case, once, the configured model
//   pnpm eval:solver --reps 10                         the full item check (10 runs a case, about $0.30)
//   pnpm eval:solver --models a/b,c/d --items p1,p4    compare models (OpenRouter ids) on some problems
//   pnpm eval:solver --unlisted                        also: a fact the problem doesn't list, removed, changes nothing
//   pnpm eval:solver --audit                           also: the judge model reads every wrong attempt for leaks
//   pnpm eval:solver --show                            print every attempt's steps
//
// Cases per problem, each from a notebook a learner might leave:
//   full          every needed fact explained                        → the key
//   without F     every needed fact but F                            → the option F's assumption leads to
//   vague F       every needed fact, F only vaguely                  → the key if the vague reading gets there, else
//                                                                      the option the vague reading leads to
//   skipped       nothing taught                                     → the option the first needed fact's assumption leads to
//   misconception the last needed fact stated wrongly (its misconception, in a learner's words) → a wrong option
//   unlisted (--unlisted) every teachable fact but one the problem doesn't need → the key
//   caveat <id>   notes that leave the problem's planted point open (P7: greedy's rule without the switch; the
//                 switch and lock-in without what tells them apart; P8: the growth without the slowing), the caveat in
//                 play as in the app → its misreading
//   said <id>     the point said in words the caveat's pattern misses, the caveat in play → the key (Kai follows notes)
// Keep a problem only if: full right ≥ 9/10, each "without" at its predicted option ≥ 8/10, unlisted unchanged; a
// caveat misread ≥ 8/10, its "said" case right ≥ 9/10 (else the solver goes against a note).
// Also counted: answered by the model (not the offline fallback), 2 to 5 steps (2 or 3 with an empty notebook), a step that says Kai is guessing
// where a fact is missing, and lesson terms Kai used that its notes didn't give it (leaks). With --audit the judge
// model reads every attempt that lacked a fact and says whether a step states or uses a fact Kai wasn't told.
// Costs real credits.

import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { z } from "zod";
for (const f of [".env", ".env.local"]) {
  try {
    process.loadEnvFile?.(f);
  } catch {
    // no file
  }
}
const { Bundle } = await import("../content/schema");
const { PracticeFile, checkPractice } = await import("../content/practice");
const { initialState } = await import("../engine/tutor/state");
const { beliefFor, caveatFor, solve } = await import("../engine/tutor/solve");
const { caveatsOf } = await import("../content/practice");
const { chatJson, MODELS } = await import("../engine/llm");

const args = process.argv.slice(2);
const opt = (name: string) => (args.includes(name) ? args[args.indexOf(name) + 1] : undefined);
const models = (opt("--models") ?? MODELS.solver).split(",").map((m) => m.trim()).filter(Boolean);
const reps = Number(opt("--reps") ?? 1);
const show = args.includes("--show");
const audit = args.includes("--audit");
const unlisted = args.includes("--unlisted");
const only = opt("--items")?.split(",");

const bundle = Bundle.parse(JSON.parse(readFileSync("topics/bandits/bundle.json", "utf8")));
const allItems = PracticeFile.parse(JSON.parse(readFileSync("topics/bandits/practice.json", "utf8"))).items;
const items = allItems.filter((p) => !only || only.includes(p.id));
const facts = new Map(bundle.nodes.flatMap((n) => n.facts.map((f) => [f.id, f] as const)));
const teachable = bundle.nodes.filter((n) => n.inLesson !== false).flatMap((n) => n.facts.filter((f) => f.required && f.teachable && f.assume).map((f) => f.id));
const LETTERS = "ABCDEF";

// what a learner might have said for each teachable fact: right, and only half right
const SAID: Record<string, string> = {
  "n05.f1": "greedy always goes for whichever option has the best average so far, and if another one's average gets higher it switches",
  "n06.f1": "if the best one is unlucky at first its average is too low, greedy never picks it again, so it never finds out it's the best",
  "n07.f1": "epsilon greedy takes the best average most of the time, but with probability epsilon it picks at random, and epsilon stays the same the whole time",
  "n07.f2": "that random pick is among all the options with equal chance, the favourite too, whatever their averages",
  "n11.f1": "UCB gives each option a score, its average plus a bonus, and picks the highest score, no randomness",
  "n11.f2": "how big the bonus is is set beforehand with c, from how much the rewards usually vary, it doesn't look at the actual rewards",
  "n12.f1": "every time you pick an option its bonus gets smaller, picking the others doesn't make it smaller",
  "n12.f2": "while you don't pick an option its bonus keeps growing with the round number, but slower and slower, and it never stops",
};
const VAGUE: Record<string, string> = {
  "n05.f1": "greedy goes with the good one",
  "n06.f1": "greedy can get stuck sometimes",
  "n07.f1": "epsilon greedy sometimes does something random",
  "n07.f2": "the random part is kind of spread out",
  "n11.f1": "UCB adds some bonus thing to the numbers",
  "n11.f2": "there's a setting for the bonus",
  "n12.f1": "the bonus changes when you pick something",
  "n12.f2": "the bonus of an option you don't pick grows over time",
};
// the misconception stated as a learner would (its own words, not the assumption's)
const WRONG: Record<string, { node: string; words: string }> = {
  "n05.f1": { node: "n05", words: "greedy picks the best one after the first tries and then always stays with it" },
  "n06.f1": { node: "n06", words: "greedy always ends up at the best one because the averages fix themselves" },
  "n07.f1": { node: "n07", words: "epsilon greedy explores less and less once it knows which one is best" },
  "n07.f2": { node: "n07", words: "when it picks at random it picks one of the others, never the favourite" },
  "n11.f1": { node: "n11", words: "UCB always picks the option you tried the fewest times" },
  "n11.f2": { node: "n11", words: "the bonus is bigger for options whose rewards jumped around a lot" },
  "n12.f1": { node: "n12", words: "all the bonuses shrink as time goes on" },
  "n12.f2": { node: "n12", words: "the bonus of an option you don't pick stays where it was" },
};

// the caveats' notebooks (2026-11-16): per caveat id, the words that leave its point open ("open") and that say it in
// words its pattern misses ("said"); every other needed fact as in SAID
const CAVEAT_NOTES: Record<string, { open: Record<string, string>; said: Record<string, string> }> = {
  sticks: {
    open: { "n05.f1": "greedy always goes for the option with the best average" },
    said: { "n05.f1": "greedy goes with whichever average is on top, and when a fresh leader appears it replaces the old favourite" },
  },
  lockin: {
    open: {},
    said: { "n06.f1": "greedy locks out a good option after a bad start only while that option's average stays under what the others really get; a leader that was just lucky drops back once greedy keeps featuring it" },
  },
  // P8's backstop (2026-11-16): the growth credited in full without the slowing (a team test's words), and the slowing
  // said in words the pattern misses
  slowing: {
    open: { "n12.f2": "the exploration bonus grows when an option is not being picked" },
    said: { "n12.f2": "an unpicked option's bonus keeps rising, but each extra hour adds a little less than the hour before" },
  },
};

type Entry = { fact: string; verdict: "correct" | "partial"; words: string; turn: number };
const entry = (fact: string, verdict: "correct" | "partial", turn: number, words: Record<string, string> = {}): Entry => ({ fact, verdict, words: words[fact] ?? (verdict === "partial" ? VAGUE[fact] : SAID[fact]) ?? `something about ${fact}`, turn });
const notebook = (correct: string[], vague: string[] = [], words: Record<string, string> = {}) => ({
  ...initialState(bundle),
  turn: correct.length + vague.length,
  notebook: [...correct.map((f, i) => entry(f, "correct", i + 1, words)), ...vague.map((f, i) => entry(f, "partial", correct.length + i + 1, words))],
});

type Case = { item: (typeof items)[number]; name: string; state: ReturnType<typeof initialState>; expect: number | "wrong"; lacking: string[]; caveat?: ReturnType<typeof caveatsOf>[number] };
const cases: Case[] = [];
for (const item of items) {
  const needs = item.needs ?? [];
  const key = item.answer;
  cases.push({ item, name: "full", state: notebook(needs), expect: key, lacking: [] });
  for (const n of needs) {
    cases.push({ item, name: `without ${n}`, state: notebook(needs.filter((x) => x !== n)), expect: beliefFor(item, n, "absent")!.answer, lacking: [n] });
    const v = beliefFor(item, n, "vague")!;
    const enough = v.when === "vague" && checkPractice(item, v.answer);
    cases.push({ item, name: `vague ${n}`, state: notebook(needs.filter((x) => x !== n), [n]), expect: enough ? key : v.answer, lacking: enough ? [] : [n] });
  }
  cases.push({ item, name: "skipped", state: notebook([]), expect: beliefFor(item, needs[0]!, "absent")!.answer, lacking: needs });
  const last = needs.at(-1)!;
  const w = WRONG[last]!;
  cases.push({ item, name: `misconception ${last}`, state: { ...notebook(needs.filter((x) => x !== last)), misconceptions: [{ node: w.node, words: w.words, turn: needs.length + 1 }] }, expect: "wrong", lacking: [last] });
  if (unlisted)
    for (const f of teachable.filter((x) => !needs.includes(x)))
      cases.push({ item, name: `unlisted ${f}`, state: notebook(teachable.filter((x) => x !== f)), expect: key, lacking: [] });
  // the caveats, chosen as the practice route does (every problem's needs taught, so a caveat that waits for the
  // problems after it comes into play too); a notebook that doesn't bring its caveat into play is reported, not run
  const everyNeed = [...new Set(allItems.flatMap((p) => (p.needs ?? []).flatMap((n) => n.split("|")[0]!)))];
  for (const c of caveatsOf(item)) {
    const words = CAVEAT_NOTES[c.id ?? ""];
    for (const [kind, w] of [["caveat", words?.open ?? {}], ["said", words?.said]] as const) {
      if (!w) continue;
      const state = notebook([...new Set([...everyNeed, ...(c.requires ?? [])])], [], w);
      const inPlay = caveatFor(allItems, item, state, 0);
      if (inPlay !== c) {
        console.log(`  (${item.id} ${kind} ${c.id}: its notebook brings ${inPlay?.id ?? "no caveat"} into play, not this one: skipped)`);
        continue;
      }
      cases.push({ item, name: `${kind} ${c.id ?? ""}`.trim(), state, expect: kind === "caveat" ? c.answer : key, lacking: [], caveat: c });
    }
  }
}

// the auditor: did Kai state or use a fact it wasn't told, and did it say plainly that it was guessing?
const Audit = z.object({ usesUntold: z.boolean(), which: z.string(), saysGuessing: z.boolean(), firstWrongStep: z.number().int() });
async function auditOf(c: Case, steps: string[], onCost: (c: number) => void) {
  // each fact with Kai's own guess for it: without the guess, the auditor flagged "I'd guess a bonus just stays put"
  // as using "the bonus grows" (97 of 178 flags, every one read a false alarm, 2026-11-14)
  const untold = c.lacking.map((f) => `- ${facts.get(f)!.text}${facts.get(f)!.assume ? `\n  (Kai's own guess instead, which it is meant to reason from: ${facts.get(f)!.assume})` : ""}`).join("\n");
  const r = await chatJson({
    model: MODELS.judge,
    name: "audit",
    schema: Audit,
    maxTokens: 400,
    timeoutMs: 30_000,
    retries: 1,
    messages: [
      { role: "system", content: `A student, Kai, solved a problem from notes a classmate gave it. Kai was NOT told the facts listed below. Read Kai's steps and answer in JSON:\n- usesUntold: true only if a step states one of these facts as true, or reasons in a way that requires knowing it (paraphrases count). Reasoning from Kai's own guess, from its opposite or from any other wrong belief about the same topic is not using the fact, and neither is merely naming the topic (the bonus, the averages).\n- which: the fact it used, in a few words, or "".\n- saysGuessing: true if a step says plainly that Kai is guessing, assuming or wasn't told something.\n- firstWrongStep: the number of the first step whose reasoning is wrong about the topic (0 if none).` },
      { role: "user", content: `FACTS KAI WAS NOT TOLD:\n${untold}\n\nPROBLEM:\n${c.item.prompt}\n\nKAI'S STEPS:\n${steps.map((t, i) => `${i + 1}. ${t}`).join("\n")}` },
    ],
  });
  onCost(r.usage.costUsd ?? 0);
  return r.data;
}

type Row = { model: string; item: string; case: string; lacking: number; expected: string; answer: string; asExpected: boolean; byModel: boolean; steps: number; guessing: boolean; leaked: string[]; audit?: z.infer<typeof Audit>; ms: number; cost: number; why: string; text: string[] };
const rows: Row[] = [];
const GUESSING = /\b(guess|guessing|assum|imagine|hunch|didn'?t tell|did not tell|never told|wasn'?t told|not sure|my notes don'?t|notes don'?t (?:say|cover)|nothing in my notes|vague)/i;
for (const model of models) {
  (MODELS as { solver: string }).solver = model;
  const jobs = cases.flatMap((c) => Array.from({ length: reps }, () => c));
  const run = async (c: Case) => {
    let cost = 0;
    let why = "";
    const t0 = Date.now();
    const s = await solve(bundle, c.item, c.state, { demo: false, caveat: c.caveat, onCall: (x) => (cost += x.usage.costUsd ?? 0), onError: (e) => (why = String(e).slice(0, 160)) });
    const ms = Date.now() - t0;
    const k = LETTERS.indexOf(s.answer);
    const asExpected = c.expect === "wrong" ? !s.correct : k === c.expect;
    const text = s.steps.map((x) => x.text);
    // a caveat's misreading is Kai's own understanding: "guessing" there counts against it (reported apart)
    const row: Row = { model, item: c.item.id, case: c.name, lacking: c.lacking.length, expected: c.expect === "wrong" ? "wrong" : LETTERS[c.expect]!, answer: s.answer, asExpected, byModel: s.by === "model", steps: s.steps.length, guessing: c.lacking.length || c.caveat ? text.some((t) => GUESSING.test(t)) : true, leaked: s.leaked, ms, cost, why, text };
    if (audit && c.lacking.length && s.by === "model") row.audit = await auditOf(c, text, (x) => (row.cost += x)).catch(() => undefined);
    rows.push(row);
  };
  for (let i = 0; i < jobs.length; i += 4) await Promise.all(jobs.slice(i, i + 4).map(run));
}

const share = (xs: Row[], f: (r: Row) => boolean) => `${xs.filter(f).length}/${xs.length}`;
for (const model of models) {
  const r = rows.filter((x) => x.model === model);
  const ms = r.map((x) => x.ms).sort((a, b) => a - b);
  console.log(`\n${model}  (${r.length} attempts, ${reps} per case)`);
  console.log(`  as predicted ${share(r, (x) => x.asExpected)}, by the model ${share(r, (x) => x.byModel)}, 2 to 5 steps ${share(r.filter((x) => x.byModel), (x) => x.steps >= 2 && x.steps <= 5)}, with nothing taught at most 3 ${share(r.filter((x) => x.byModel && x.case === "skipped"), (x) => x.steps <= 3)}`);
  const lacking = r.filter((x) => x.byModel && x.lacking > 0);
  console.log(`  where a fact was missing: says it is guessing ${share(lacking, (x) => x.guessing)}, lesson terms it wasn't given ${lacking.filter((x) => x.leaked.length).length}`);
  if (audit) {
    const a = lacking.filter((x) => x.audit);
    console.log(`  audit: uses a fact it wasn't told ${share(a, (x) => !!x.audit!.usesUntold)}, says it is guessing ${share(a, (x) => !!x.audit!.saysGuessing)}`);
    for (const x of a.filter((y) => y.audit!.usesUntold).slice(0, 8)) console.log(`    ${x.item} ${x.case}: ${x.audit!.which}`);
  }
  console.log(`  median ${ms[Math.floor(ms.length / 2)]} ms, slowest ${ms.at(-1)} ms, cost $${r.reduce((a, x) => a + x.cost, 0).toFixed(4)}`);
  // the item check, per problem
  for (const item of items) {
    const q = r.filter((x) => x.item === item.id);
    const by = (name: string) => q.filter((x) => x.case === name);
    const full = by("full");
    const fullOk = full.filter((x) => x.asExpected).length >= Math.ceil(0.9 * full.length);
    const withouts = (item.needs ?? []).map((n) => ({ n, xs: by(`without ${n}`) }));
    const withoutOk = withouts.every(({ xs }) => xs.filter((x) => x.asExpected).length >= Math.ceil(0.8 * xs.length));
    const unl = q.filter((x) => x.case.startsWith("unlisted"));
    const unlOk = unl.every((x) => x.asExpected);
    const keep = fullOk && withoutOk && unlOk;
    console.log(`  ${item.id} ${keep ? "keep" : "CHECK"}: full ${share(full, (x) => x.asExpected)}; ${withouts.map(({ n, xs }) => `without ${n} ${share(xs, (x) => x.asExpected)}`).join(", ")}${unl.length ? `; unlisted ${share(unl, (x) => x.asExpected)}` : ""}`);
    for (const name of [...new Set(q.map((x) => x.case))].filter((n) => n.startsWith("vague") || n === "skipped" || n.startsWith("misconception")))
      console.log(`      ${name.padEnd(22)} ${share(by(name), (x) => x.asExpected)} (expected ${by(name)[0]!.expected}; got ${[...new Set(by(name).map((x) => x.answer))].join(", ")})`);
    // the caveats: misread ≥ 8/10 where the notes leave the point open, followed ≥ 9/10 where they say it otherwise
    for (const name of [...new Set(q.map((x) => x.case))].filter((n) => n.startsWith("caveat") || n.startsWith("said"))) {
      const xs = by(name);
      const ok = xs.filter((x) => x.asExpected).length >= Math.ceil((name.startsWith("said") ? 0.9 : 0.8) * xs.length);
      console.log(`      ${name.padEnd(22)} ${share(xs, (x) => x.asExpected)} ${ok ? "ok" : "CHECK"} (expected ${xs[0]!.expected}; got ${[...new Set(xs.map((x) => x.answer))].join(", ")}; by the model ${share(xs, (x) => x.byModel)}${name.startsWith("caveat") ? `; says it is guessing ${share(xs, (x) => x.guessing)}` : ""})`);
    }
  }
  const why = r.filter((x) => x.why).map((x) => `${x.item}/${x.case}: ${x.why}`);
  if (why.length) console.log(`  fallbacks:\n    ${why.slice(0, 10).join("\n    ")}${why.length > 10 ? `\n    … ${why.length - 10} more` : ""}`);
}
if (show)
  for (const x of rows) console.log(`\n[${x.model}] ${x.item}/${x.case} → ${x.answer} (expected ${x.expected})${x.byModel ? "" : " (offline)"}\n  ${x.text.map((t, i) => `${i + 1}. ${t}`).join("\n  ")}`);
mkdirSync("data", { recursive: true });
const file = `data/eval-solver-${new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19)}.json`;
writeFileSync(file, JSON.stringify(rows, null, 2));
console.log(`\nall attempts → ${file}`);
