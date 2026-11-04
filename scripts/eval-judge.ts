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

type Case = { kai?: string; msg: string; want?: Record<string, "correct" | "partial" | "wrong">; not?: string[]; intent?: string; misconception?: boolean };
// The lesson's facts (F1 to F15 in the team's item design): given ones (n01, n03, n16) and teachable ones with the
// misconception Kai assumes when they weren't explained. Each teachable fact has a right version, and its misconception
// stated as a learner would, which must not get credit. n12.f2 also has a vague version (growth without its slowing).
const CASES: Case[] = [
  { kai: "So what exactly is the problem we're solving here? What do I get to choose each time?", msg: "Every day you pick one of three food trucks for lunch. Each truck's lunches are random around some true average that you don't know.", want: { "n01.f1": "correct" }, intent: "answer" },
  { kai: "When I pick one option, do I find out anything about the others?", msg: "no, you only see how good the lunch was at the truck you went to", want: { "n01.f2": "correct" } },
  { msg: "You keep the average of what each truck gave you so far, that's your guess of how good it is.", want: { "n03.f1": "correct" } },
  // F4: greedy follows the leader and switches; its misconception commits after the first tries
  { msg: "Greedy always picks the truck with the best average so far, and if another truck's average gets higher it switches to that one.", want: { "n05.f1": "correct" }, not: ["n07.f1", "n11.f1"] },
  { msg: "Greedy always picks the truck with the best average so far.", want: { "n05.f1": "correct" } },
  { msg: "Greedy just picks whatever looked best after the first day and then stays there for the rest of the year.", not: ["n05.f1"], misconception: true },
  // F5: lock-in; its misconception: the averages fix themselves
  { msg: "If the best truck has one bad lunch at the start, greedy might never go back to it, so it never finds out it's actually the best.", want: { "n06.f1": "correct" } },
  { msg: "Greedy is fine in the long run, the averages fix themselves and it ends up at the best truck.", not: ["n06.f1"], misconception: true },
  // F6: a fixed ε, early and late; its misconception: exploring fades
  { msg: "Epsilon greedy picks a random truck with probability epsilon, like 10% of the days, and otherwise the best average. That stays 10% the whole year.", want: { "n07.f1": "correct" } },
  { msg: "Epsilon greedy explores a lot at the start and then less and less once it knows which truck is best.", not: ["n07.f1"], misconception: true },
  // F7: a random pick among all, the favourite included; its misconception: never the favourite
  { msg: "When it picks randomly, every truck has the same chance, including the one with the best average.", want: { "n07.f2": "correct" } },
  { msg: "When epsilon greedy explores, it goes to one of the other trucks, never the favourite.", not: ["n07.f2"], misconception: true },
  { msg: "Exploring is trying trucks to learn about them, exploiting is going to the one that looks best.", want: { "n08.f1": "correct" } },
  // F9: the score and the highest one; its misconception: the least tried
  { msg: "UCB gives every truck a score, its average plus a bonus, and always picks the highest score. There's no randomness in it.", want: { "n11.f1": "correct" }, not: ["n05.f1"] },
  { msg: "UCB always goes to the truck you've tried the fewest times.", not: ["n11.f1"], misconception: true },
  // F14: c, set beforehand; its misconception: the bonus adapts to the observed spread
  { msg: "How big the bonuses are is set beforehand with a constant c, depending on how much the lunches usually vary. It doesn't look at the actual lunches.", want: { "n11.f2": "correct" } },
  { msg: "The bonus is bigger for trucks whose lunches have been all over the place.", not: ["n11.f2"], misconception: true },
  // F10: own picks shrink the bonus; its misconception: every bonus shrinks with time
  { msg: "Every time you go to a truck, its bonus gets a bit smaller. Going to the other trucks doesn't make it smaller.", want: { "n12.f1": "correct" } },
  { msg: "All the bonuses shrink over time as the days go by.", not: ["n12.f1"], misconception: true },
  // F11: growth with the round number, ever more slowly; vague without the slowing; its misconception: it stays put
  { msg: "While you don't go to a truck, its bonus keeps growing with the day number, but slower and slower, and it never stops growing.", want: { "n12.f2": "correct" } },
  { msg: "The bonus of a truck you don't visit grows over time.", want: { "n12.f2": "partial" } },
  { msg: "If you don't pick a truck, its bonus just stays where it was.", not: ["n12.f2"], misconception: true },
  // teaching something other than what Kai asked: it still counts
  { kai: "Could greedy ever make a mistake and never realize it?", msg: "Epsilon greedy is greedy most of the time, but with a small probability epsilon it explores, and when it explores it goes to the truck it has visited the least.", want: { "n07.f1": "partial" }, misconception: true }, // 2026-11-05: partial (was correct): n07.f1's key is that the rate stays fixed, which its practice items test; "with a small probability" leaves open whether it shrinks
  // mixed messages: a right part and a wrong part in one go, as learners write; the right part must still count
  { msg: "Epsilon greedy picks randomly 10% of the time, and when it does it always goes to the truck it knows least about.", want: { "n07.f1": "correct" }, not: ["n07.f2"], misconception: true },
  { msg: "UCB adds a bonus to each average and picks the option with the highest total, and that bonus grows every time you pick the option.", want: { "n11.f1": "correct" }, not: ["n12.f1"], misconception: true },
  // short answers to Kai's question: the note must turn them into a sentence that stands alone (reported, not scored)
  { kai: "So what exactly am I choosing between each time?", msg: "between food trucks" },
  { kai: "And when greedy picks a truck, what does it remember about it afterwards?", msg: "you store its average" },
  { kai: "With that rule, would I ever pick an option just to find out more about it?", msg: "nope, never", want: { "n05.f2": "correct" } }, // a real "no" still counts
  { msg: "idk", intent: "unsure", not: ["n01.f1", "n05.f1"] },
  // after "i dunno": "not this either" is still not knowing, never a "no" that answers Kai's question (a real bug)
  { kai: "Oh, you aren't sure either, and that is totally fine. When I pick one option, do I find out anything about the others?", msg: "nope, not this either", intent: "unsure", not: ["n01.f2"] },
  { msg: "ok what's next?", intent: "move_on" },
  { msg: "Is this like the slot machines in a casino?", intent: "ask_kai" },
];

for (const model of models) {
  (MODELS as { judge: string }).judge = model;
  let hit = 0, want = 0, falseCredit = 0, intentOk = 0, intentN = 0, miscOk = 0, miscN = 0, errors = 0;
  const ms: number[] = [];
  const notes: string[] = [];
  let noteN = 0, noteKept = 0;
  const samples: string[] = [];
  await Promise.all(
    Array.from({ length: reps }, () => CASES).flat().map(async (c, k) => {
      const i = k % CASES.length;
      const t = Date.now();
      try {
        const j = await llmJudge(bundle, c.msg, c.kai ?? "Could you teach me?", undefined, { timeoutMs: 30_000, retries: 0 });
        ms.push(Date.now() - t);
        const got = new Map(j.facts.map((f) => [f.fact, f.verdict]));
        // Kai's notes: a whole sentence around the learner's words (notes.ts), else the bare quote
        for (const d of j.notesDropped ?? []) samples.push(`#${i + 1} refused "${d.note}" (${d.why})`);
        for (const v of [...j.facts, ...(j.misconceptions ?? [])]) {
          noteN++;
          if (v.note) noteKept++;
          if (samples.length < 24 && (c.kai || v.note)) samples.push(`#${i + 1} "${v.quote}" → ${v.note ? `"${v.note}"` : "(the quote alone)"}`);
        }
        for (const [f, v] of Object.entries(c.want ?? {})) {
          want++;
          if (got.get(f) === v) hit++;
          else if (v === "correct" && got.get(f) === "partial") (hit += 0.5, notes.push(`#${i + 1} only partial for ${f}`));
          else if (v === "partial" && got.get(f) === "correct") notes.push(`#${i + 1} credited a vague ${f} as correct`);
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
  console.log(`  notes with Kai's words added ${noteKept}/${noteN} (the rest: the learner's words alone, or their whole sentence)${samples.length ? `\n    ${samples.join("\n    ")}` : ""}`);
  if (notes.length) console.log(`  ${notes.join("\n  ")}`);
}
