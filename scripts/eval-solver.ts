// Evaluate Kai's solver (recursive feedback) on every practice problem and several notebooks.
//   pnpm eval:solver                                   the configured solver model
//   pnpm eval:solver --models a/b,c/d --reps 2         compare models (OpenRouter ids), 2 runs per case
//   pnpm eval:solver --show                            also print every attempt's steps
// Notebooks: skipped (teaching skipped), partial (one needed fact explained), vague (all partly
// explained), misconception (a wrong belief taught), full (every needed fact explained).
// Checks per attempt: right only when the notebook allows it (the gate), answered by the model (not
// the offline fallback), 3 to 5 steps, no turnaround at the end. Costs real credits (about $0.001 a call).

import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
for (const f of [".env", ".env.local"]) {
  try {
    process.loadEnvFile?.(f);
  } catch {
    // no file
  }
}
const { Bundle } = await import("../content/schema");
const { PracticeFile } = await import("../content/practice");
const { initialState } = await import("../engine/tutor/state");
const { solve } = await import("../engine/tutor/solve");
const { MODELS } = await import("../engine/llm");

const args = process.argv.slice(2);
const opt = (name: string) => (args.includes(name) ? args[args.indexOf(name) + 1] : undefined);
const models = (opt("--models") ?? MODELS.solver).split(",").map((m) => m.trim()).filter(Boolean);
const reps = Number(opt("--reps") ?? 1);
const show = args.includes("--show");

const bundle = Bundle.parse(JSON.parse(readFileSync("topics/bandits/bundle.json", "utf8")));
const items = PracticeFile.parse(JSON.parse(readFileSync("topics/bandits/practice.json", "utf8"))).items;

// what a learner might have said for each fact the problems need
const SAID: Record<string, string> = {
  "n03.f1": "you judge each option by the average of what it gave you so far",
  "n05.f1": "greedy always goes for whatever has the best average so far",
  "n05.f2": "greedy never tries the others again just to learn, so a bad first try sticks",
  "n06.f1": "if the best one is unlucky at first, greedy might never find out it's the best",
  "n07.f1": "epsilon greedy takes the best average most of the time, but with probability epsilon it picks a random option",
  "n07.f2": "that random pick is among all the options, the favourite too, and it ignores the averages",
  "n11.f2": "UCB gives each option a score, its average plus a bonus that's bigger when you tried it less, and picks the highest score",
  "n12.f1": "every time you try an option its bonus gets smaller",
};
// vague versions: on topic but missing the key part, as a learner who only half explains it
const VAGUE: Record<string, string> = {
  "n05.f1": "greedy goes with the good one",
  "n05.f2": "greedy doesn't really go back much",
  "n07.f1": "epsilon greedy sometimes does something random",
  "n07.f2": "the random part is kind of spread out",
  "n11.f2": "UCB adds some bonus thing to the numbers",
  "n12.f1": "the bonus changes over time",
};
type Profile = { name: string; expectRight: boolean; state: (needs: string[], misconception: string) => ReturnType<typeof initialState> };
const entry = (fact: string, verdict: "correct" | "partial", turn: number) => ({ fact, verdict, words: (verdict === "partial" ? VAGUE[fact] : SAID[fact]) ?? `something about ${fact}`, turn });
const PROFILES: Profile[] = [
  { name: "skipped", expectRight: false, state: () => initialState(bundle) },
  { name: "partial", expectRight: false, state: (needs) => ({ ...initialState(bundle), turn: 1, notebook: needs.length > 1 ? [entry(needs[0]!, "correct", 1)] : [entry("n05.f1", "correct", 1)] }) },
  { name: "vague", expectRight: false, state: (needs) => ({ ...initialState(bundle), turn: needs.length, notebook: needs.map((f, i) => entry(f, "partial", i + 1)) }) },
  {
    name: "misconception",
    expectRight: false,
    state: (needs, words) => ({ ...initialState(bundle), turn: needs.length + 1, notebook: needs.slice(0, -1).map((f, i) => entry(f, "correct", i + 1)), misconceptions: [{ node: needs.at(-1)!.split(".")[0]!, words, turn: needs.length + 1 }] }),
  },
  { name: "full", expectRight: true, state: (needs) => ({ ...initialState(bundle), turn: needs.length, notebook: needs.map((f, i) => entry(f, "correct", i + 1)) }) },
];

type Row = { model: string; item: string; profile: string; ok: boolean; byModel: boolean; steps: number; ms: number; cost: number; why: string; answer: string; text: string[] };
const rows: Row[] = [];
for (const model of models) {
  (MODELS as { solver: string }).solver = model;
  const jobs = items.flatMap((item) => PROFILES.flatMap((pr) => Array.from({ length: reps }, () => ({ item, pr }))));
  const run = async ({ item, pr }: (typeof jobs)[number]) => {
    // a need may be alternatives ("n11.f1|n11.f2"): teach the one a learner would phrase (the one with a sentence here)
    const needs = (item.needs ?? []).map((n) => n.split("|").find((f) => SAID[f]) ?? n.split("|")[0]!);
    const words = (item.beliefs ?? []).find((b) => (item.needs ?? []).at(-1)!.split("|").includes(b.replaces))?.belief.toLowerCase().replace(/\.$/, "") ?? "it works some other way";
    let cost = 0;
    let why = "";
    const t0 = Date.now();
    const s = await solve(bundle, item, pr.state(needs, words), { demo: false, onCall: (c) => (cost += c.usage.costUsd ?? 0), onError: (e) => (why = String(e).slice(0, 140)) });
    rows.push({ model, item: item.id, profile: pr.name, ok: s.correct === pr.expectRight, byModel: s.by === "model", steps: s.steps.length, ms: Date.now() - t0, cost, why, answer: s.answer, text: s.steps.map((x) => x.text) });
  };
  for (let i = 0; i < jobs.length; i += 3) await Promise.all(jobs.slice(i, i + 3).map(run));
}

for (const model of models) {
  const r = rows.filter((x) => x.model === model);
  const pct = (f: (x: Row) => boolean) => `${Math.round((r.filter(f).length / r.length) * 100)}%`;
  const ms = r.map((x) => x.ms).sort((a, b) => a - b);
  console.log(`\n${model}  (${r.length} attempts)`);
  console.log(`  gate respected ${pct((x) => x.ok)}, answered by the model ${pct((x) => x.byModel)}, 3 to 5 steps ${pct((x) => x.byModel && x.steps >= 3 && x.steps <= 5)}`);
  console.log(`  median ${ms[Math.floor(ms.length / 2)]} ms, slowest ${ms.at(-1)} ms, cost $${r.reduce((a, x) => a + x.cost, 0).toFixed(4)}`);
  for (const p of PROFILES) {
    const q = r.filter((x) => x.profile === p.name);
    console.log(`  ${p.name.padEnd(14)} gate ${q.filter((x) => x.ok).length}/${q.length}, by model ${q.filter((x) => x.byModel).length}/${q.length}`);
  }
  const why = r.filter((x) => x.why).map((x) => `${x.item}/${x.profile}: ${x.why}`);
  if (why.length) console.log(`  fallbacks:\n    ${why.slice(0, 8).join("\n    ")}${why.length > 8 ? `\n    … ${why.length - 8} more` : ""}`);
}
if (show)
  for (const x of rows) console.log(`\n[${x.model}] ${x.item}/${x.profile} → ${x.answer} ${x.ok ? "as expected" : "NOT as expected"}${x.byModel ? "" : " (offline)"}\n  ${x.text.map((t, i) => `${i + 1}. ${t}`).join("\n  ")}`);
mkdirSync("data", { recursive: true });
const file = `data/eval-solver-${new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19)}.json`;
writeFileSync(file, JSON.stringify(rows, null, 2));
console.log(`\nall attempts → ${file}`);
