// Evaluate teaching with Kai's fixed questions (script.json) on three scripted learners, with the live judge.
//   pnpm eval:teach                              the configured judge model
//   pnpm eval:teach --models a/b,c/d --reps 2    compare judge models, 2 runs per learner
// Each learner answers Kai's questions in order (a short answer may be followed by more when Kai asks to say more).
// Per answer the facts it should be credited for and the ones it must not get (its misconceptions); the report
// gives the facts found, false credit, misconceptions found, Kai's replies and the notebook Kai ends with, which is
// what the practice chapter's gate reads. The labels use the fact list of 2026-11-02 (F1 to F15). Costs real credits
// (one judge call per message, about $0.003).

import { readFileSync } from "node:fs";
for (const f of [".env", ".env.local"]) {
  try {
    process.loadEnvFile?.(f);
  } catch {
    // no file
  }
}
const { Bundle } = await import("../content/schema");
const { ScriptFile } = await import("../content/pack");
const { initialScriptState, scriptOpening, takeScriptTurn } = await import("../engine/tutor/script");
const { latest } = await import("../engine/tutor/state");
const { llmJudge } = await import("../engine/tutor/judge");
const { MODELS } = await import("../engine/llm");

const args = process.argv.slice(2);
const models = (args.includes("--models") ? args[args.indexOf("--models") + 1]! : MODELS.judge).split(",");
const reps = Number(args.includes("--reps") ? args[args.indexOf("--reps") + 1] : 1);
const bundle = Bundle.parse(JSON.parse(readFileSync("topics/bandits/bundle.json", "utf8")));
const script = ScriptFile.parse(JSON.parse(readFileSync("topics/bandits/script.json", "utf8")));

// one answer per question, in order; an array: the answer, then what the learner adds when Kai asks to say more
type Answer = { say: string | string[]; want?: Record<string, "correct" | "partial">; not?: string[]; misconception?: boolean };
const LEARNERS: Record<string, Answer[]> = {
  thorough: [
    { say: "Say you pick one of four gyms every evening. Each visit is a bit random, but each gym has a true average quality you don't know, and you only find out how good a visit was at the gym you went to.", want: { "n01.f1": "correct", "n01.f2": "correct" } },
    { say: "Greedy keeps an average for each option and always picks the highest average so far. After every pick it updates that average, and if another option's average overtakes, it switches. What can go wrong: if the best option has a bad first try, its average is too low, greedy never picks it again, and it never finds out it's the best.", want: { "n05.f1": "correct", "n06.f1": "correct" } },
    { say: "It never picks something just to learn more about it." },
    { say: "Each round it draws a random number. With probability epsilon, say 0.1, it picks one of all the options at random, each equally likely, the favourite included. Otherwise it picks the favourite, the highest average.", want: { "n07.f1": "correct", "n07.f2": "correct" } },
    { say: "Epsilon stays the same the whole time, so it keeps exploring at the same rate even when it's sure.", want: { "n07.f1": "correct" } },
    { say: "UCB gives each option a score, its average plus a bonus, and picks the highest score. Say A has average 5 and was tried 20 times and B has average 4.5 with only 2 tries: B's bonus is much bigger, so B can get the higher score, and then UCB picks B.", want: { "n11.f1": "correct" } },
    { say: "Each time an option is picked its bonus shrinks. While it's not picked its bonus keeps growing with the round number, but slower and slower. And how big the bonuses are is set by a constant c that you choose beforehand.", want: { "n12.f1": "correct", "n12.f2": "correct", "n11.f2": "correct" } },
    { say: "Greedy never does it on purpose. Epsilon-greedy does it by a random draw in a fixed share of rounds. UCB does it when another option's average plus its bonus beats the favourite's." },
    { say: "No, I think that's it." },
  ],
  vague: [
    { say: ["choosing stuff", "like restaurants, you pick one each night"] },
    { say: ["greedy goes with the best one", "it sticks with what looks best"], not: [] },
    { say: "no" },
    { say: ["sometimes random", "it does something random sometimes"], want: { "n07.f1": "partial" } },
    { say: "no" },
    { say: ["it adds a bonus", "the bonus thing helps it try stuff"] },
    { say: "the bonus of an option you don't pick grows over time", want: { "n12.f2": "partial" } },
    { say: ["randomness i guess", "not sure"] },
    { say: "no" },
  ],
  misled: [
    { say: "You pick one of a few cafés every day, each with its own unknown average, and you only learn about the one you went to.", want: { "n01.f1": "correct" } },
    { say: "Greedy tries each once and then sticks with the best one forever. Nothing can really go wrong, the averages correct themselves over time.", not: ["n05.f1", "n06.f1"], misconception: true },
    { say: "no" },
    { say: "Epsilon greedy explores a lot at first and less later on, and when it explores it never picks the favourite.", not: ["n07.f1", "n07.f2"], misconception: true },
    { say: "no" },
    { say: "UCB always picks the option you tried the fewest times.", not: ["n11.f1"], misconception: true },
    { say: "All the bonuses shrink as time passes, and an option you don't pick just keeps its bonus.", not: ["n12.f1", "n12.f2"], misconception: true },
    { say: "no" },
    { say: "no" },
  ],
};

for (const model of models) {
  (MODELS as { judge: string }).judge = model;
  let cost = 0;
  let hit = 0, want = 0, falseCredit = 0, miscOk = 0, miscN = 0;
  const notes: string[] = [];
  for (let rep = 0; rep < reps; rep++)
    for (const [name, answers] of Object.entries(LEARNERS)) {
      let state = initialScriptState(bundle, script);
      const history: { role: "kai" | "learner"; text: string }[] = [{ role: "kai", text: scriptOpening(script) }];
      if (rep === 0) console.log(`\n===== ${model}: ${name}\nKai: ${history[0]!.text}`);
      for (const a of answers) {
        if (state.done) break;
        const parts = Array.isArray(a.say) ? [...a.say] : [a.say];
        const got = new Map<string, string>();
        let misc = 0;
        for (let k = 0; k < parts.length; k++) {
          const message = parts[k]!;
          const r = await takeScriptTurn(bundle, script, { message, history, state, elapsedMs: 120_000 }, { judge: (b, m, kai) => llmJudge(b, m, kai, (c) => (cost += c.usage.costUsd ?? 0)) });
          history.push({ role: "learner", text: message }, { role: "kai", text: r.reply });
          state = r.state;
          for (const v of r.trace.judged) got.set(v.fact, v.verdict);
          misc += r.trace.misconceptions.length;
          if (rep === 0)
            console.log(`You: ${message}\n  judge: ${r.trace.intent}; ${r.trace.judged.map((v) => `${v.fact}:${v.verdict}`).join(" ") || "no facts"}${r.trace.misconceptions.length ? `; misconception ${r.trace.misconceptions.map((m) => `${m.node} "${m.quote}"`).join("; ")}` : ""}\nKai (${r.mood}): ${r.reply}`);
          // a follow-up only when Kai asked to say more
          if (!r.trace.script.sayMore) break;
        }
        for (const [f, v] of Object.entries(a.want ?? {})) {
          want++;
          if (got.get(f) === v) hit++;
          else notes.push(`${name}: expected ${f} ${v}, got ${got.get(f) ?? "nothing"} ("${parts[0]!.slice(0, 50)}…")`);
        }
        for (const f of a.not ?? []) if (got.get(f) === "correct") (falseCredit++, notes.push(`${name}: wrongly credited ${f}`));
        if (a.misconception !== undefined) (miscN++, misc > 0 === a.misconception ? miscOk++ : notes.push(`${name}: misconception ${a.misconception ? "missed" : "invented"} ("${parts[0]!.slice(0, 50)}…")`));
      }
      if (rep === 0) {
        const nb = latest(state);
        console.log(`  notebook: ${[...nb.values()].map((e) => `${e.fact}:${e.verdict}`).join(" ") || "empty"}; misconceptions ${state.misconceptions.length}; done ${state.done}`);
      }
    }
  console.log(`\n${model}: facts found ${hit}/${want}, false credit ${falseCredit}, misconceptions ${miscOk}/${miscN}, cost $${cost.toFixed(4)}`);
  if (notes.length) console.log(`  ${notes.join("\n  ")}`);
}
