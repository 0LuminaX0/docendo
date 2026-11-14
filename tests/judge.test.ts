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

describe("the evidence a key needs (a check in code around the judge)", () => {
  const ev = (id: string) => new RegExp(bundle.nodes.flatMap((n) => n.facts).find((f) => f.id === id)!.evidence!, "iu");
  it("finds the bonus's slowing growth in the learner's own words, and not in a vague answer", () => {
    // "logarith-": speech input cut the word in a pilot run (2026-11-12)
    for (const m of ["it keeps growing but by less each time", "the growth gets smaller", "it grows more gently as time goes on", "grows slower and slower", "the ln t term keeps growing", "it grows logarithmically", "It grows logarith- in the number of rounds", "grows without limit but more and more slowly", "like sqrt(log t)"]) expect(ev("n12.f2").test(m), m).toBe(true);
    for (const m of ["the ones you skip keep getting a bigger bonus over time", "it grows over time", "the logic is that it grows", "see my blog"]) expect(ev("n12.f2").test(m), m).toBe(false);
  });
  // 2026-11-13, a pilot learner answering tersely on purpose: the judge credited each of these in full
  it("finds lock-in's mechanism (never picked again, never corrected), and not \"it can lock in\" alone", () => {
    for (const m of ["greedy might never go back to it, so it never finds out it's actually the best", "which could prevent the Greedy rule from choosing this option again", "if the best one has a bad first day greedy won't pick it so its average stays too low", "So A's average will never be corrected"]) expect(ev("n06.f1").test(m), m).toBe(true);
    for (const m of ["Greedy can lock in on the wrong arm with an unlucky start.", "It's can Lock in the wrong arm or it can lock in on the right arm and be very good."]) expect(ev("n06.f1").test(m), m).toBe(false);
  });
  it("finds UCB picking the highest score, and not \"a mean and a bonus\" alone", () => {
    for (const m of ["its average plus a bonus, and always picks the highest score", "it adds a bonus to the average and goes with whichever is bigger", "UCB picks the arm with the best score"]) expect(ev("n11.f1").test(m), m).toBe(true);
    for (const m of ["UCB uses a mean and a bonus, and the bonus is higher for less explored options and lower for better exploit options.", "there is the UCB rule, which applies bonuses"]) expect(ev("n11.f1").test(m), m).toBe(false);
  });
  it("finds the doubt about an average from few tries, and not \"for exploring\" alone", () => {
    for (const m of ["an average you can't trust yet: it could really be much better than it looks", "we're not sure about options we tried less, they might be better than they look", "the average of a rarely tried option might just be unlucky", "it gives them the benefit of the doubt"]) expect(ev("n11.f4").test(m), m).toBe(true);
    for (const m of ["It's for exploration, for the trade off. So it explores more than greedy does.", "I think for exploring bad options that are bad get a higher bonus, so we also explore.", "with it, it prioritizes arms that have been explored less.", "so options that were tried less get a chance to be picked"]) expect(ev("n11.f4").test(m), m).toBe(false);
  });
  // 2026-11-14: the live judge credited "the bonus is calculated based on how often we have chosen the option" as a
  // pick shrinking its own bonus in 2 of 3 runs
  it("finds which way a pick moves the bonus, and not \"it depends on how often it was picked\" alone", () => {
    for (const m of ["Every time you go to a truck, its bonus gets a bit smaller.", "the bonus for exploration becomes lower", "yeah the bonus grows with T rounds and shrinks if it is picked.", "the bonus is bigger for options picked fewer times", "score = Q + sqrt(ln t / n)", "Every time you pick it, the bonus goes down a bit", "the more you pick it, the smaller its bonus"]) expect(ev("n12.f1").test(m), m).toBe(true);
    for (const m of ["The bonus is calculated based on how often we have choosen the option already and how mannc rounds we have played so far.", "The bonus depends on how many times you picked the option.", "the bonus changes when you pick it"]) expect(ev("n12.f1").test(m), m).toBe(false);
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
  it("widens to the sentences around the credited words when asked", () => {
    const m = "One. Two has the quote. Three. Four.\n\nFive.";
    expect(sentencesOf(m, "has the quote", 2, 1)).toBe("One. Two has the quote. Three. Four.");
    expect(sentencesOf(m, "has the quote", 0, 1)).toBe("One. Two has the quote.");
    expect(sentencesOf(m, "has the quote", 3)).toBe(" Two has the quote. Three. Four.\n\nFive.");
    expect(sentencesOf(m, "has the quote", 9, 9)).toBe(m);
  });
});

// 2026-11-14, the live checks after the handoff: a full lock-in explanation came out partial, so p3's gate stayed shut
describe("lock-in explained with its reason or an example (checks around the judge)", () => {
  const reply = (facts: Reply["facts"], misconceptions: NonNullable<Reply["misconceptions"]> = []): Reply => ({ intent: "answer", facts, misconceptions });
  const v = (fact: string, verdict: "correct" | "partial" | "wrong", quote: string) => ({ fact, verdict, quote, keyQuote: verdict === "correct" ? quote : "", before: "", after: "" });
  const verdictOf = (j: ReturnType<typeof settleReply>, id: string) => j.facts.find((f) => f.fact === id)?.verdict;

  it("finds the key in the sentences after the credited one (the thorough pilot run)", () => {
    const m = "That depends. Greedy can lock in if the first tries are very unlucky. This happens, for example, when the arm, which is actually optimal, gets a really bad result that is even below the true average of an other arm and this other arm gets a higher result. Then greedy just keeps pulling this other arm and never corrects this misconception about the best arm.";
    expect(verdictOf(settleReply(bundle, m, "", reply([v("n06.f1", "correct", "Greedy can lock in if the first tries are very unlucky")])), "n06.f1")).toBe("correct");
    const s = "Greedy usually settles on whichever option looked best early on and keeps repeating it. Say the truly best option gets an unlucky first result, like a 1 when its usual reward is around 8, while another option gives a 5. Greedy then sees the good option's average as too low, never picks it again, and never finds out how good it really is.";
    expect(verdictOf(settleReply(bundle, s, "", reply([v("n06.f1", "correct", "Greedy usually settles on whichever option looked best early on and keeps repeating it")])), "n06.f1")).toBe("correct");
  });
  it("keeps a terse lock-in partial: nothing in the answer says it is never tried again", () => {
    for (const m of ["Greedy can lock in on the wrong arm with an unlucky start.", "It can get stuck if the best option had an unlucky first result.", "It's can Lock in the wrong arm or it can lock in on the right arm and be very good."]) {
      const j = settleReply(bundle, m, "", reply([v("n06.f1", "correct", m.replace(/\.$/, ""))]));
      expect(verdictOf(j, "n06.f1"), m).toBe("partial");
    }
  });
  it("credits lock-in through its example when the example says greedy never goes back", () => {
    const m = "If the best truck has one bad lunch at the start, greedy might never go back to it, so it never finds out it's actually the best.";
    const j = settleReply(bundle, m, "", reply([v("n06.f2", "correct", m)]));
    expect([verdictOf(j, "n06.f2"), verdictOf(j, "n06.f1")]).toEqual(["correct", "correct"]);
    expect(j.dropped!.some((d) => /n06\.f1 \(correct through its example n06\.f2\)/.test(d.fact))).toBe(true);
    // a partial lock-in is lifted too; a wrong one isn't
    expect(verdictOf(settleReply(bundle, m, "", reply([v("n06.f1", "partial", "If the best truck has one bad lunch at the start"), v("n06.f2", "correct", m)])), "n06.f1")).toBe("correct");
    expect(verdictOf(settleReply(bundle, m, "", reply([v("n06.f1", "wrong", "If the best truck has one bad lunch at the start"), v("n06.f2", "correct", m)])), "n06.f1")).toBe("wrong");
  });
  it("doesn't credit lock-in through an example that leaves out the never going back", () => {
    const m = "It might end up with the best option, it might also choose a worse one, if the actual good option had an unlucky bad first \"experience\"";
    const j = settleReply(bundle, m, "", reply([v("n06.f2", "correct", "if the actual good option had an unlucky bad first")]));
    expect(verdictOf(j, "n06.f1")).toBeUndefined();
  });

  const mis = (node: string, quote: string) => ({ node, fact: "none", quote, belief: "(the judge's summary)", before: "", after: "" });
  it("drops the lucky leader's correction when the judge records it as a wrong belief", () => {
    const m = "That depends. Greedy can lock in if the first tries are very unlucky: the best arm gets a bad result below another arm's true average, and greedy never corrects it. But if the best arm's first result wasn't that bad and another arm only got lucky, then over many rounds the average of the arm being pulled converges to its true mean. Greedy will eventually switch arms and then keep pulling the best arm.";
    for (const [node, quote] of [["n05", "Greedy will eventually switch arms and then keep pulling the best arm"], ["n05", "But if the best arm's first result wasn't that bad and another arm only got lucky, then over many rounds"], ["n06", "the average of the arm being pulled converges to its true mean"]] as const) {
      const j = settleReply(bundle, m, "", reply([], [mis(node, quote)]));
      expect(j.misconceptions, quote).toEqual([]);
      expect(j.dropped!.some((d) => /a true remark/.test(d.fact))).toBe(true);
    }
    const t = "But if that arm's true mean is below the value of the best arm, that was rewarded in the first round, then because over many rounds, the estimated mean of the arm that is being pulled will slowly change and converge to its true mean. Greedy will eventually switch arms and then keep pulling the best arm.";
    expect(settleReply(bundle, t, "", reply([], [mis("n05", "if that arm's true mean is below the value of the best arm, that was rewarded in the first round, then because over many rounds, the estimated mean of the arm that is being pulled will slowly change and converge to its true mean")])).misconceptions).toEqual([]);
    expect(settleReply(bundle, "If the leader only got lucky, greedy keeps picking it, its average falls back towards its true value and greedy switches.", "", reply([], [mis("n06", "greedy switches")])).misconceptions).toEqual([]);
  });
  it("makes greedy's rule partial when the same message says greedy sticks with one for good", () => {
    const misled = "Nope, not for greedy. Once each option has been tried once, the one with the best average is the one to keep picking, because the averages fix themselves over time, so trying the others again wouldn't gain anything. That's why greedy can just stick with its favourite and still end up finding the best option.";
    const j = settleReply(bundle, misled, "", reply([v("n05.f1", "correct", "the one with the best average is the one to keep picking")]));
    expect(verdictOf(j, "n05.f1")).toBe("partial");
    expect(j.dropped!.some((d) => /the message also says "stick with its favourite"/.test(d.quote))).toBe(true);
    for (const m of ["it keeps picking whichever has the best average, and it sticks with that one forever and never switches", "Greedy just picks whatever looked best after the first day and then stays there for the rest of the year."])
      expect(verdictOf(settleReply(bundle, m, "", reply([v("n05.f1", "correct", m.slice(0, 40))])), "n05.f1"), m).toBe("partial");
    // the rule said right stays correct, also with "sticks with … until", "doesn't stick with", "never switches back to B"
    // (a problem's own case) or "never switches to a worse one", or a lock-in
    for (const m of ["Greedy always picks the truck with the best average so far, and if another truck's average gets higher it switches to that one.", "greedy sticks with its favourite until another option's average overtakes it", "It basically just sticks with whatever seems best right now.", "Greedy never switches to a worse option on purpose.", "Greedy keeps picking B, never tries A again, so A's average never gets corrected", "Almost, but greedy doesn't stick with its first pick. After day 4, B's average is 7, below A's 7.5, so greedy switches to A.", "Greedy doesn't just stick with the first winner: it follows the best average so far.", "A's average stays above 7, so greedy never switches back to B."])
      expect(verdictOf(settleReply(bundle, m, "", reply([v("n05.f1", "correct", m.slice(0, 40))])), "n05.f1"), m).toBe("correct");
  });
  it("drops a vague growing bonus when the same message says a skipped option's bonus stays the same", () => {
    // the misled learner's correction (2026-11-14): partial n12.f2 opened p2's gate through its vague reading
    const m = "Hmm, I'm pretty sure C is right. Dialogues scored 5.0, so its average stays at 5.0, but picking it shrinks its bonus, so its score drops. Flashcards and Listening don't get picked, so their bonuses and scores don't change.";
    const j = settleReply(bundle, m, "", reply([v("n12.f1", "correct", "picking it shrinks its bonus"), v("n12.f2", "partial", "Flashcards and Listening don't get picked")]));
    expect([verdictOf(j, "n12.f1"), verdictOf(j, "n12.f2")]).toEqual(["correct", undefined]);
    for (const ok of ["the bonus of an option you don't pick keeps growing, just more slowly", "Flashcards and Listening weren't picked, so their bonuses don't shrink; they grow a little.", "picking other options doesn't change its bonus, and it keeps growing over time"])
      expect(verdictOf(settleReply(bundle, ok, "", reply([v("n12.f2", "partial", ok.slice(0, 30))])), "n12.f2"), ok).toBe("partial");
  });
  it("keeps the real belief that greedy's averages fix themselves and it always ends up on the best", () => {
    for (const m of [
      "Greedy is fine in the long run, the averages fix themselves and it ends up at the best truck.",
      "Greedy's averages keep correcting themselves as it runs, so café 1 will drift over to cake A eventually.",
      "Greedy is the one that feels risky but really isn't, since any early bad averages get corrected as it keeps picking, so it will always land on the best option eventually.",
      "Once it settles on one, it sticks with that one forever and never switches. The averages end up fixing any early mistakes.",
    ]) {
      const j = settleReply(bundle, m, "", reply([], [mis("n06", m.split(". ").pop()!.replace(/\.$/, ""))]));
      expect(j.misconceptions, m).toHaveLength(1);
    }
  });
});

describe("the key's words (a check in code around the judge, 2026-11-12)", () => {
  const reply = (facts: Reply["facts"]): Reply => ({ intent: "answer", facts, misconceptions: [] });
  const oskar = "Ideally it ends up choosing the best option all the time. To solve this, there is the UCB rule, which applies bonuses";
  it("keeps a credit whose key words are the learner's own", () => {
    const m = "UCB gives every option a score, its average plus a bonus, and picks the highest score.";
    const j = settleReply(bundle, m, "", reply([{ fact: "n11.f1", verdict: "correct", quote: "UCB gives every option a score, its average plus a bonus", keyQuote: "picks the highest score", before: "", after: "" }]));
    expect(j.facts[0]).toMatchObject({ fact: "n11.f1", verdict: "correct", keyQuote: "picks the highest score" });
  });
  it("makes a credit partial when the judge names no key words, or words that aren't in the message", () => {
    const none = settleReply(bundle, oskar, "", reply([{ fact: "n11.f1", verdict: "correct", quote: "there is the UCB rule, which applies bonuses", keyQuote: "", before: "", after: "" }]));
    expect(none.facts[0]!.verdict).toBe("partial");
    expect(none.dropped!.some((d) => /no words stating the key/.test(d.quote))).toBe(true);
    const made = settleReply(bundle, oskar, "", reply([{ fact: "n11.f1", verdict: "correct", quote: "there is the UCB rule, which applies bonuses", keyQuote: "and picks the option with the highest score", before: "", after: "" }]));
    expect(made.facts[0]!.verdict).toBe("partial");
  });
  it("lets the credited words stand in when the judge copied the key itself, only if they carry the key (2026-11-14)", () => {
    const m = "Ideally it ends up choosing the best option all the time.\nHowever when it can happen that the option which is the best in reality has a bad round by chance.\nThis loweres the calculated average, which could prevent the Greedy rule from choosing this option again.\nTo solve this, there is the UCB rule, which applies bonuses";
    const copied = "the best option can look worse after an unlucky start, greedy then never picks it again";
    const j = settleReply(bundle, m, "", reply([{ fact: "n06.f1", verdict: "correct", quote: "This loweres the calculated average, which could prevent the Greedy rule from choosing this option again", keyQuote: copied, before: "", after: "" }]));
    expect(j.facts[0]!.verdict).toBe("correct");
    // words that don't carry it stay partial, and so does a copied key for UCB's rule on "which applies bonuses"
    const vague = settleReply(bundle, m, "", reply([{ fact: "n06.f1", verdict: "correct", quote: "the option which is the best in reality has a bad round by chance", keyQuote: copied, before: "", after: "" }]));
    expect(vague.facts[0]!.verdict).toBe("partial");
    const ucb = settleReply(bundle, oskar, "", reply([{ fact: "n11.f1", verdict: "correct", quote: "there is the UCB rule, which applies bonuses", keyQuote: "each option gets a score (its average plus a bonus) and UCB picks the option with the highest score", before: "", after: "" }]));
    expect(ucb.facts[0]!.verdict).toBe("partial");
  });
  it("leaves a fact without a key, and verdicts other than correct, as the judge gave them", () => {
    const m = "Exploring is trying options to learn about them, exploiting is going to the one that looks best.";
    const j = settleReply(bundle, m, "", reply([{ fact: "n08.f1", verdict: "correct", quote: "Exploring is trying options to learn about them", keyQuote: "", before: "", after: "" }]));
    expect(j.facts[0]!.verdict).toBe("correct");
    const p = settleReply(bundle, oskar, "", reply([{ fact: "n11.f1", verdict: "partial", quote: "there is the UCB rule, which applies bonuses", keyQuote: "", before: "", after: "" }]));
    expect([p.facts[0]!.verdict, p.dropped!.length]).toEqual(["partial", 0]);
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
