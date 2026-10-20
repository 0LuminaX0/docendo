import { describe, expect, it } from "vitest";
import bundleJson from "../topics/bandits/bundle.json";
import { Bundle } from "../content/schema";
import { annotate, assemble, isFragment, refuse, sentenceAround, type Refusal } from "../engine/tutor/notes";
import { checkQuotes, type Judgement } from "../engine/tutor/judge";
import { applyJudgement } from "../engine/tutor/turn";
import { initialState, noteParts, notesOf, quotesOf } from "../engine/tutor/state";

// What Kai writes down for a quote (engine/tutor/notes.ts): a statement that stands alone, the learner's words first.

const bundle = Bundle.parse(bundleJson);

describe("when a quote needs more to stand alone", () => {
  it("is short, points back, or continues a sentence of the learner's", () => {
    const msg = "UCB adds a bonus to each truck's average, bigger for trucks you've tried less, and picks the truck with the highest average plus bonus.";
    expect(isFragment("between arms", "between arms")).toBe(true);
    expect(isFragment("it always finds the best restaurant in the end", "it always finds the best restaurant in the end")).toBe(true);
    expect(isFragment("picks the truck with the highest average plus bonus", msg)).toBe(true);
    expect(isFragment("UCB adds a bonus to each truck's average", msg)).toBe(false);
    // a preposition at the start of a sentence is fine
    expect(isFragment("For each restaurant you keep the average of your meals", "For each restaurant you keep the average of your meals.")).toBe(false);
  });
  it("finds the learner's whole sentence around a fragment", () => {
    const two = "Epsilon-greedy fixes that. Most nights it takes the best average, but with a small probability it picks at random. Then it goes on.";
    expect(sentenceAround(two, "with a small probability it picks at random")).toBe("Most nights it takes the best average, but with a small probability it picks at random.");
    expect(sentenceAround("between arms", "between arms")).toBeNull();
  });
});

describe("Kai's note for a quote, in order", () => {
  const ann = (quote: string, message: string, extra: { before?: string; after?: string } = {}, kai = "", others: { quote: string }[] = []) => {
    const refused: Refusal[] = [];
    return { ...annotate(bundle, { quote, ...extra }, message, kai, others, (r) => refused.push(r)), refused };
  };
  it("1. keeps a quote that stands alone as it is, whatever the judge put around it", () => {
    const msg = "Greedy always goes to the restaurant with the best average so far.";
    expect(ann("Greedy always goes to the restaurant with the best average so far", msg, { before: "When choosing," })).toMatchObject({ quote: "Greedy always goes to the restaurant with the best average so far", note: null });
  });
  it("2. turns a fragment into the learner's whole sentence, in place of the judge's words", () => {
    const msg = "Each visit is a bit random, so you only find out how good a place is by eating there.";
    expect(ann("you only find out how good a place is by eating there", msg, { before: "To learn," })).toMatchObject({ quote: msg, note: null });
  });
  it("…but not across a part recorded the other way", () => {
    const mixed = "UCB adds a bonus to each average, and the bonus grows every time you pick it.";
    expect(ann("adds a bonus to each average", mixed, {}, "", [{ quote: "the bonus grows every time you pick it" }]).quote).toBe("adds a bonus to each average");
  });
  it("3. drops a leading 'so' when the rest stands alone", () => {
    const long = `${"Imagine a long story about restaurants. ".repeat(8)}so you only find out how good a place is by eating there`;
    expect(ann("so you only find out how good a place is by eating there", long).quote).toBe("You only find out how good a place is by eating there.");
  });
  it("4. puts the judge's few words around a short answer, from Kai's question", () => {
    const kai = "So what exactly am I choosing between each time?";
    expect(ann("between arms", "between arms", { before: "You are choosing" }, kai)).toMatchObject({ quote: "between arms", note: "You are choosing between arms." });
    expect(ann("nope, never", "nope, never", { before: "Going back to a truck that looked bad at first, for greedy:" }, "Does greedy ever go back to a truck that looked bad at first?").note).toBe(
      "Going back to a truck that looked bad at first, for greedy: nope, never.",
    );
  });
  it("…and refuses words that add what nobody said, falling back to the quote", () => {
    const kai = "And when greedy picks a truck, what does it remember about it?";
    const msg = "you store its average";
    const ucb = ann(msg, msg, { before: "With UCB," }, kai);
    expect(ucb).toMatchObject({ quote: msg, note: null });
    expect(ucb.refused[0]!.why).toMatch(/lesson term/);
    expect(ann(msg, msg, { before: "After 10 days," }, kai).note).toBeNull(); // a number of its own
    expect(ann(msg, msg, { before: "When greedy picks a truck,", after: "and the count" }, kai).note).toBeNull(); // something after the quote
    expect(ann(msg, msg, { before: "Unlike sampling methods with replacement," }, kai).note).toBeNull(); // too many new words
    expect(ann(msg, msg, { before: "When greedy picks a truck," }, kai).note).toBe("When greedy picks a truck, you store its average.");
  });
  it("…and counts words the learner wrote right there as theirs, not Kai's", () => {
    const msg = "nope, never goes back";
    expect(ann("never goes back", msg, { before: "nope," })).toMatchObject({ note: null });
  });
});

describe("assembling the judge's words around the quote", () => {
  it("keeps the quote verbatim and joins cleanly", () => {
    expect(assemble("it always finds the best one", "Greedy", "")?.note).toBe("Greedy: it always finds the best one.");
    expect(assemble("and never tries the others again", "Greedy", "")).toEqual({ quote: "never tries the others again", note: "Greedy never tries the others again." });
    expect(assemble("you store its average", "", "")).toBeNull();
  });
  it("refuses words that repeat the quote", () => {
    expect(assemble("adds a bonus to each average", "UCB adds a bonus", "")).toBeNull();
    expect(assemble("when it explores it goes to the least visited", "When epsilon greedy explores,", "")).toBeNull();
  });
  it("checks a whole note against the learner's message and Kai's question", () => {
    expect(refuse(bundle, "In a multi-armed bandit you choose between arms.", "between arms", "between arms", "What do you choose between in a multi-armed bandit?")).toBeNull();
    expect(refuse(bundle, "Greedy stores each average.", "you store its average", "you store its average", "")).toMatch(/verbatim/);
  });
});

describe("notes in Kai's notebook", () => {
  it("shows the note, keeps the learner's words for the normal ink, and reads them back for the practice notebook", () => {
    const msg = "you store its average";
    const facts = checkQuotes(bundle, msg, [{ fact: "n03.f1", verdict: "correct", quote: msg, before: "When greedy picks a truck,", after: "" }] as never);
    // checkQuotes has no Kai question to check against, so the term "greedy" can't be used: the quote alone
    expect(facts[0]!.note).toBeNull();
    const j: Judgement = { intent: "answer", facts: [{ fact: "n03.f1", verdict: "correct", quote: msg, note: "When greedy picks a truck, you store its average." }], termsUsed: [] };
    const s = applyJudgement(initialState(bundle), j);
    expect(notesOf(s)).toEqual(["When greedy picks a truck, you store its average."]);
    expect(noteParts(s)[0]!.quote).toBe(msg);
    expect(quotesOf(s)["When greedy picks a truck, you store its average."]).toBe(msg);
  });
});

describe("the offline judge's quotes", () => {
  it("end at a sentence when the message is long", async () => {
    const { clip } = await import("../engine/tutor/judge");
    const msg = `${"Greedy goes to the best average so far and never looks back at the others. ".repeat(3)}And then it keeps going.`;
    expect(clip(msg).endsWith("others.")).toBe(true);
    expect(clip("short one")).toBe("short one");
  });
});
