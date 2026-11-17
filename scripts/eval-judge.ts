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
const ALL_CASES: Case[] = [
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
  // the pilots of 2026-11-17: UCB's rule credited from its misconception restated (session 8, a correction in practice:
  // Kai then got P3 and P8 right and wrote "a bonus on top of the average", which no note said), and from "the best
  // option with a bonus" (session 6), which leaves out what is added and that the highest total wins
  { kai: "The last one is UCB. How does it decide which option to pick?", msg: "it picks the one with the highest bonus", not: ["n11.f1"], misconception: true },
  {
    kai: "Café 1 uses greedy, so after A's 3 and B's 6 it keeps picking B. My notes say UCB goes for the one with the highest bonus. Both cakes were tried once, so their bonuses stay level and café 2 keeps splitting its days between them. So I'd say B: neither café. (That was Kai's attempt at this problem: Two cafés test the same two new cakes and score each day's sales out of 10. Cake A is truly better: its days usually score between 7 and 9. Cake B's days always score between 5 and 7. On the first two days both cafés try each cake once; in both, A has an unusually bad day (3) and B scores 6. From then on café 1 uses greedy and café 2 uses UCB. Which café ends up selling mostly cake A? Options: A) Both cafés B) Neither café C) Only café 1 D) Only café 2)",
    msg: "no the highest bonus is UCB, greedy always picks the best mean",
    not: ["n11.f1"],
  },
  { kai: "The last one is UCB. How does it decide which option to pick?", msg: "it always picks the best option but with a bonus", want: { "n11.f1": "partial" } },
  // F14: c, set beforehand; its misconception: the bonus adapts to the observed spread
  { msg: "How big the bonuses are is set beforehand with a constant c, depending on how much the lunches usually vary. It doesn't look at the actual lunches.", want: { "n11.f2": "correct" } },
  { msg: "The bonus is bigger for trucks whose lunches have been all over the place.", not: ["n11.f2"], misconception: true },
  // F10: own picks shrink the bonus; its misconception: every bonus shrinks with time
  { msg: "Every time you go to a truck, its bonus gets a bit smaller. Going to the other trucks doesn't make it smaller.", want: { "n12.f1": "correct" } },
  { msg: "All the bonuses shrink over time as the days go by.", not: ["n12.f1"], misconception: true },
  // F11: growth with the round number, ever more slowly; vague without the slowing; its misconception: it stays put
  { msg: "While you don't go to a truck, its bonus keeps growing with the day number, but slower and slower, and it never stops growing.", want: { "n12.f2": "correct" } },
  { msg: "The bonus of a truck you don't visit grows over time.", want: { "n12.f2": "partial" } },
  // the growth without the slowing as the team's testers put it (2026-11-16 and 11-17, credited in full three times,
  // while the case above, the key's own example, passed): partial, whatever it says the growth goes with
  { kai: "The last one is UCB. How does it decide which option to pick?", msg: "It picks the arm with the highest estimated mean plus bonus, where the bonus grows with the number of rounds, when the option is not picked.", want: { "n11.f1": "correct", "n12.f2": "partial" } },
  { kai: "Why would UCB give an option a bonus at all? What is it for?", msg: "it's for exploration. With the bonus, it can keep track of how much it already explored an arm. It shrinks when it is picked and grows otherwise.", want: { "n12.f2": "partial" } },
  { msg: "Now the exploration bonus grows when an option is not being picked, but the number of rounds increases and shrinks when the option is being picked.", want: { "n12.f2": "partial" } },
  { msg: "The bonus of an arm you don't pick grows with the number of rounds, but slower and slower, like a logarithm.", want: { "n12.f2": "correct" } },
  { msg: "If you don't pick a truck, its bonus just stays where it was.", not: ["n12.f2"], misconception: true },
  // the pilot's credits without the key (2026-11-12: the judge now names the words that state a key)
  { kai: "If greedy keeps going like that for many rounds, where does it end up?", msg: "Ideally it ends up choosing the best option all the time.\nHowever when it can happen that the option which is the best in reality has a bad round by chance.\nThis loweres the calculated average, which could prevent the Greedy rule from choosing this option again.\nTo solve this, there is the UCB rule, which applies bonuses", want: { "n06.f1": "correct" }, not: ["n11.f1"] },
  { kai: "Why does UCB need that bonus at all?", msg: "the bonus is needed to prevent the lock in. The bonus is calculated based on how often we have choosen the option already and how mannc rounds we have played so far.", not: ["n12.f1", "n12.f2"] },
  { kai: "If greedy keeps going like that for many rounds, where does it end up?", msg: "It might end up with the best option, it might also choose a worse one, if the actual good option had an unlucky bad first \"experience\"", not: ["n06.f1"] },
  // 2026-11-13 pilot: a lucky leader's average correcting itself is true, not the lock-in misconception (it had been
  // recorded as one, and closed P7's gate); and the benefit of the doubt, counted since that day, needs the doubt
  { kai: "If greedy keeps going like that for many rounds, where does it end up?", msg: "That depends. Greedy can lock in if the first tries are very unlucky: the best arm gets a bad result below another arm's true average, and greedy never corrects it. But if the best arm's first result wasn't that bad and another arm only got lucky, then over many rounds the average of the arm being pulled converges to its true mean. Greedy will eventually switch arms and then keep pulling the best arm.", want: { "n06.f1": "correct" }, misconception: false },
  { kai: "Why would UCB give an option a bonus at all? What is it for?", msg: "It needs this bonus for the trade-off between exploration and exploitation. Without it, it would always take the highest mean and act like greedy; with it, it prioritizes arms that have been explored less.", want: { "n11.f4": "partial" } },
  // 2026-11-13 pilot, terse answers on purpose: each was credited in full; the key's evidence (in code) makes them partial
  { kai: "If greedy keeps going like that for many rounds, where does it end up?", msg: "Greedy can lock in on the wrong arm with an unlucky start.", want: { "n06.f1": "partial" } },
  { kai: "The last one is UCB. How does it decide which option to pick?", msg: "UCB uses a mean and a bonus, and the bonus is higher for less explored options and lower for better exploit options.", want: { "n11.f1": "partial" } },
  { kai: "Why would UCB give an option a bonus at all? What is it for?", msg: "Oh yeah, true, there was the bonus. I think for exploring bad options that are bad get a higher bonus, so we also explore.", want: { "n11.f4": "partial" } },
  { kai: "Why would UCB give an option a bonus at all? What is it for?", msg: "An option you've only tried a couple of times has an average you can't trust yet: it could really be much better than it looks. The bonus gives it the benefit of the doubt.", want: { "n11.f4": "correct" } },
  // spoken, with a word cut off by speech recognition ("logarith-"): the slowing is still there
  { kai: "The last one is UCB. How does it decide which option to pick?", msg: "Generally, UCB doesn't just look at the maximum estimated mean, but it adds a bonus to each mean. Let's call it the exploration bonus and then takes the highest of these scores to decide which arm to pick next. The bonus is dependent on the number of rounds. It grows logarith- in the number of rounds, um but it shrinks linearly or like one over number of pulls.", want: { "n11.f1": "correct", "n12.f2": "correct" } },
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
// cases about an idea the lesson no longer teaches (ε-greedy, n07, since 2026-11-05) are kept here but not run: the
// judge credits an idea outside the lesson only when nothing in it fits, so they would no longer test the lesson
const inLesson = new Set(bundle.nodes.filter((n) => n.inLesson !== false).map((n) => n.id));
const outside = (c: Case) => [...Object.keys(c.want ?? {}), ...(c.not ?? [])].some((f) => !inLesson.has(f.split(".")[0]!));
const CASES = ALL_CASES.filter((c) => !outside(c));
console.log(`${CASES.length} cases (${ALL_CASES.length - CASES.length} about ideas outside the lesson, kept but not run)`);

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
