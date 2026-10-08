import { describe, expect, it } from "vitest";
import bundleJson from "../topics/bandits/bundle.json";
import practiceJson from "../topics/bandits/practice.json";
import exercisesJson from "../topics/bandits/exercises.json";
import { Bundle } from "../content/schema";
import { PracticeFile, checkPractice, parseNumber } from "../content/practice";

const bundle = Bundle.parse(bundleJson);
const practice = PracticeFile.parse(practiceJson);
const factIds = new Set(bundle.nodes.flatMap((n) => n.facts.map((f) => f.id)));
const item = (id: string) => practice.items.find((p) => p.id === id)!;

describe("practice problems", () => {
  it("have unique ids, and every solution step cites real lesson facts", () => {
    const ids = practice.items.map((p) => p.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const p of practice.items) for (const s of p.steps) for (const f of s.facts) expect(factIds.has(f), `${p.id} cites ${f}`).toBe(true);
  });

  it("read typed numbers the way people write them", () => {
    expect(parseNumber("0.85")).toBe(0.85);
    expect(parseNumber("85%")).toBe(0.85);
    expect(parseNumber("0,85")).toBe(0.85);
    expect(parseNumber("1,234")).toBe(1234);
    expect(parseNumber("≈ 210")).toBe(210);
    expect(parseNumber("about 210")).toBeNull();
  });

  it("accept right answers in any reasonable form and reject wrong ones", () => {
    expect(checkPractice(item("p5"), "867")).toBe(true);
    expect(checkPractice(item("p5"), "≈ 870")).toBe(true);
    expect(checkPractice(item("p5"), "866.7")).toBe(true);
    expect(checkPractice(item("p5"), "800")).toBe(false); // explore picks never land on the favourite
    expect(checkPractice(item("p5"), "917")).toBe(false); // explore picks lean towards good averages
    expect(checkPractice(item("p1"), String(item("p1").answer))).toBe(true);
    expect(checkPractice(item("p1"), String((item("p1").answer + 1) % 4))).toBe(false);
  });

  // verify-items: every numeric key is recomputed here, so a typo in the content fails the build
  it("have keys that match their own numbers", () => {
    expect(item("p5").answer).toBeCloseTo(1000 * (0.8 + 0.2 / 3), 1);
    // p3: UCB picks the highest average + bonus (A 6.1 + 0.5, B 4.8 + 1.9, C 5.5 + 0.8)
    expect(argmax([6.1 + 0.5, 4.8 + 1.9, 5.5 + 0.8])).toBe(1);
    expect(item("p3").answer).toBe(1);
    // p6: B's new score 4.0 + 0.6 against A 5.4, C 3.8, D 5.1: A wins
    expect(argmax([5.4, 4.0 + 0.6, 3.8, 5.1])).toBe(0);
    expect(item("p6").options![item("p6").answer]).toMatch(/plays A/);
    // p1 and p4: greedy's averages after the first tries pick B
    expect(argmax([2, 5, 1])).toBe(1);
    expect(argmax([0, 1, 0])).toBe(1);
    expect(item("p1").options![item("p1").answer]).toMatch(/^At B/);
    expect(item("p4").options![item("p4").answer]).toMatch(/^B:/);
  });

  it("come in two rounds that practise the same ideas in the same order", () => {
    const r1 = practice.items.filter((p) => p.round === 1).map((p) => p.idea);
    const r2 = practice.items.filter((p) => p.round === 2).map((p) => p.idea);
    expect(r1).toEqual(["greedy", "epsilon", "ucb"]);
    expect(r2).toEqual(r1);
  });

  it("only use ideas the lesson teaches, and don't put every answer in the same place", () => {
    // the bundle holds only the lesson's nodes, so every cited fact must be in it (checked above);
    // here: choice answers are spread over the options
    const positions = practice.items.filter((p) => p.kind === "choice").map((p) => p.answer);
    expect(new Set(positions).size).toBeGreaterThan(2);
  });
});

describe("final test items", () => {
  const test = exercisesJson.items;
  const q = (id: string) => test.find((x) => x.id === id)!;
  const key = (id: string) => q(id).options[q(id).answer]!;

  it("have keys that match their own numbers", () => {
    // q03: greedy picks the best average (A 7 and 5, B 8, C 6, 6 and 7)
    expect(argmax([(7 + 5) / 2, 8, (6 + 6 + 7) / 3])).toBe(1);
    expect(key("q03")).toMatch(/^B/);
    // q05: ε = 0.1, five banners: 0.9 + 0.1 / 5
    expect(Number(key("q05").replace("%", "")) / 100).toBeCloseTo(0.9 + 0.1 / 5);
    // q09: A 6.0 + 0.3, B 5.2 + 1.2, C 5.8 + 0.4
    expect(argmax([6.3, 6.4, 6.2])).toBe(1);
    expect(key("q09")).toMatch(/^B/);
  });

  it("use settings of their own, never the lesson's or practice's", () => {
    for (const x of test) expect(x.prompt, x.id).not.toMatch(/restaurant|food truck|slot machine|headline/i);
  });

  it("spread their keys over the positions", () => {
    const counts = [0, 0, 0, 0];
    for (const x of test) counts[x.answer]!++;
    expect(Math.max(...counts)).toBeLessThanOrEqual(4);
  });
});

const argmax = (xs: number[]) => xs.indexOf(Math.max(...xs));

import pretestJson from "../topics/bandits/pretest.json";

describe("pretest", () => {
  const items = pretestJson.items as { id: string; kind: string; options: string[]; answer?: number; exclude?: number; prompt: string }[];

  it("has background questions and knowledge items with a valid key and an “I don't know” option last", () => {
    for (const q of items.filter((x) => x.kind === "knowledge")) {
      expect(q.answer, q.id).toBeGreaterThanOrEqual(0);
      expect(q.answer!, q.id).toBeLessThan(q.options.length - 1);
      expect(q.options.at(-1), q.id).toBe("I don't know");
    }
    for (const q of items.filter((x) => x.kind === "background")) expect(q.answer, q.id).toBeUndefined();
    expect(items.filter((x) => x.exclude !== undefined)).toHaveLength(1);
  });

  it("doesn't reuse the practice or test items' settings, so it doesn't prime them", () => {
    for (const q of items) expect(q.prompt, q.id).not.toMatch(/food truck|headline|slot machine|banner|coffee|podcast|study app|greedy|UCB|ε/i);
  });
});

import { initialState } from "../engine/tutor/state";
import { isRight, notesOf, offlineSolve } from "../engine/tutor/solve";

describe("Kai solving practice problems (recursive feedback)", () => {
  const base = initialState(bundle);
  const p1 = item("p1");
  const taught = {
    ...base,
    notebook: (["n03.f1", "n05.f1", "n05.f2", "n06.f1"] as const).map((fact, i) => ({ fact, verdict: "correct" as const, words: `note about ${fact}`, turn: i + 1 })),
  };

  it("gets a problem right when the notebook holds every fact it needs, citing the notes", () => {
    const s = offlineSolve(bundle, p1, taught);
    expect(s.correct).toBe(true);
    expect(s.steps.every((st) => st.notes.length > 0)).toBe(true);
  });

  it("goes wrong where a fact is missing, and says it guessed", () => {
    const s = offlineSolve(bundle, p1, base);
    expect(s.correct).toBe(false);
    expect(s.steps[0]!.text).toMatch(/didn't tell me/);
    expect(s.steps[0]!.notes).toEqual([]);
  });

  it("follows a stated misconception and points to the learner's words", () => {
    const st = { ...taught, misconceptions: [{ node: "n05", words: "greedy checks the other trucks now and then", turn: 5 }], notebook: taught.notebook.map((e) => (e.fact === "n05.f2" ? { ...e, verdict: "wrong" as const } : e)) };
    const s = offlineSolve(bundle, p1, st);
    expect(s.correct).toBe(false);
    const bad = s.steps.find((x) => x.text.includes("now and then"))!;
    expect(s.notes[bad.notes[0]! - 1]).toBe("greedy checks the other trucks now and then");
  });

  it("numbers the notes without lesson text, and reads Kai's answer as a letter or a number", () => {
    expect(notesOf(taught)).toEqual(taught.notebook.map((e) => e.words));
    expect(isRight(p1, "D")).toBe(true);
    expect(isRight(p1, "d) At B")).toBe(true);
    expect(isRight(p1, "A")).toBe(false);
    expect(isRight(item("p5"), "about 867 visitors")).toBe(true);
    expect(isRight(item("p5"), "800")).toBe(false);
    expect(isRight(item("p5"), "I'm not sure")).toBe(false);
  });
});

describe("misconceptions Kai still believes", () => {
  it("are replaced by a later correct explanation of the same idea", async () => {
    const { activeMisconceptions } = await import("../engine/tutor/state");
    const base = initialState(bundle);
    const told = { ...base, misconceptions: [{ node: "n07", words: "it explores the least visited one", turn: 1 }] };
    expect(activeMisconceptions(told)).toHaveLength(1);
    const corrected = { ...told, notebook: [{ fact: "n07.f2", verdict: "correct" as const, words: "it picks any of them at random", turn: 2 }] };
    expect(activeMisconceptions(corrected)).toHaveLength(0);
    expect(notesOf(corrected)).toEqual(["it picks any of them at random"]);
    // a correct statement made before the misconception doesn't cancel it
    const earlier = { ...told, notebook: [{ fact: "n07.f2", verdict: "correct" as const, words: "x", turn: 0 }] };
    expect(activeMisconceptions(earlier)).toHaveLength(1);
  });
});

import { gate, solve, type Solution } from "../engine/tutor/solve";

describe("the gate: Kai can't be right without the facts", () => {
  const base = initialState(bundle);
  const p3 = item("p3");
  const ucb = { ...base, notebook: [{ fact: "n11.f2", verdict: "correct" as const, words: "UCB adds a bonus to each average and picks the highest total", turn: 1 }] };

  it("opens only with every needed fact explained correctly and no misconception left about them", () => {
    expect(gate(p3, base)).toMatchObject({ needs: ["n11.f2"], missing: ["n11.f2"], canBeRight: false });
    expect(gate(p3, ucb).canBeRight).toBe(true);
    expect(gate(p3, { ...ucb, notebook: [{ ...ucb.notebook[0]!, verdict: "partial" as const }] }).canBeRight).toBe(false); // vague isn't enough
    expect(gate(p3, { ...ucb, misconceptions: [{ node: "n11", words: "UCB picks at random", turn: 2 }] }).canBeRight).toBe(false);
    for (const p of practice.items) for (const f of p.needs ?? []) expect(p.steps.some((s) => s.facts.includes(f)), `${p.id} needs ${f}`).toBe(true);
  });

  it("replaces a model's right answer without the facts by a wrong guess", async () => {
    const lucky = async (): Promise<Solution> => ({ steps: [{ text: "I add the bonus.", notes: [] }], answer: "B", correct: true, notes: [], leaked: [], by: "model", gate: gate(p3, base) });
    let why = "";
    const s = await solve(bundle, p3, base, { demo: false, model: lucky, onError: (e) => (why = String(e)) });
    expect(s.correct).toBe(false);
    expect(s.by).toBe("offline");
    expect(why).toMatch(/without the facts/);
    // with the facts, the model's right answer stands
    const earned = async (): Promise<Solution> => ({ ...(await lucky()), gate: gate(p3, ucb) });
    expect((await solve(bundle, p3, ucb, { demo: false, model: earned })).correct).toBe(true);
  });

  it("guesses at random among the wrong answers, numbers included", () => {
    for (const p of practice.items) {
      const guesses = new Set<string>();
      for (let t = 0; t < 30; t++) {
        const s = offlineSolve(bundle, p, { ...base, notebook: [{ fact: "n01.f1", verdict: "correct" as const, words: `note ${t}`, turn: 1 }] });
        expect(s.correct, p.id).toBe(false);
        guesses.add(s.answer);
      }
      expect(guesses.size, `${p.id} guesses vary`).toBeGreaterThan(1);
    }
  });
});
