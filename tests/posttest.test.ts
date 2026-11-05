import { describe, expect, it } from "vitest";
import { readFileSync, mkdtempSync, mkdirSync, writeFileSync, cpSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import exercisesJson from "../topics/bandits/exercises.json";
import stashedJson from "../topics/bandits/stash/exercises.json";
import { ExercisesFile, checkPack } from "../content/pack";
import { answerOf, checkExercise, gradeTest, keyText, sessionItems } from "../content/test";
import { checkNumber } from "../content/practice";
import { DONT_KNOW, reasonGiven } from "../lib/answers";
import { seedOf, testOrder, testParts } from "../lib/order";
import { tables } from "../lib/analytics";

// The post-test since 2026-11-05 (greedy and UCB only, Phil's and Andrii's items merged): five items a form in a fixed
// order, from greedy to a changed UCB. Form A T1, T12, T16, T4, T6; form B questions of its own (2026-11-05, so a pilot
// taking both forms tries ten): V1, V16, V18, V7, V4. The other items (the team's T1 to T10 and V1 to V10, the earlier
// twins, and later ones) are in stash/exercises.json. The pilot takes both forms, its own form first.

const file = ExercisesFile.parse(exercisesJson);
const test = file.items; // what the app serves
const all = [...test, ...ExercisesFile.parse(stashedJson).items]; // with the items taken out (stash/), for the grading rules
const forms = { A: test.filter((q) => q.form === "A"), B: test.filter((q) => q.form === "B") };
const q = (id: string) => all.find((x) => x.id === id)!;
const LETTERS = "abcd";
const ucb = (avg: number, n: number, t: number, c = Math.SQRT2) => avg + c * Math.sqrt(Math.log(t) / n);
const argmax = (xs: number[]) => xs.indexOf(Math.max(...xs));

describe("the post-test items", () => {
  it("are five a form in a fixed order (greedy, greedy's lock-in, UCB's rule, one UCB round, a changed UCB), every one with “I don't know”, a reason and a rubric", () => {
    expect(file.order).toBe("fixed");
    expect(forms.A.map((x) => x.id)).toEqual(["t01", "t12", "t16", "t04", "t06"]);
    expect(forms.B.map((x) => x.id)).toEqual(["v01", "v16", "v18", "v07", "v04"]);
    expect(forms.A.map((x) => x.section)).toEqual(["Greedy", "Greedy", "UCB", "UCB", "UCB"]);
    // form B: questions of its own, not twins of form A's (no item names a twin, no prompt repeats one)
    expect(forms.B.filter((x) => x.pair)).toEqual([]);
    for (const b of forms.B) for (const a of forms.A) expect(b.prompt).not.toBe(a.prompt);
    for (const x of test) {
      expect(x.dontKnow && x.reason, x.id).toBe(true);
      expect(x.rubric, x.id).toBeTruthy();
      expect(x.diagnosis, x.id).toHaveLength(x.options!.length);
      expect(x.options!.length, x.id).toBe(x.id === "v01" ? 3 : 4); // the optimistic start has three
      expect(`${x.prompt} ${x.options!.join(" ")} ${x.explain}`, x.id).not.toMatch(/ε|epsilon/i); // no ε-greedy since 2026-11-05
    }
  });

  it("have the keys, each diagnosis agreeing with its key", () => {
    expect(forms.A.map((x) => LETTERS[x.answer as number]).join("")).toBe("bcdad");
    expect(forms.B.map((x) => LETTERS[x.answer as number]).join("")).toBe("bcdbc");
    // each diagnosis agrees with the key: "correct" (or "true") exactly on the key
    for (const x of all) for (const [k, d] of x.diagnosis!.entries()) expect(/^(correct|true)$/.test(d), `${x.id} ${k}`).toBe(Array.isArray(x.answer) ? x.answer.includes(k) : x.answer === k);
    // one UCB round: no single option offered (the bonus formula isn't given, so the item asks which pairs the tries settle)
    for (const o of q("t04").options!) expect(o).toMatch(/ or |Any of/);
    expect(q("t04").prompt).toMatch(/no calculation is needed/);
    // no anchor any more (T10 = V9 was about ε-greedy)
    expect(test.filter((x) => x.same)).toEqual([]);
  });

  it("have keys that follow from their own numbers", () => {
    // V14: within one round, C beats A (same average, fewer tries) and B beats D (same tries, higher average); B against
    // C depends on the bonus's size
    for (const c of [0.1, 1, 5]) {
      const [A, B, C, D] = [ucb(4.6, 200, 320, c), ucb(4.1, 15, 320, c), ucb(4.6, 90, 320, c), ucb(3.5, 15, 320, c)];
      expect(C).toBeGreaterThan(A);
      expect(B).toBeGreaterThan(D);
    }
    expect(argmax([ucb(4.1, 15, 320, 0.05), ucb(4.6, 90, 320, 0.05)])).toBe(1);
    expect(argmax([ucb(4.1, 15, 320, 2), ucb(4.6, 90, 320, 2)])).toBe(0);
    // V11: A's lucky 9 falls below B's 7.5 after a few trips near 6
    expect((9 + 6 + 6) / 3).toBeLessThan(7.5);
    // T12 and V15: the worse option never scores below the better one's unlucky first try, so lock-in is certain
    expect(6).toBeGreaterThan(5.5);
    expect(6.5).toBeGreaterThan(6);
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
    // T8: C has A's tries (so A's bonus) and a lower average, so UCB never ranks C above A
    for (const c of [0.1, 1, 10]) expect(ucb(3, 100, 203, c)).toBeLessThan(ucb(8, 100, 203, c));
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
    for (const f of [forms.A, forms.B]) {
      const counts = [0, 0, 0, 0];
      for (const x of f.filter((t) => t.kind === "choice")) counts[x.answer as number]!++;
      expect(Math.max(...counts)).toBeLessThanOrEqual(3);
    }
  });

  it("use settings of their own, never the lesson's or the practice's", () => {
    const practice = /food truck|restaurant|slot machine|festival|exercise type|cake|audio tour|page layout|thumbnail|ice-cream|flavour/i;
    for (const x of test) expect(`${x.prompt} ${x.options!.join(" ")}`, x.id).not.toMatch(practice);
  });

  it("pass the pack check, which catches an anchor that differs from its twin", () => {
    expect(checkPack("bandits").filter((i) => i.level === "error")).toEqual([]);
    const root = mkdtempSync(join(tmpdir(), "docendo-post-"));
    const dir = join(root, "topics", "anchor");
    mkdirSync(dir, { recursive: true });
    for (const f of readdirSync("topics/bandits").filter((f) => f.endsWith(".json"))) cpSync(join("topics/bandits", f), join(dir, f));
    const changed = JSON.parse(readFileSync("topics/bandits/exercises.json", "utf8"));
    changed.items.find((x: { id: string }) => x.id === "v16").same = "t01"; // marked an anchor, but a question of its own
    writeFileSync(join(dir, "exercises.json"), JSON.stringify(changed));
    const errors = checkPack("anchor", root).filter((i) => i.level === "error").map((i) => i.msg);
    expect(errors.some((m) => m.includes("v16") && m.includes("identical"))).toBe(true);
  });
});

describe("which items a session answers", () => {
  it("one form: its five items", () => {
    expect(sessionItems(test, "A", false).map((x) => x.id)).toEqual(forms.A.map((x) => x.id));
    expect(sessionItems(test, "B", false).map((x) => x.id)).toEqual(forms.B.map((x) => x.id));
  });
  it("both forms (the pilot): its own form first, then the other", () => {
    const ab = sessionItems(test, "A", true).map((x) => x.id);
    expect(ab).toEqual([...forms.A, ...forms.B].map((x) => x.id));
    const ba = sessionItems(test, "B", true).map((x) => x.id);
    expect(ba).toEqual([...forms.B, ...forms.A].map((x) => x.id));
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
  it("scores one form, or both, each form on its own", () => {
    const one = gradeTest(test, "A", false, keys(forms.A.map((x) => x.id)));
    expect([one.score, one.of, one.perForm.A]).toEqual([5, 5, { score: 5, of: 5 }]);
    const ids = sessionItems(test, "A", true).map((x) => x.id);
    const answers: unknown[] = keys(ids);
    answers[ids.indexOf("t04")] = 1;
    answers[ids.indexOf("v18")] = DONT_KNOW;
    const both = gradeTest(test, "A", true, answers);
    expect([both.score, both.of]).toEqual([8, 10]);
    expect(both.perForm).toEqual({ A: { score: 4, of: 5 }, B: { score: 4, of: 5 } });
    expect(both.copies).toEqual([]);
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
  it("counts any text as a reason, a word or a symbol, and nothing else", () => {
    expect(reasonGiven("because")).toBe(true);
    expect(reasonGiven("?")).toBe(true);
    expect(reasonGiven("   ")).toBe(false);
    expect(reasonGiven(undefined)).toBe(false);
  });
});

describe("the post-test order and parts", () => {
  const items = sessionItems(test, "A", true).map((x) => ({ id: x.id, kind: x.kind, form: x.form }));
  it("asks a fixed order as the file gives it, form by form", () => {
    expect(testOrder(items, seedOf("token-a"), true)).toEqual(items.map((x) => x.id));
    expect(testOrder(items, seedOf("token-b"), true)).toEqual(items.map((x) => x.id));
  });
  it("otherwise keeps the forms apart, own form first, each shuffled per learner and stable", () => {
    const o = testOrder(items, seedOf("token-a"));
    expect(new Set(o.slice(0, 5))).toEqual(new Set(forms.A.map((x) => x.id)));
    expect(o.slice(5).every((id) => id.startsWith("v"))).toBe(true);
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
      ["Part 1 of 2", 0, 0, 5],
      ["Part 2 of 2", 1, 5, 5],
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
