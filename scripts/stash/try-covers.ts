// A quick check of notesSay (engine/tutor/solve.ts), the judge's call on whether a note says a caveat's point, on the
// notebooks pnpm eval:solver uses for its caveat cases: "open" should be false, "said" true. Real credits (cents).
//   pnpm tsx scripts/stash/try-covers.ts [reps]
for (const f of [".env", ".env.local"]) {
  try {
    process.loadEnvFile?.(f);
  } catch {
    // no file
  }
}
import { readFileSync } from "node:fs";
const { PracticeFile, caveatsOf } = await import("../../content/practice");
const { notesSay } = await import("../../engine/tutor/solve");

const reps = Number(process.argv[2] ?? 4);
const items = PracticeFile.parse(JSON.parse(readFileSync("topics/bandits/practice.json", "utf8"))).items;
const caveat = (id: string) => items.flatMap((p) => caveatsOf(p)).find((c) => c.id === id)!;
// the eval's notebooks (scripts/eval-solver.ts: SAID and CAVEAT_NOTES)
const base = [
  "greedy always goes for whichever option has the best average so far, and if another one's average gets higher it switches",
  "if the best one is unlucky at first its average is too low, greedy never picks it again, so it never finds out it's the best",
  "UCB gives each option a score, its average plus a bonus, and picks the highest score, no randomness",
  "every time you pick an option its bonus gets smaller, picking the others doesn't make it smaller",
];
const cases: [string, string, string[]][] = [
  ["sticks", "open", ["greedy always goes for the option with the best average", ...base.slice(1)]],
  ["sticks", "said", ["greedy goes with whichever average is on top, and when a fresh leader appears it replaces the old favourite", ...base.slice(1)]],
  ["lockin", "open", base],
  ["lockin", "said", [base[0]!, "greedy locks out a good option after a bad start only while that option's average stays under what the others really get; a leader that was just lucky drops back once greedy keeps featuring it", ...base.slice(2)]],
  ["slowing", "open", [...base.slice(2), "the exploration bonus grows when an option is not being picked"]],
  ["slowing", "said", [...base.slice(2), "an unpicked option's bonus keeps rising, but it needs more and more hours to rise by the same amount"]],
];
for (const [id, kind, notes] of cases) {
  const out = await Promise.all(Array.from({ length: reps }, () => notesSay(caveat(id), notes)));
  console.log(`${id.padEnd(8)} ${kind.padEnd(5)} says ${out.filter(Boolean).length}/${reps} (want ${kind === "said" ? reps : 0})`);
}
