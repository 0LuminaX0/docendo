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
  it("is the team's text: three sections (ε-greedy and the side-by-side chapter out, 2026-11-05), two formulas and five figures, about 1,000 words with the intro", () => {
    expect(lesson.sections.map((s) => s.id)).toEqual(["problem", "greedy", "ucb"]);
    const formulas = blocks.filter((b) => "formula" in b).map((b) => ("formula" in b ? b.formula : ""));
    const figures = blocks.filter((b) => "figure" in b).map((b) => ("figure" in b ? b.figure : ""));
    expect(formulas).toEqual(["greedy", "ucb"]);
    expect(figures).toEqual(["averages", "greedy", "lockin", "score", "bonus"]);
    for (const f of formulas) expect(FORMULAS).toContain(f); // the others (epsilon; lottery, compare) stay in code, unused
    for (const f of figures) expect(FIGURES).toContain(f);
    expect(text).not.toMatch(/ε|epsilon|lottery/i);
    const n = wordsOf(text).length;
    expect(n).toBeGreaterThan(900); // with the intro, the captions and the end
    expect(n).toBeLessThan(1100);
    // the intro and the end say the text closes for good
    expect(lesson.intro).toMatch(/won't see it again/);
    expect(lesson.end).toMatch(/won't be able to open it again/);
  });

  it("passes the pack check: real figures, formulas and ideas, each lesson idea in a section", () => {
    // ε-greedy (n07) is out of the text but still in the graph's lesson scope until it leaves the study: that warning only
    const issues = checkPack("bandits").filter((i) => i.where === "lesson.json");
    expect(issues.map((i) => [i.level, i.msg])).toEqual([["warn", "no section explains n07 (ε-greedy): no help passage for it"]]);
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
      "an option tried only a few times gets a big bonus, the benefit of the doubt",
      "the bonus grows as rounds pass but more and more slowly",
    ])
      expect(overlap(m).longest, m).toBeLessThan(COPIED_RUN);
    // a sentence read out from the text is a long run
    const copied = "The bonus does not look at the rewards an option actually gave: it depends only on c, on how often the option was picked and on the round.";
    expect(overlap(copied).longest).toBeGreaterThanOrEqual(COPIED_RUN);
    expect(overlap(copied).inRuns).toBe(overlap(copied).words);
    // case and punctuation don't hide a copy
    expect(overlap(copied.toUpperCase().replace(/[,:]/g, "")).longest).toBe(overlap(copied).longest);
    expect(overlap("UCB (\"upper confidence bound\") explores in a targeted way").longest).toBeGreaterThanOrEqual(6);
  });
});

describe("the lesson step with a text lesson", () => {
  const pack = packFor("bandits");

  it("is called Read, with its own time limit", () => {
    const d = defaults();
    expect(publicOf(d, pack).lessonKind).toBe("text");
    expect(stepName("watch", "text")).toBe("Read");
    expect(stepName("watch", "video")).toBe("Watch");
    expect(minutesOf("watch", d, { forms: 1 })).toBe(d.watch.minutes);
    // long enough to read the text and the minimum before going on
    expect(d.watch.minutes * 60).toBeGreaterThan(Math.max(lesson.minutes * 60, lesson.minSeconds));
  });

  it("finds the passage about the idea Kai is asking about, and its text only once help is open", () => {
    expect(pack.passageFor("n05", false)).toEqual({ section: "greedy", title: "2. Greedy: always the favourite" });
    expect(pack.passageFor("n12", true)?.section).toBe("ucb");
    expect(pack.passageFor("n12", true)?.blocks?.length).toBeGreaterThan(3);
    expect(pack.passageFor(null, true)).toBeNull();
    // a practice problem's facts: the sections about their ideas, in lesson order
    expect(pack.passagesFor(["n05.f1", "n12.f1", "n11.f1"]).map((p) => p.section)).toEqual(["greedy", "ucb"]);
  });
});
