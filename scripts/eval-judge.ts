// Evaluate the judge (the study's measuring instrument) on labelled teacher messages.
//   pnpm eval:judge                                        the configured judge model
//   pnpm eval:judge --models google/gemini-3.5-flash-lite,anthropic/claude-haiku-5.5
// For each message: the facts it should get credit for (and with which verdict), facts it must not get,
// the intent, and whether it states a misconception. Reports recall, false credit, intent and
// misconception accuracy, and speed. Costs real credits (about $0.0005 a call).

import { readFileSync } from "node:fs";
for (const f of [".env", ".env.local"]) {
  try {
    process.loadEnvFile?.(f);
  } catch {
    // no file
  }
}
const { Bundle } = await import("../content/schema");
const { llmJudge } = await import("../engine/tutor/judge");
const { MODELS } = await import("../engine/llm");

const args = process.argv.slice(2);
const models = (args.includes("--models") ? args[args.indexOf("--models") + 1]! : MODELS.judge).split(",");
const reps = Number(args.includes("--reps") ? args[args.indexOf("--reps") + 1] : 1);
const bundle = Bundle.parse(JSON.parse(readFileSync("topics/bandits/bundle.json", "utf8")));

type Case = { kai?: string; msg: string; want?: Record<string, "correct" | "wrong">; not?: string[]; intent?: string; misconception?: boolean };
const CASES: Case[] = [
  { kai: "So what exactly is the problem we're solving here? What do I get to choose each time?", msg: "So imagine you go out to eat every night and there are a few restaurants. You don't know which one is best, you only find out by eating there.", want: { "n01.f1": "correct" }, intent: "answer" },
  { kai: "Do I know in advance how good each option is?", msg: "no, you only find out by trying, and even then each night is a bit random", want: { "n01.f2": "correct" } },
  { msg: "Every night you choose one of three restaurants to eat at, again and again.", want: { "n01.f1": "correct" }, intent: "explain" },
  { msg: "Each visit gives you a random amount of happiness, and you can't see how good each place really is on average.", want: { "n01.f2": "correct" } },
  { msg: "You keep the average of what each restaurant gave you so far, that's your guess of how good it is.", want: { "n03.f1": "correct" } },
  { msg: "Greedy always picks the restaurant with the best average so far.", want: { "n05.f1": "correct" }, not: ["n07.f1", "n11.f2"] },
  { kai: "With that rule, would I ever go back to an option that looked bad early on?", msg: "no, never, it doesn't try the others again just to learn", want: { "n05.f2": "correct" }, intent: "answer" },
  { msg: "If the best place gives you one bad night at the start, greedy might never find out it's actually the best.", want: { "n06.f1": "correct" } },
  { msg: "Epsilon greedy picks a random restaurant with probability epsilon, like 10% of the time, and otherwise the best average.", want: { "n07.f1": "correct" } },
  { msg: "When epsilon greedy explores, it goes to the restaurant it has visited the least.", not: ["n07.f2"], misconception: true },
  { msg: "Its random picks don't care about the averages, so it wastes as many on restaurants it knows are bad as on the others.", want: { "n07.f2": "correct" } },
  { msg: "Exploring is trying places to learn about them, exploiting is going to the best one you know.", want: { "n08.f1": "correct" } },
  { msg: "UCB adds a bonus to each average that's bigger for options you tried less, and picks the highest total.", want: { "n11.f2": "correct" }, not: ["n05.f1"] },
  { msg: "Every time you try an option, its bonus gets a bit smaller.", want: { "n12.f1": "correct" } },
  { msg: "Greedy is the smartest strategy, it always finds the best restaurant in the end.", misconception: true, not: ["n05.f2", "n06.f1"] },
  // teaching something other than what Kai asked: it still counts
  { kai: "Could greedy ever make a mistake and never realize it?", msg: "Epsilon greedy is greedy most of the time, but with a small probability epsilon it explores, and when it explores it goes to the restaurant it has visited the least.", want: { "n07.f1": "correct" }, misconception: true },
  { kai: "So what do I actually choose between each time?", msg: "Greedy always goes to the restaurant with the best average so far and never tries the others again just to learn.", want: { "n05.f1": "correct", "n05.f2": "correct" } },
  // mixed messages: a right part and a wrong part in one go, as learners write; the right part must still count
  { msg: "Epsilon greedy is greedy most of the time, but with a small probability epsilon it explores, and when it explores it goes to the restaurant it has visited the least.", want: { "n07.f1": "correct" }, not: ["n07.f2"], misconception: true },
  { msg: "UCB adds a bonus to each average and picks the option with the highest total, and that bonus grows every time you pick the option.", want: { "n11.f1": "correct" }, misconception: true },
  { msg: "idk", intent: "unsure", not: ["n01.f1", "n05.f1"] },
  { msg: "ok what's next?", intent: "move_on" },
  { msg: "Is this like the slot machines in a casino?", intent: "ask_kai" },
];

for (const model of models) {
  (MODELS as { judge: string }).judge = model;
  let hit = 0, want = 0, falseCredit = 0, intentOk = 0, intentN = 0, miscOk = 0, miscN = 0, errors = 0;
  const ms: number[] = [];
  const notes: string[] = [];
  await Promise.all(
    Array.from({ length: reps }, () => CASES).flat().map(async (c, k) => {
      const i = k % CASES.length;
      const t = Date.now();
      try {
        const j = await llmJudge(bundle, c.msg, c.kai ?? "Could you teach me?", undefined, { timeoutMs: 30_000, retries: 0 });
        ms.push(Date.now() - t);
        const got = new Map(j.facts.map((f) => [f.fact, f.verdict]));
        for (const [f, v] of Object.entries(c.want ?? {})) {
          want++;
          if (got.get(f) === v) hit++;
          else if (v === "correct" && got.get(f) === "partial") (hit += 0.5, notes.push(`#${i + 1} only partial for ${f}`));
          else notes.push(`#${i + 1} missed ${f} (${got.get(f) ?? "none"})`);
        }
        for (const f of c.not ?? []) if (got.get(f) === "correct") (falseCredit++, notes.push(`#${i + 1} wrongly credited ${f}`));
        if (c.intent) (intentN++, j.intent === c.intent ? intentOk++ : notes.push(`#${i + 1} intent ${j.intent}, expected ${c.intent}`));
        if (c.misconception !== undefined) (miscN++, (j.misconceptions?.length ?? 0) > 0 === c.misconception ? miscOk++ : notes.push(`#${i + 1} misconception ${c.misconception ? "missed" : "invented"}`));
      } catch (e) {
        errors++;
        notes.push(`#${i + 1} error ${String(e).slice(0, 80)}`);
      }
    }),
  );
  ms.sort((a, b) => a - b);
  console.log(`\n${model}`);
  console.log(`  facts found ${hit}/${want}, false credit ${falseCredit}, intent ${intentOk}/${intentN}, misconceptions ${miscOk}/${miscN}, errors ${errors}`);
  console.log(`  median ${ms[Math.floor(ms.length / 2)]} ms, slowest ${ms.at(-1)} ms`);
  if (notes.length) console.log(`  ${notes.join("\n  ")}`);
}
