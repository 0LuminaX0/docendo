import { describe, expect, it } from "vitest";
import bundleJson from "../topics/bandits/bundle.json";
import practiceJson from "../topics/bandits/practice.json";
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
    expect(checkPractice(item("p4"), "0.85")).toBe(true);
    expect(checkPractice(item("p4"), "85%")).toBe(true);
    expect(checkPractice(item("p4"), "85")).toBe(true); // a percentage without the sign
    expect(checkPractice(item("p4"), "0.8")).toBe(false);
    expect(checkPractice(item("p5"), "5%")).toBe(true);
    expect(checkPractice(item("p5"), "0.25")).toBe(false);
    expect(checkPractice(item("p1"), String(item("p1").answer))).toBe(true);
    expect(checkPractice(item("p1"), String((item("p1").answer + 1) % 4))).toBe(false);
  });

  it("have worked answers that match the arithmetic in their steps", () => {
    expect(item("p4").answer).toBeCloseTo(0.8 + 0.2 / 4);
    expect(item("p5").answer).toBeCloseTo(0.2 / 4);
  });

  it("only use ideas the lesson teaches, and don't put every answer in the same place", () => {
    // the bundle holds only the lesson's nodes, so every cited fact must be in it (checked above);
    // here: choice answers are spread over the options
    const positions = practice.items.filter((p) => p.kind === "choice").map((p) => p.answer);
    expect(new Set(positions).size).toBeGreaterThan(2);
  });
});
