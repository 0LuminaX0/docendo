import { describe, expect, it } from "vitest";
import { readFileSync, mkdtempSync, mkdirSync, writeFileSync, cpSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import exercisesJson from "../topics/bandits/exercises.json";
import { ExercisesFile, checkPack } from "../content/pack";
import { answerOf, checkExercise, gradeTest, keyText, sessionItems } from "../content/test";
import { checkNumber } from "../content/practice";
import { DONT_KNOW, reasonGiven } from "../lib/answers";
import { seedOf, testOrder, testParts } from "../lib/order";
import { tables } from "../lib/analytics";

// The team's post-test (main doc, 2 November 2026): form A = T1 to T10, form B = V1 to V10 (harder), V9 the same as
// T10 (the anchor). The pilot takes both forms after the lesson, its own form first. Since 2026-11-05 one form is
// served: t11 (what a bandit problem is), t01 and t12 (greedy), t04 and t06 (UCB), t10 (the anchor on c); ε-greedy left
// the lesson and form B was dropped, so their items are marked off (kept, never served), t13 and t14 written in t08's
// and t09's places. The checks of the items cover every item in the file; the two-form mechanism is checked on the
// team's original forms (T1 to T10 and V1 to V10), which it was built for.

const test = ExercisesFile.parse(exercisesJson).items; // every item in the file, those marked off included
const served = test.filter((q) => !q.off);
const team = test.filter((q) => /^[tv](0\d|10)$/.test(q.id)); // the team's original T1 to T10 and V1 to V10
const forms = { A: team.filter((q) => q.form === "A"), B: team.filter((q) => q.form === "B") };
const q = (id: string) => test.find((x) => x.id === id)!;
const LETTERS = "abcd";
const ucb = (avg: number, n: number, t: number, c = Math.SQRT2) => avg + c * Math.sqrt(Math.log(t) / n);
const argmax = (xs: number[]) => xs.indexOf(Math.max(...xs));

describe("the post-test items", () => {
  it("are T1 to T10 (form A) and V1 to V10 (form B) plus t11 to t14, every one with “I don't know”, a reason and a rubric", () => {
    expect(forms.A.map((x) => x.id)).toEqual(Array.from({ length: 10 }, (_, k) => `t${String(k + 1).padStart(2, "0")}`));
    expect(test.filter((x) => !team.includes(x)).map((x) => x.id)).toEqual(["t11", "t12", "t13", "t14"]);
    // served: one form of six, with no ε-greedy item and nothing from form B
    expect(served.map((x) => x.id)).toEqual(["t11", "t01", "t12", "t04", "t06", "t10"]);
    for (const x of served) expect(`${x.prompt} ${x.options!.join(" ")}`, x.id).not.toMatch(/ε|epsilon/i);
    expect(forms.B.map((x) => x.id)).toEqual(Array.from({ length: 10 }, (_, k) => `v${String(k + 1).padStart(2, "0")}`));
    for (const x of test) {
      expect(x.dontKnow && x.reason, x.id).toBe(true);
      expect(x.rubric, x.id).toBeTruthy();
      expect(x.diagnosis, x.id).toHaveLength(x.options!.length);
      expect(x.options!.length, x.id).toBe(x.id === "v01" ? 3 : 4); // V1 has three options
    }
  });

  it("have the keys of the team's answer key", () => {
    // form 1: b, a, d, c, a, d, b, c, a, d; form 2: b, (b, d), a, c, d, a, b, (a, d), d, (b, d)
    expect(forms.A.map((x) => LETTERS[x.answer as number]).join("")).toBe("badcadbcad");
    const v = forms.B.map((x) => (Array.isArray(x.answer) ? x.answer.map((k) => LETTERS[k]).join("") : LETTERS[x.answer]));
    expect(v).toEqual(["b", "bd", "a", "c", "d", "a", "b", "ad", "d", "bd"]);
    // the items written 2026-11-05, and the form served
    expect(["t11", "t12", "t13", "t14"].map((id) => LETTERS[q(id).answer as number]).join("")).toBe("acca");
    expect(served.map((x) => LETTERS[x.answer as number]).join("")).toBe("abccdd");
    expect(forms.B.filter((x) => x.kind === "multi").map((x) => x.id)).toEqual(["v02", "v08", "v10"]);
    // each diagnosis agrees with the key: "correct" (or "true") exactly on the key
    for (const x of test) for (const [k, d] of x.diagnosis!.entries()) expect(/^(correct|true)$/.test(d), `${x.id} ${k}`).toBe(Array.isArray(x.answer) ? x.answer.includes(k) : x.answer === k);
  });

  it("make V9 the same item as T10, marked so it is asked once when a session takes both forms", () => {
    const [t10, v09] = [q("t10"), q("v09")];
    expect(v09.same).toBe("t10");
    expect([v09.prompt, v09.options, v09.answer, v09.explain]).toEqual([t10.prompt, t10.options, t10.answer, t10.explain]);
    expect(test.filter((x) => x.same).map((x) => x.id)).toEqual(["v09"]);
  });

  it("have keys that follow from their own numbers", () => {
    // T2: about 2.5% of 50,000 sends are random picks of D
    expect((50_000 * 0.1) / 4).toBe(1250);
    // T4: within one round, A beats C (same average, fewer tries) and B beats D (same tries, higher average); A against
    // B depends on the bonus's size: small c gives A, large c gives B
    for (const c of [0.1, 1, 5]) {
      const [A, B, C, D] = [ucb(7.2, 80, 300, c), ucb(6.5, 6, 300, c), ucb(7.2, 120, 300, c), ucb(5, 6, 300, c)];
      expect(A).toBeGreaterThan(C);
      expect(B).toBeGreaterThan(D);
    }
    expect(argmax([ucb(7.2, 80, 300, 0.1), ucb(6.5, 6, 300, 0.1)])).toBe(0);
    expect(argmax([ucb(7.2, 80, 300, 5), ucb(6.5, 6, 300, 5)])).toBe(1);
    // T6: A's score is frozen at 5.5, B's never falls below its average, at least 6
    expect(5.5).toBeLessThan(6);
    // T8 and t13: C has A's tries (so A's bonus) and a lower average, so UCB never ranks C above A; t13: B (7.9 from 2
    // tries) can beat A (8.0 from 100), unless the bonus is tiny
    for (const c of [0.1, 1, 10]) expect(ucb(3, 100, 203, c)).toBeLessThan(ucb(8, 100, 203, c));
    expect(argmax([ucb(8, 100, 203, 1), ucb(7.9, 2, 203, 1)])).toBe(1);
    expect(argmax([ucb(8, 100, 203, 0.01), ucb(7.9, 2, 203, 0.01)])).toBe(0);
    // t12: B's evenings are at least 6, so B's average stays at least 6, above A's frozen 5.5: greedy never goes back
    for (const bs of [[6.5, 6, 6, 6, 6], [6.5, 7, 6, 6.2]]) expect(bs.reduce((a, b) => a + b, 0) / bs.length).toBeGreaterThan(5.5);
    // T9 and V3: ε-greedy's random picks, a quarter of 10% each, at the same rate early and late
    expect((0.1 / 4) * 100).toBeCloseTo(2.5);
    // V2: the favourite gets 90% + its share of the random picks; each worse banner its share; together the rest
    const shares = (k: number) => ({ fav: 0.9 + 0.1 / k, each: 0.1 / k, worse: (0.1 * (k - 1)) / k });
    expect(shares(2).fav).toBeCloseTo(0.95);
    expect(shares(20).fav).toBeCloseTo(0.905);
    expect(shares(2).each).toBeCloseTo(0.05);
    expect(shares(20).each).toBeCloseTo(0.005);
    expect(shares(2).worse).toBeCloseTo(0.05);
    expect(shares(20).worse).toBeCloseTo(0.095);
    // V10: after one try each, every bonus is the same, so UCB picks the highest average, like greedy
    const avgs = [5.1, 7.3, 2.2, 6.8, 4.4, 7.0, 3.9, 6.1];
    expect(argmax(avgs.map((a) => ucb(a, 1, 9)))).toBe(argmax(avgs));
    // T10: ratings × 100 with the same c: the bonus is tiny next to the gaps, so UCB picks like greedy
    expect(argmax([ucb(80, 5, 100, 1), ucb(50, 1, 100, 1)])).toBe(0);
    expect(argmax([ucb(0.8, 5, 100, 1), ucb(0.5, 1, 100, 1)])).toBe(1); // at the original scale the bonus still wins
  });

  it("don't give the key away by its length, and spread single-choice keys over the positions", () => {
    for (const x of test.filter((t) => t.kind === "choice")) {
      const others = x.options!.filter((_, k) => k !== x.answer).map((o) => o.length);
      expect(x.options![x.answer as number]!.length, x.id).toBeLessThanOrEqual(Math.max(...others) * 1.1);
    }
    for (const f of [forms.A, forms.B, served]) {
      const counts = [0, 0, 0, 0];
      for (const x of f.filter((t) => t.kind === "choice")) counts[x.answer as number]!++;
      expect(Math.max(...counts)).toBeLessThanOrEqual(3);
    }
  });

  it("use settings of their own, never the lesson's or the practice's", () => {
    const practice = /food truck|restaurant|slot machine|festival|exercise type|cake|audio tour|page layout|thumbnail/i;
    for (const x of test) expect(`${x.prompt} ${x.options!.join(" ")}`, x.id).not.toMatch(practice);
  });

  it("pass the pack check, which catches an anchor that differs from its twin", () => {
    expect(checkPack("bandits").filter((i) => i.level === "error")).toEqual([]);
    const root = mkdtempSync(join(tmpdir(), "docendo-post-"));
    const dir = join(root, "topics", "anchor");
    mkdirSync(dir, { recursive: true });
    for (const f of readdirSync("topics/bandits").filter((f) => f.endsWith(".json"))) cpSync(join("topics/bandits", f), join(dir, f));
    const changed = JSON.parse(readFileSync("topics/bandits/exercises.json", "utf8"));
    changed.items.find((x: { id: string }) => x.id === "v09").options[0] = "Neither app";
    writeFileSync(join(dir, "exercises.json"), JSON.stringify(changed));
    const errors = checkPack("anchor", root).filter((i) => i.level === "error").map((i) => i.msg);
    expect(errors.some((m) => m.includes("v09") && m.includes("identical"))).toBe(true);
  });
});

describe("which items a session answers", () => {
  it("one form: its items", () => {
    expect(sessionItems(team, "A", false).map((x) => x.id)).toEqual(forms.A.map((x) => x.id));
    expect(sessionItems(team, "B", false).map((x) => x.id)).toEqual(forms.B.map((x) => x.id));
    expect(sessionItems(served, "A", false).map((x) => x.id)).toEqual(served.map((x) => x.id)); // the form served now
  });
  it("both forms (the pilot): its own form first, then the other without the anchor it has already answered", () => {
    const ab = sessionItems(team, "A", true).map((x) => x.id);
    expect(ab).toHaveLength(19);
    expect(ab.slice(0, 10)).toEqual(forms.A.map((x) => x.id));
    expect(ab).not.toContain("v09");
    const ba = sessionItems(team, "B", true).map((x) => x.id);
    expect(ba).toHaveLength(19);
    expect(ba.slice(0, 10)).toEqual(forms.B.map((x) => x.id));
    expect(ba).not.toContain("t10"); // V9 came first: T10 isn't asked again
  });
});

describe("grading the post-test", () => {
  const keys = (ids: string[]) => ids.map((id) => q(id).answer);
  it("reads answers: an option, the statements ticked, “I don't know”; anything else is unanswered", () => {
    expect(answerOf(q("t01"), 1)).toBe(1);
    expect(answerOf(q("t01"), 7)).toBeNull(); // no such option
    expect(answerOf(q("t01"), [1])).toBeNull();
    expect(answerOf(q("t01"), DONT_KNOW)).toBe(DONT_KNOW);
    expect(answerOf(q("v02"), [3, 1, 3])).toEqual([1, 3]); // sorted, once each
    expect(answerOf(q("v02"), [])).toBeNull();
    expect(answerOf(q("v02"), [9])).toBeNull();
    expect(answerOf(q("v02"), 1)).toBeNull();
  });
  it("counts a multi-select item right only with exactly the true statements, and “I don't know” as wrong", () => {
    expect(checkExercise(q("v02"), [1, 3])).toBe(true);
    expect(checkExercise(q("v02"), [1])).toBe(false);
    expect(checkExercise(q("v02"), [1, 2, 3])).toBe(false);
    expect(checkExercise(q("t01"), 1)).toBe(true);
    expect(checkExercise(q("t01"), DONT_KNOW)).toBe(false);
    expect(checkExercise(q("t01"), null)).toBe(false);
    expect(keyText(q("v02"))).toBe(`${q("v02").options![1]} | ${q("v02").options![3]}`);
  });
  it("scores one form, or both with the anchor answered once and counted in both", () => {
    const one = gradeTest(team, "A", false, keys(forms.A.map((x) => x.id)));
    expect([one.score, one.of, one.perForm.A]).toEqual([10, 10, { score: 10, of: 10 }]);
    const ids = sessionItems(team, "A", true).map((x) => x.id);
    const answers: unknown[] = keys(ids);
    answers[ids.indexOf("t10")] = 0; // the anchor wrong: it counts wrong in both forms
    answers[ids.indexOf("v02")] = DONT_KNOW;
    const both = gradeTest(team, "A", true, answers);
    expect([both.score, both.of]).toEqual([17, 19]);
    expect(both.perForm).toEqual({ A: { score: 9, of: 10 }, B: { score: 8, of: 10 } });
    expect(both.copies.map((c) => [c.q.id, c.from, c.correct])).toEqual([["v09", "t10", false]]);
    // V first: V9 is asked, T10 takes its answer
    const ba = gradeTest(team, "B", true, keys(sessionItems(team, "B", true).map((x) => x.id)));
    expect(ba.perForm).toEqual({ B: { score: 10, of: 10 }, A: { score: 10, of: 10 } });
    expect(ba.copies.map((c) => [c.q.id, c.from])).toEqual([["t10", "v09"]]);
  });
  it("still grades a typed number with its tolerance (number items, as in practice)", () => {
    expect(checkNumber("14", 14, 0.05)).toBe(true);
    expect(checkNumber("14.0 ", 14, 0.05)).toBe(true);
    expect(checkNumber("13", 14, 0.05)).toBe(false);
    expect(checkNumber("0", 0, 0)).toBe(true);
    expect(checkNumber("1,59", 1.589, 0.02)).toBe(true);
    expect(checkNumber("1.55", 1.589, 0.02)).toBe(false);
    expect(checkNumber("about 50", 50, 1)).toBe(false); // words aren't a number
  });
  it("needs a few words for a reason", () => {
    expect(reasonGiven("because")).toBe(false);
    expect(reasonGiven("its bonus keeps growing")).toBe(true);
  });
});

describe("the post-test order and parts", () => {
  const items = sessionItems(team, "A", true).map((x) => ({ id: x.id, kind: x.kind, form: x.form }));
  it("keeps the forms apart, own form first, each shuffled per learner and stable", () => {
    const o = testOrder(items, seedOf("token-a"));
    expect(new Set(o.slice(0, 10))).toEqual(new Set(forms.A.map((x) => x.id)));
    expect(o.slice(10).every((id) => id.startsWith("v"))).toBe(true);
    expect(testOrder(items, seedOf("token-a"))).toEqual(o);
    expect(new Set(["a", "b", "c", "d"].map((t) => testOrder(items, seedOf(`token-${t}`)).join())).size).toBeGreaterThan(2);
  });
  it("orders one form exactly as before forms were grouped (sessions keep their saved order anyway)", () => {
    const one = forms.A.map((x) => ({ id: x.id, kind: x.kind }));
    expect(testOrder(one, 42)).toEqual(testOrder(one.map((x) => ({ ...x, form: "A" })), 42));
  });
  it("shows two forms as parts 1 and 2, numbered on", () => {
    const p = testParts(items, testOrder(items, 7));
    expect(p.map((x) => [x.title, x.group, x.start, x.list.length])).toEqual([
      ["Part 1 of 2", 0, 0, 10],
      ["Part 2 of 2", 1, 10, 9],
    ]);
    expect(testParts(forms.A, null).map((x) => x.title)).toEqual([""]); // one form, one kind: no heading
  });
});

describe("the post-test in the research log", () => {
  it("keeps each form's score, “I don't know” and the reasons, and a blind table of the reasons", () => {
    const at = (s: number) => new Date(Date.UTC(2026, 10, 3, 10, 0, s)).toISOString();
    const t = tables([
      { t: "session_start", sid: "s1", at: at(0), condition: "recursive", entry: "participant", form: "A", testForms: ["A", "B"] },
      { t: "client_page_view", sid: "s1", at: at(1), path: "/exercises" },
      { t: "client_test_part", sid: "s1", at: at(31), part: 1 },
      { t: "client_test_submit", sid: "s1", at: at(61) },
      {
        t: "grade", sid: "s1", at: at(62), phase: "main", form: "A", forms: ["A", "B"], score: 17, of: 19, dontKnow: 1,
        formScores: { A: { score: 9, of: 10 }, B: { score: 8, of: 10 } },
        items: [
          { id: "t01", form: "A", version: "aaa", kind: "choice", pos: 1, chosen: 1, answer: 1, correct: true, reason: "B keeps being tried so its average falls" },
          { id: "v02", form: "B", version: "bbb", kind: "multi", pos: 11, chosen: "idk", answer: [1, 3], correct: false, reason: null },
        ],
      },
    ]);
    const s = t.sessions[0]!;
    expect([s.testForms, s.testScoreA, s.testOfA, s.testScoreB, s.testOfB, s.testDontKnow, s.testReasons]).toEqual(["A B", 9, 10, 8, 10, 1, 1]);
    expect(s.minTestPart1).toBeCloseTo(0.5);
    expect(s.minTestPart2).toBeCloseTo(0.5);
    expect(t.test.map((r) => [r.id, r.form, r.version, r.dontKnow])).toEqual([["t01", "A", "aaa", false], ["v02", "B", "bbb", true]]);
    expect(t.reasons).toEqual([{ ref: t.test[0]!.ref, item: "t01", form: "A", chosen: "B", reason: "B keeps being tried so its average falls", score: "" }]);
    expect(Object.keys(t.reasons[0]!)).toEqual(["ref", "item", "form", "chosen", "reason", "score"]); // nothing that names the session or its condition
  });
});
