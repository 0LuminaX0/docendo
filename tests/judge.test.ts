import { describe, expect, it } from "vitest";
import bundleJson from "../topics/bandits/bundle.json";
import practiceJson from "../topics/bandits/practice.json";
import stashedJson from "../topics/bandits/stash/practice.json";
import { Bundle } from "../content/schema";
import { PracticeFile } from "../content/practice";
import { isAbout, sentenceLike, sentencesOf } from "../engine/tutor/judge";
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

describe("the evidence a key needs (a check in code around the judge)", () => {
  const ev = (id: string) => new RegExp(bundle.nodes.flatMap((n) => n.facts).find((f) => f.id === id)!.evidence!, "iu");
  it("finds the bonus's slowing growth in the learner's own words, and not in a vague answer", () => {
    for (const m of ["it keeps growing but by less each time", "the growth gets smaller", "it grows more gently as time goes on", "grows slower and slower", "the ln t term keeps growing", "it grows logarithmically", "grows without limit but more and more slowly", "like sqrt(log t)"]) expect(ev("n12.f2").test(m), m).toBe(true);
    for (const m of ["the ones you skip keep getting a bigger bonus over time", "it grows over time", "the logic is that it grows", "see my blog"]) expect(ev("n12.f2").test(m), m).toBe(false);
  });
  it("finds ε's fixed rate, a fixed share or a number, and not \"sometimes\" or a bare ε", () => {
    for (const m of ["with probability 0.1 it picks a random option", "picks randomly 10% of the time", "Each day you give the best provider a 1-eps chance", "ε never changes", "it explores 10 percent of the rounds", "the rate stays the same"]) expect(ev("n07.f1").test(m), m).toBe(true);
    for (const m of ["sometimes it picks at random", "with a small probability epsilon it explores", "it explores now and then"]) expect(ev("n07.f1").test(m), m).toBe(false);
  });
  it("looks only at the sentence that holds the credited words", () => {
    const m = "Greedy always takes the best average. Epsilon greedy sometimes picks at random.";
    expect(sentencesOf(m, "sometimes picks at random")).toBe(" Epsilon greedy sometimes picks at random.");
    expect(ev("n07.f1").test(sentencesOf(m, "sometimes picks at random"))).toBe(false);
    expect(sentencesOf(m, "not in it")).toBe(m);
    // "e.g." doesn't end the sentence (the pilot: "you also choose an eps (e.g. 0.1), Each day you give…")
    const p = "Its almost greedy, but you also choose an eps (e.g. 0.1), Each day you give the best provider a 1-eps chance.";
    expect(ev("n07.f1").test(sentencesOf(p, "you also choose an eps"))).toBe(true);
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
