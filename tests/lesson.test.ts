import { describe, expect, it } from "vitest";
import lessonJson from "../topics/bandits/lesson.json";
import { LessonFile, checkPack } from "../content/pack";
import { COPIED_RUN, FIGURES, FORMULAS, lessonWords, makeOverlap, wordsOf } from "../lib/lesson";
import { packFor } from "../lib/server/content";
import { publicOf } from "../lib/settings";
import { defaults } from "../lib/server/settings";
import { minutesOf, stepName } from "../lib/flow";

const lesson = LessonFile.parse(lessonJson);
const blocks = lesson.sections.flatMap((s) => s.blocks);
const text = lessonWords(lesson);

describe("the text lesson", () => {
  it("is the team's text: five sections, three formulas and five figures, about 750 words", () => {
    expect(lesson.sections.map((s) => s.id)).toEqual(["problem", "greedy", "epsilon", "ucb", "together"]);
    expect(blocks.filter((b) => "formula" in b).map((b) => ("formula" in b ? b.formula : ""))).toEqual([...FORMULAS]);
    expect(blocks.filter((b) => "figure" in b).map((b) => ("figure" in b ? b.figure : ""))).toEqual([...FIGURES]);
    const n = wordsOf(text).length;
    expect(n).toBeGreaterThan(650);
    expect(n).toBeLessThan(900);
  });

  it("passes the pack check: real figures, formulas and ideas, each lesson idea in a section", () => {
    const issues = checkPack("bandits").filter((i) => i.where === "lesson.json");
    expect(issues).toEqual([]);
  });

  it("states no consequence the practice or test items ask learners to work out", () => {
    // regret is not taught; that an ignored option comes back, or that greedy corrects a too-high start, is for the items
    for (const phrase of [/regret/i, /comes? back/i, /picked again/i, /corrects? itself/i, /too.high/i, /logarithmic/i]) expect(text, String(phrase)).not.toMatch(phrase);
  });

  it("counts a message as copied only at a long run of the text's words", () => {
    const overlap = makeOverlap(text);
    // natural explanations share short runs with the text
    for (const m of [
      "greedy always picks the option with the highest average so far",
      "UCB gives each option a score and picks the one with the highest score",
      "with probability epsilon it picks one of all the options at random, the favourite included",
      "the bonus grows as rounds pass but more and more slowly",
    ])
      expect(overlap(m).longest, m).toBeLessThan(COPIED_RUN);
    // a sentence read out from the text is a long run
    const copied = "It stays the same in every round, however long the app has run and however certain its averages are.";
    expect(overlap(copied).longest).toBeGreaterThanOrEqual(COPIED_RUN);
    expect(overlap(copied).inRuns).toBe(overlap(copied).words);
    // case, punctuation and ε don't hide a copy
    expect(overlap(copied.toUpperCase().replace(/,/g, "")).longest).toBe(overlap(copied).longest);
    expect(overlap("ε-greedy (say \"epsilon-greedy\") adds deliberate randomness").longest).toBeGreaterThanOrEqual(6);
  });
});

describe("the lesson step with a text lesson", () => {
  const pack = packFor("bandits");

  it("is called Read and takes the text's reading time", () => {
    const d = defaults();
    expect(publicOf(d, pack).lessonKind).toBe("text");
    expect(stepName("watch", "text")).toBe("Read");
    expect(stepName("watch", "video")).toBe("Watch");
    expect(minutesOf("watch", d, { pretest: 0, test: 0, lesson: pack.lesson!.minutes })).toBe(lesson.minutes);
  });

  it("finds the passage about the idea Kai is asking about, and its text only once help is open", () => {
    expect(pack.passageFor("n07", false)).toEqual({ section: "epsilon", title: "3. ε-greedy: the favourite, plus a lottery" });
    expect(pack.passageFor("n12", true)?.section).toBe("ucb");
    expect(pack.passageFor("n12", true)?.blocks?.length).toBeGreaterThan(3);
    expect(pack.passageFor(null, true)).toBeNull();
    // a practice problem's facts: the sections about their ideas, in lesson order
    expect(pack.passagesFor(["n07.f1", "n12.f1", "n11.f1"]).map((p) => p.section)).toEqual(["epsilon", "ucb"]);
  });
});
