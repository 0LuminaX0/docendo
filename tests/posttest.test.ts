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
import { mean, picksOf } from "./bandit-sim";

// The post-test since 2026-11-12: one final test for everyone, form A (`final`), seven items in a fixed order from
// greedy to the price of exploring: T1, T12, V14, V7, T6, V21, V19 (V21 in V4's place since 2026-11-16, when V4's
// idea went into practice as P8). Form B holds the pilot's candidates, asked after it only with both forms (the pilot
// code): V1, V15, T7. The other items (the team's T1 to T10 and V1 to V10, the earlier twins, T16, T4, V20, V4 and
// later ones) are in stash/exercises.json.

const file = ExercisesFile.parse(exercisesJson);
const test = file.items; // what the app serves
const all = [...test, ...ExercisesFile.parse(stashedJson).items]; // with the items taken out (stash/), for the grading rules
const forms = { A: test.filter((q) => q.form === "A"), B: test.filter((q) => q.form === "B") };
const q = (id: string) => all.find((x) => x.id === id)!;
const LETTERS = "abcd";
const ucb = (avg: number, n: number, t: number, c = Math.SQRT2) => avg + c * Math.sqrt(Math.log(t) / n);
const argmax = (xs: number[]) => xs.indexOf(Math.max(...xs));

describe("the post-test items", () => {
  it("are one final test of seven in a fixed order (greedy, lock-in, UCB's choice, close options, a changed UCB, logs of a long run, the price of exploring) and the pilot's candidates, every one with “I don't know”, a reason and a rubric", () => {
    expect(file.order).toBe("fixed");
    expect(file.final).toBe("A");
    expect(forms.A.map((x) => x.id)).toEqual(["t01", "t12", "v14", "v07", "t06", "v21", "v19"]);
    expect(forms.B.map((x) => x.id)).toEqual(["v01", "v15", "t07"]);
    expect(forms.A.map((x) => x.section)).toEqual(["Greedy", "Greedy", "UCB", "UCB", "UCB", "Comparison", "Comparison"]);
    // V4 (ever longer gaps) left for the stash when P8 began to practise its idea: no near twin of a practice problem
    expect(test.some((x) => x.id === "v04")).toBe(false);
    expect(q("v04").note).toMatch(/2026-11-16/);
    // the pilot's candidates: no prompt repeats a final item's; the one twin (V15) names its final item (T12)
    expect(forms.B.filter((x) => x.pair).map((x) => [x.id, x.pair])).toEqual([["v15", "t12"]]);
    for (const b of forms.B) for (const a of forms.A) expect(b.prompt).not.toBe(a.prompt);
    // c leaves the lesson (2026-11-12): no item served mentions it
    for (const x of test) expect(`${x.prompt} ${x.options!.join(" ")}`, x.id).not.toMatch(/\bc\b|setting/);
    for (const x of test) {
      expect(x.dontKnow && x.reason, x.id).toBe(true);
      expect(x.rubric, x.id).toBeTruthy();
      expect(x.diagnosis, x.id).toHaveLength(x.options!.length);
      expect(x.options!.length, x.id).toBe(x.id === "v01" ? 3 : 4); // the optimistic start has three
      expect(`${x.prompt} ${x.options!.join(" ")} ${x.explain}`, x.id).not.toMatch(/ε|epsilon/i); // no ε-greedy since 2026-11-05
    }
  });

  it("have the keys, each diagnosis agreeing with its key", () => {
    expect(forms.A.map((x) => LETTERS[x.answer as number]).join("")).toBe("bcdbdca");
    expect(forms.B.map((x) => LETTERS[x.answer as number]).join("")).toBe("bab");
    // each diagnosis agrees with the key: "correct" (or "true") exactly on the key
    for (const x of all) for (const [k, d] of x.diagnosis!.entries()) expect(/^(correct|true)$/.test(d), `${x.id} ${k}`).toBe(Array.isArray(x.answer) ? x.answer.includes(k) : x.answer === k);
    // one UCB round: no single option offered (the bonus's size isn't known, so the item asks which pairs the tries settle)
    for (const o of q("v14").options!) expect(o).toMatch(/ or |Any of/);
    expect(q("v14").prompt).toMatch(/don't need to calculate/);
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
    // V19: A's shares never fall below 0.7 − 0.1 = 0.6, above B's trial 0.5 and C's 0.2, so greedy puts A, the truly best,
    // in front every day; every UCB pick of B or C then costs (B 0.6 and C 0.3 against A's 0.7)
    expect(0.7 - 0.1).toBeGreaterThan(Math.max(0.5, 0.2));
    expect(argmax([0.7, 0.6, 0.3])).toBe(0);
    // ...and UCB leaves A at once, so the totals don't stay level: with the lesson's formula (no c), on the second day after
    // the trials (round 5, A picked twice, its average at most 0.8) B's bonus after its one try carries it past A; an unpicked
    // bonus keeps growing, so this happens again and again and UCB never catches up. On points out of 10 (the version before
    // 2026-11-16) the same rule keeps UCB on A for about 10,000 days, which made "about the same" all but true.
    expect(argmax([ucb(0.8, 2, 5, 1), ucb(0.5, 1, 5, 1), ucb(0.2, 1, 5, 1)])).toBe(1);
    expect(argmax([ucb(9, 2, 5, 1), ucb(4, 1, 5, 1), ucb(1, 1, 5, 1)])).toBe(0);
    // V21: Y (UCB) picks the worst option about as often in each roughly tenfold longer period (picks grow like ln t), X at
    // a fixed 3% of every period, W stops, Z (greedy) only on its trial. The columns don't follow the stem's order
    // (greedy, UCB, the others), and the Length column states each period's rounds.
    const v21 = q("v21");
    const num = (v: string) => Number(v.replace(/[^\d]/g, ""));
    const lengths = v21.table!.rows.map((r) => {
      const [lo, hi] = r[0]!.replace(/,/g, "").match(/\d+/g)!.map(Number);
      expect(num(r[1]!), r[0]).toBe(hi! - lo! + 1);
      return num(r[1]!);
    });
    expect(lengths).toEqual([1000, 9000, 90000]);
    const logs = v21.table!.rows.map((r) => r.slice(2).map(num));
    const col = (k: number) => logs.map((r) => r[k]!);
    const [STOPS, STEADY, UCB, GREEDY] = [0, 1, 2, 3];
    expect(v21.table!.head.slice(2)).toEqual(["Log W", "Log X", "Log Y", "Log Z"]);
    expect(v21.options![v21.answer as number]).toBe("Greedy Z, UCB Y");
    expect(new Set(v21.options!.map((o) => o.split("UCB ")[1])).size).toBe(4); // each log is UCB in one option
    expect(col(GREEDY)).toEqual([1, 0, 0]);
    expect(col(STEADY).map((n, i) => n / lengths[i]!)).toEqual([0.03, 0.03, 0.03]);
    expect(col(STOPS).at(-1)).toBe(0);
    expect(col(STOPS)).toEqual([...col(STOPS)].sort((a, b) => b - a)); // it dies out
    // the first period doesn't tell the three that pick it again apart (only how they go on does)
    const firsts = [STOPS, STEADY, UCB].map((k) => col(k)[0]!);
    expect(Math.max(...firsts) - Math.min(...firsts)).toBeLessThanOrEqual(5);
    // X recomputed (2026-11-16) with the lesson's formula (average + √(ln t / n), no c): four options truly averaging 0.7,
    // 0.6, 0.5 and 0.3, scores spread with sd 0.25 and kept between 0 and 1, 20 seeded runs of 100,000 rounds. The mean
    // count in each period is within a third of X's, and the counts stay level (picks grow like ln t). V21's earlier X
    // (52, 55, 45) came from c = √2, which the lesson no longer has.
    const means = [0.7, 0.6, 0.5, 0.3];
    const periods = [[1, 1000], [1001, 10000], [10001, 100000]] as const;
    const runs = Array.from({ length: 20 }, (_, s) => picksOf("ucb", means, 100_000, s + 1, 3));
    const per = periods.map(([lo, hi]) => mean(runs.map((p) => p.filter((t) => t >= lo && t <= hi).length)));
    per.forEach((m, i) => expect(Math.abs(m - col(UCB)[i]!) / col(UCB)[i]!, `Y in period ${i + 1}: ${m}`).toBeLessThan(1 / 3));
    expect(Math.max(...per) / Math.min(...per)).toBeLessThan(1.6);
    for (const p of runs) expect(p.some((t) => t > 10_000)).toBe(true); // UCB never stops (W isn't UCB)
    // greedy (Z): the worst option only on its trial in most runs, and never after round 1,000 (X isn't greedy: it can't
    // keep coming back at a steady share, since each pick pulls the worst option's average down to its true one)
    const greedy = Array.from({ length: 40 }, (_, s) => picksOf("greedy", means, 10_000, s + 1, 3));
    expect(greedy.filter((p) => p.length === 1).length).toBeGreaterThanOrEqual(30);
    for (const p of greedy) expect(p.some((t) => t > 1000)).toBe(false);
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
    // T10 and V20: ratings × 100 with the same c: the bonus is tiny next to the gaps, so UCB picks like greedy
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
    const practice = /food truck|restaurant|slot machine|festival|exercise type|cake|audio tour|page layout|thumbnail|ice-cream|flavour|radio|playlist|jazz/i;
    for (const x of test) expect(`${x.prompt} ${x.options!.join(" ")}`, x.id).not.toMatch(practice);
  });

  it("pass the pack check, which catches an anchor that differs from its twin", () => {
    expect(checkPack("bandits").filter((i) => i.level === "error")).toEqual([]);
    const root = mkdtempSync(join(tmpdir(), "docendo-post-"));
    const dir = join(root, "topics", "anchor");
    mkdirSync(dir, { recursive: true });
    for (const f of readdirSync("topics/bandits").filter((f) => f.endsWith(".json"))) cpSync(join("topics/bandits", f), join(dir, f));
    const changed = JSON.parse(readFileSync("topics/bandits/exercises.json", "utf8"));
    changed.items.find((x: { id: string }) => x.id === "t07").same = "t01"; // marked an anchor, but a question of its own
    writeFileSync(join(dir, "exercises.json"), JSON.stringify(changed));
    const errors = checkPack("anchor", root).filter((i) => i.level === "error").map((i) => i.msg);
    expect(errors.some((m) => m.includes("t07") && m.includes("identical"))).toBe(true);
  });
});

describe("which items a session answers", () => {
  it("one form: its items", () => {
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
    expect([one.score, one.of, one.perForm.A]).toEqual([7, 7, { score: 7, of: 7 }]);
    const ids = sessionItems(test, "A", true).map((x) => x.id);
    const answers: unknown[] = keys(ids);
    answers[ids.indexOf("v14")] = 1;
    answers[ids.indexOf("t07")] = DONT_KNOW;
    const both = gradeTest(test, "A", true, answers);
    expect([both.score, both.of]).toEqual([8, 10]);
    expect(both.perForm).toEqual({ A: { score: 6, of: 7 }, B: { score: 2, of: 3 } });
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
    expect(new Set(o.slice(0, forms.A.length))).toEqual(new Set(forms.A.map((x) => x.id)));
    expect(new Set(o.slice(forms.A.length))).toEqual(new Set(forms.B.map((x) => x.id)));
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
      ["Part 1 of 2", 0, 0, 7],
      ["Part 2 of 2", 1, 7, 3],
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
