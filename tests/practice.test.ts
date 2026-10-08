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
