import { describe, expect, it } from "vitest";
import bundleJson from "../topics/bandits/bundle.json";
import practiceJson from "../topics/bandits/practice.json";
import stashedJson from "../topics/bandits/stash/practice.json";
import { Bundle } from "../content/schema";
import { PracticeFile } from "../content/practice";
import { isAbout, sentenceLike, sentencesOf, settleReply, type Reply } from "../engine/tutor/judge";
import { gate } from "../engine/tutor/solve";
import { activeMisconceptions, initialState, type State } from "../engine/tutor/state";

const bundle = Bundle.parse(bundleJson);
const items = [...PracticeFile.parse(practiceJson).items, ...PracticeFile.parse(stashedJson).items]; // P4 is stashed, still a good case
const item = (id: string) => items.find((p) => p.id === id)!;

// the checks in code around the judge (2026-11-05, after the pilot)
describe("the checks around the judge", () => {
  it("recovers the learner's own sentence when the judge quoted the fact instead, and nothing else", () => {
    const m = "UCB gives each option a score equal to its average plus a bonus, Q + c·sqrt(ln t / n), and always picks the option with the highest score, so there is no randomness. Here c is a constant chosen in advance.";
    expect(sentenceLike(m, "UCB gives each option a score, its average plus a bonus, and picks the option with the highest score. There is no randomness.")).toMatch(/^UCB gives each option a score equal to/);
    expect(sentenceLike(m, "the bonus grows when you pick it every time and the bonus shrinks")).toBeNull();
    expect(sentenceLike(m, "the bonus")).toBeNull(); // too short to stand on
  });

  it("lets a wrong belief block a fact only when its words are about that fact", () => {
    const cases: [string, string, boolean][] = [
      ["Also remember that with ε-greedy, when it explores it only tries the options that aren't the current favourite", "n12.f1", false],
      ["with UCB an option's bonus stays exactly the same while you skip it", "n12.f2", true],
      ["an option you don't pick just keeps its bonus", "n12.f2", true],
      ["it picks one of the other options, never the current favourite", "n07.f2", true],
      ["It explores a lot at the start and less and less later", "n07.f1", true],
      ["never switches away from it", "n05.f1", true],
      ["Because the averages correct themselves over time, it ends up finding the best option", "n06.f1", true],
      ["UCB always picks the option you tried the fewest times", "n11.f1", true],
      ["the bonus depends on how much the rewards vary", "n11.f2", true],
      ["Because A has been pulled more often its bonus will be bigger", "n12.f1", true],
      ["Greedy tries each option once, then sticks with the best one forever", "n12.f1", false],
      ["It will keep pulling wrong arms here and there, but it will explore much faster than greedy", "n12.f1", false],
    ];
    for (const [q, f, want] of cases) expect(isAbout(bundle, q, f), `${f}: ${q}`).toBe(want);
  });
});

describe("the judge's verdict stands: no word lists around it (2026-11-16)", () => {
  const reply = (facts: Reply["facts"], misconceptions: NonNullable<Reply["misconceptions"]> = []): Reply => ({ intent: "answer", facts, misconceptions });
  const v = (fact: string, verdict: "correct" | "partial" | "wrong", quote: string) => ({ fact, verdict, quote, before: "", after: "" });
  const verdictOf = (j: ReturnType<typeof settleReply>, id: string) => j.facts.find((f) => f.fact === id)?.verdict;
  const mis = (node: string, quote: string) => ({ node, fact: "none", quote, belief: "(the judge's summary)", before: "", after: "" });

  it("keeps a correct verdict in spoken, everyday words as the judge gave it (R's run, 2026-11-14)", () => {
    // from 2026-11-12 to 2026-11-16 word lists turned each of these partial, and the learner never got to say more
    const cases: [string, string, string][] = [
      ["n12.f1", "And the bonus makes it so that it continues growing if it's not picked. However, if it's picked, it will take a dip and not grow infinitely.", "if it's picked, it will take a dip and not grow infinitely"],
      ["n11.f1", "It gives the bonus because it basically increases the average of that um option every round and once it gets higher than the other ones, then it picks and picks that one.", "once it gets higher than the other ones, then it picks and picks that one"],
      ["n11.f4", "the bonus is our certainty in that value. So we are saying that there is a chance we gotten lucky and to see that we need to try some of those options.", "there is a chance we gotten lucky"],
      ["n06.f1", "Greedy can lock in on the wrong arm with an unlucky start.", "Greedy can lock in on the wrong arm with an unlucky start"],
    ];
    for (const [fact, m, q] of cases) {
      const j = settleReply(bundle, m, "", reply([v(fact, "correct", q)]));
      expect(verdictOf(j, fact), q).toBe("correct");
      expect(j.dropped, q).toEqual([]);
    }
    // and a partial one stays partial: what is vague is for Kai's follow-up question to ask about
    const p = settleReply(bundle, "UCB uses a mean and a bonus.", "", reply([v("n11.f1", "partial", "UCB uses a mean and a bonus")]));
    expect([verdictOf(p, "n11.f1"), p.dropped!.length]).toEqual(["partial", 0]);
  });

  it("drops the lucky leader's correction when the judge records it as a wrong belief", () => {
    const m = "That depends. Greedy can lock in if the first tries are very unlucky: the best arm gets a bad result below another arm's true average, and greedy never corrects it. But if the best arm's first result wasn't that bad and another arm only got lucky, then over many rounds the average of the arm being pulled converges to its true mean. Greedy will eventually switch arms and then keep pulling the best arm.";
    for (const [node, quote] of [["n05", "Greedy will eventually switch arms and then keep pulling the best arm"], ["n05", "But if the best arm's first result wasn't that bad and another arm only got lucky, then over many rounds"], ["n06", "the average of the arm being pulled converges to its true mean"]] as const) {
      const j = settleReply(bundle, m, "", reply([], [mis(node, quote)]));
      expect(j.misconceptions, quote).toEqual([]);
      expect(j.dropped!.some((d) => /a true remark/.test(d.fact))).toBe(true);
    }
    expect(settleReply(bundle, "If the leader only got lucky, greedy keeps picking it, its average falls back towards its true value and greedy switches.", "", reply([], [mis("n06", "greedy switches")])).misconceptions).toEqual([]);
  });
  it("drops the division by zero as a wrong belief: it is why UCB tries each option once (R's pilot run)", () => {
    const m = "Uh, yes. So, every option needs to be picked at least once because on UCB, if it is not picked once, at the start, then it will cause problems because it is mathematically impossible to divide by zero.";
    for (const node of ["n11", "n03"]) expect(settleReply(bundle, m, "", reply([], [mis(node, "it will cause problems because it is mathematically impossible to divide by zero")])).misconceptions, node).toEqual([]);
  });
  it("keeps the real belief that greedy's averages fix themselves and it always ends up on the best", () => {
    for (const m of [
      "Greedy is fine in the long run, the averages fix themselves and it ends up at the best truck.",
      "Greedy's averages keep correcting themselves as it runs, so café 1 will drift over to cake A eventually.",
      "Once it settles on one, it sticks with that one forever and never switches. The averages end up fixing any early mistakes.",
    ]) {
      const j = settleReply(bundle, m, "", reply([], [mis("n06", m.split(". ").pop()!.replace(/\.$/, ""))]));
      expect(j.misconceptions, m).toHaveLength(1);
    }
  });
  it("sets a fact taught and contradicted in one message to partial, the belief aside", () => {
    const m = "UCB adds a bonus to each average and picks the highest total, and that bonus grows every time you pick the option.";
    const j = settleReply(bundle, m, "", reply([v("n12.f1", "correct", "that bonus grows every time you pick the option")], [{ ...mis("n12", "that bonus grows every time you pick the option"), fact: "n12.f1" }]));
    expect([verdictOf(j, "n12.f1"), j.misconceptions]).toEqual(["partial", []]);
  });
  it("looks at the sentence that holds a quote, widened when asked", () => {
    const m = "Greedy always takes the best average. Epsilon greedy sometimes picks at random. One more.";
    expect(sentencesOf(m, "sometimes picks at random")).toBe(" Epsilon greedy sometimes picks at random.");
    expect(sentencesOf(m, "sometimes picks at random", 0, 1)).toBe("Greedy always takes the best average. Epsilon greedy sometimes picks at random.");
    expect(sentencesOf(m, "not in it")).toBe(m);
  });
});

describe("the practice gate and wrong beliefs", () => {
  const taught = (facts: string[], extra: Partial<State> = {}): State => ({
    ...initialState(bundle),
    turn: 2,
    notebook: facts.map((fact) => ({ fact, verdict: "correct" as const, words: `about ${fact}`, turn: 1 })),
    ...extra,
  });
  const p4 = item("p4"); // needs n11.f1 and n12.f1

  it("blocks only the fact a wrong belief contradicts", () => {
    const base = taught(p4.needs!);
    expect(gate(p4, base).canBeRight).toBe(true);
    // a wrong belief about what a pick does to the bonus blocks p4
    expect(gate(p4, { ...base, misconceptions: [{ node: "n12", fact: "n12.f1", words: "every bonus shrinks each round", turn: 2 }] }).canBeRight).toBe(false);
    // one about another fact of the idea (or none at all) doesn't
    expect(gate(p4, { ...base, misconceptions: [{ node: "n12", fact: null, words: "it explores much faster than greedy", turn: 2 }] }).canBeRight).toBe(true);
    expect(gate(p4, { ...base, misconceptions: [{ node: "n12", fact: "n12.f2", words: "a skipped option's bonus stays the same", turn: 2 }] }).canBeRight).toBe(true);
    // an older notebook's belief, without the fact, still blocks its whole idea
    expect(gate(p4, { ...base, misconceptions: [{ node: "n12", words: "every bonus shrinks each round", turn: 2 }] }).canBeRight).toBe(false);
  });

  it("retires a wrong belief when a later message teaches the fact it contradicts", () => {
    const belief = { node: "n07", fact: "n07.f2", words: "never the favourite", turn: 2 };
    const later = taught([], { notebook: [{ fact: "n07.f2", verdict: "correct", words: "any option, the favourite too", turn: 3 }], misconceptions: [belief] });
    expect(activeMisconceptions(later)).toEqual([]);
    const earlier = taught([], { notebook: [{ fact: "n07.f2", verdict: "correct", words: "any option, the favourite too", turn: 1 }], misconceptions: [belief] });
    expect(activeMisconceptions(earlier)).toHaveLength(1);
  });
});
