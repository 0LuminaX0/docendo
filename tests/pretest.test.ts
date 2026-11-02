import { describe, expect, it } from "vitest";
import { readFileSync, mkdtempSync, mkdirSync, writeFileSync, cpSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import pretestJson from "../topics/bandits/pretest.json";
import { PretestFile, checkPack } from "../content/pack";
import { gradePretest, pretestItems, pretestSets, setsFor } from "../content/pretest";
import { tables } from "../lib/analytics";

// The team's pretest, option C (main doc, 2 November 2026): three screening questions, then set C1 (K1, K2, R1 to
// R3); C2 is the harder version for the pilot (H1 to H5), which takes both sets in alternating order.

const items = PretestFile.parse(pretestJson).items;
const q = (id: string) => items.find((x) => x.id === id)!;
const LETTERS = "abcde";
const ids = (xs: { id: string }[]) => xs.map((x) => x.id);

describe("the pretest items", () => {
  it("are the three screening questions, then C1 and C2, five knowledge items each", () => {
    expect(ids(items.filter((x) => x.kind === "background"))).toEqual(["q1", "q2", "q3"]);
    expect(pretestSets(items)).toEqual(["C1", "C2"]);
    expect(ids(items.filter((x) => x.set === "C1"))).toEqual(["k1", "k2", "r1", "r2", "r3"]);
    expect(ids(items.filter((x) => x.set === "C2"))).toEqual(["h1", "h2", "h3", "h4", "h5"]);
    expect(items.filter((x) => x.set === "C2").map((x) => x.pair)).toEqual(["k1", "k2", "r1", "r2", "r3"]);
  });

  it("have the team's keys, four options and “I don't know”, and no written reason", () => {
    expect(items.filter((x) => x.set === "C1").map((x) => LETTERS[x.answer!]).join("")).toBe("cdbca");
    expect(items.filter((x) => x.set === "C2").map((x) => LETTERS[x.answer!]).join("")).toBe("cabdc");
    for (const x of items.filter((i) => i.kind === "knowledge")) {
      expect(x.options, x.id).toHaveLength(5);
      expect(x.options.at(-1), x.id).toBe("I don't know");
      expect(x.diagnosis?.[x.answer!], x.id).toBe("correct");
    }
  });

  it("flag an RL course and knowing a bandit algorithm as excluded, and only record the statistics course", () => {
    expect(q("q1").options[q("q1").exclude!]).toBe("Yes");
    expect(q("q2").options[q("q2").exclude!]).toMatch(/could explain an algorithm/);
    expect(q("q3").exclude).toBeUndefined();
  });

  it("have keys that follow from their own numbers", () => {
    // K1: the width shrinks with √n; H1: a quarter of the width needs 16 times the readings
    expect(Math.sqrt(1000 / 10)).toBe(10);
    expect(25 * (2.0 / 0.5) ** 2).toBe(400);
    // K2: each equal rise of ln t needs t to grow tenfold
    expect(Math.log(1000) - Math.log(100)).toBeCloseTo(Math.log(100) - Math.log(10));
    // H2: the harmonic sum keeps growing (past 7 after 1,000 terms), the sum of 1/n² stays below π²/6
    const sum = (f: (n: number) => number, n: number) => Array.from({ length: n }, (_, k) => f(k + 1)).reduce((a, b) => a + b, 0);
    expect(sum((n) => 1 / n, 1000)).toBeGreaterThan(7);
    expect(sum((n) => 1 / n ** 2, 100_000)).toBeLessThan(Math.PI ** 2 / 6);
  });

  it("pass the pack check, which catches a pair outside the first set", () => {
    expect(checkPack("bandits").filter((i) => i.level === "error")).toEqual([]);
    const root = mkdtempSync(join(tmpdir(), "docendo-pre-"));
    const dir = join(root, "topics", "pairs");
    mkdirSync(dir, { recursive: true });
    for (const f of readdirSync("topics/bandits").filter((f) => f.endsWith(".json"))) cpSync(join("topics/bandits", f), join(dir, f));
    const changed = JSON.parse(readFileSync("topics/bandits/pretest.json", "utf8"));
    changed.items.find((x: { id: string }) => x.id === "h1").pair = "h2";
    writeFileSync(join(dir, "pretest.json"), JSON.stringify(changed));
    const errors = checkPack("pairs", root).filter((i) => i.level === "error").map((i) => i.msg);
    expect(errors.some((m) => m.includes("h1 pairs h2"))).toBe(true);
  });
});

describe("which pretest a session takes", () => {
  it("the first set, or in a pilot both sets in an order that alternates with the test form", () => {
    expect(setsFor(items, false, "A")).toEqual(["C1"]);
    expect(setsFor(items, false, "B")).toEqual(["C1"]);
    expect(setsFor(items, true, "A")).toEqual(["C1", "C2"]);
    expect(setsFor(items, true, "B")).toEqual(["C2", "C1"]);
  });
  it("the screening questions first, then each set's items", () => {
    expect(ids(pretestItems(items, ["C2", "C1"]))).toEqual(["q1", "q2", "q3", "h1", "h2", "h3", "h4", "h5", "k1", "k2", "r1", "r2", "r3"]);
  });
});

describe("scoring the pretest", () => {
  const keys = (sets: string[]) => Object.fromEntries(pretestItems(items, sets).map((x) => [x.id, x.answer ?? 1]));
  it("counts the knowledge items right, in all and per set, and “I don't know”", () => {
    const one = gradePretest(items, keys(["C1"]), ["C1"])!;
    expect([one.score, one.of, one.excluded, one.setScores]).toEqual([5, 5, false, { C1: { score: 5, of: 5 } }]);
    const answers = { ...keys(["C2", "C1"]), h3: 4, k2: 0 }; // one "I don't know", one wrong
    const both = gradePretest(items, answers, ["C2", "C1"])!;
    expect([both.score, both.of, both.dontKnow, both.sets]).toEqual([8, 10, 1, ["C2", "C1"]]);
    expect(both.setScores).toEqual({ C2: { score: 4, of: 5 }, C1: { score: 4, of: 5 } });
  });
  it("flags an excluding background answer", () => {
    expect(gradePretest(items, { ...keys(["C1"]), q1: 0 }, ["C1"])!.excluded).toBe(true);
    expect(gradePretest(items, { ...keys(["C1"]), q2: 3 }, ["C1"])!.excluded).toBe(true);
    expect(gradePretest(items, { ...keys(["C1"]), q3: 2 }, ["C1"])!.excluded).toBe(false);
  });
  it("refuses answers that don't fit the session's items", () => {
    const { r3: _, ...missing } = keys(["C1"]);
    expect(gradePretest(items, missing, ["C1"])).toBeNull();
    expect(gradePretest(items, { ...keys(["C1"]), h1: 2 }, ["C1"])).toBeNull(); // an item of a set not taken
    expect(gradePretest(items, { ...keys(["C1"]), k1: 7 }, ["C1"])).toBeNull(); // no such option
    expect(gradePretest(items, keys(["C1"]), ["C3"])).toBeNull();
    expect(gradePretest(items, keys(["C1"]), ["C1", "C1"])).toBeNull();
  });
});

describe("the pretest in the research log", () => {
  it("keeps the sets in order, the score in each, and the screening answers as columns", () => {
    const t = tables([
      { t: "session_start", sid: "s1", at: "2026-11-03T10:00:00.000Z", condition: "direct", entry: "participant" },
      { t: "pretest", sid: "s1", at: "2026-11-03T10:04:00.000Z", version: "abc", answers: { q1: 1, q2: 2, q3: 0, k1: 2 }, sets: ["C2", "C1"], score: 7, of: 10, setScores: { C2: { score: 3, of: 5 }, C1: { score: 4, of: 5 } }, dontKnow: 2, excluded: false },
    ]);
    const s = t.sessions[0]!;
    expect([s.pretestSets, s.pretestScore_C1, s.pretestOf_C1, s.pretestScore_C2, s.pretestVersion]).toEqual(["C2 C1", 4, 5, 3, "abc"]);
    expect([s.rlCourse, s.heardOfBandits, s.statsCourse, s.excluded]).toEqual([false, 2, 0, false]);
  });
  it("still reads the older screening questions (b1, b2)", () => {
    const t = tables([{ t: "pretest", sid: "s2", at: "2026-10-20T10:00:00.000Z", answers: { b1: 0, b2: 1 }, score: 1, of: 3 }]);
    expect([t.sessions[0]!.rlCourse, t.sessions[0]!.heardOfBandits]).toEqual([true, 1]);
  });
});
