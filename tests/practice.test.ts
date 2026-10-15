import { describe, expect, it } from "vitest";
import bundleJson from "../topics/bandits/bundle.json";
import practiceJson from "../topics/bandits/practice.json";
import exercisesJson from "../topics/bandits/exercises.json";
import { checkNumber } from "../content/practice";
import { seedOf, testOrder } from "../lib/order";
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
  type T = { id: string; kind?: string; prompt: string; options?: string[]; answer: number; tolerance?: number };
  const test = exercisesJson.items as T[];
  const q = (id: string) => test.find((x) => x.id === id)!;
  const key = (id: string) => q(id).options![q(id).answer]!;
  const ucb = (avg: number, lnT: number, n: number) => avg + Math.sqrt((2 * lnT) / n);

  it("have keys that match their own numbers", () => {
    // q01: four students averaging 12 minutes, then 22
    expect(q("q01").answer).toBeCloseTo((4 * 12 + 22) / 5);
    // q02: days 1-3 A 4, B 7, C 6; day 4 greedy takes B (7) and gets 3; day 5 takes C (6) and gets 5
    const avg = { A: 4, B: (7 + 3) / 2, C: (6 + 5) / 2 };
    expect(argmax([avg.A, avg.B, avg.C])).toBe(2);
    expect(key("q02")).toMatch(/^C: its average, 5\.5/);
    // q03: B's average stays between 3 and 4, always above A's single 2: A gets none
    expect(q("q03").answer).toBe(0);
    // q04: greedy takes the highest average, B's 8.0
    expect(argmax([7.9, 8.0, 6.0])).toBe(1);
    expect(key("q04")).toMatch(/^B/);
    // q05: 1,000 visitors × ε 0.2 ÷ 4 banners
    expect(q("q05").answer).toBeCloseTo((1000 * 0.2) / 4);
    // q08: 0.60 + √(2 × 3.91 / 8)
    expect(Math.abs(q("q08").answer - ucb(0.6, 3.91, 8))).toBeLessThanOrEqual(q("q08").tolerance!);
    expect(Math.abs(q("q08").answer - ucb(0.6, Math.log(50), 8))).toBeLessThanOrEqual(q("q08").tolerance!);
    // q09: ln 20 ≈ 3.0; A 7.0 over 10, B 6.0 over 2, C 6.6 over 8: A wins by a little, with the rounded or the exact ln
    for (const lnT of [3.0, Math.log(20)]) expect(argmax([ucb(7, lnT, 10), ucb(6, lnT, 2), ucb(6.6, lnT, 8)])).toBe(0);
    expect(key("q09")).toMatch(/^A: its average plus its bonus, about 7\.77/);
    // q10: ln t ≈ 4.6; A 4.0 over 50, C 3.0 over 4 → C; C gets 3 (average unchanged) over 5 → A
    expect(ucb(3, 4.6, 4)).toBeGreaterThan(ucb(4, 4.6, 50));
    expect(ucb(3, 4.6, 5)).toBeLessThan(ucb(4, 4.6, 50));
    expect(key("q10")).toMatch(/^A: one more play shrinks/);
  });

  it("grade typed numbers with their tolerance", () => {
    expect(checkNumber("14", 14, 0.05)).toBe(true);
    expect(checkNumber("14.0 ", 14, 0.05)).toBe(true);
    expect(checkNumber("13", 14, 0.05)).toBe(false);
    expect(checkNumber("0", 0, 0)).toBe(true);
    expect(checkNumber("1,59", 1.589, 0.02)).toBe(true);
    expect(checkNumber("1.55", 1.589, 0.02)).toBe(false);
    expect(checkNumber("about 50", 50, 1)).toBe(false); // words aren't a number
  });

  it("mix choice and number items, and number items have no options", () => {
    const numbers = test.filter((x) => x.kind === "number");
    expect(numbers.length).toBeGreaterThanOrEqual(3);
    for (const x of numbers) expect(x.options, x.id).toBeUndefined();
  });

  it("use settings of their own, never the lesson's or practice's", () => {
    for (const x of test) expect(x.prompt, x.id).not.toMatch(/restaurant|food truck|slot machine|headline/i);
  });

  it("don't give the key away by its length", () => {
    // test-wise learners pick the longest, most careful option: the key must not stand out
    for (const x of test.filter((t) => t.options)) {
      const others = x.options!.filter((_, k) => k !== x.answer).map((o) => o.length);
      expect(x.options![x.answer]!.length, x.id).toBeLessThanOrEqual(Math.max(...others) * 1.1);
    }
  });

  it("spread their keys over the positions", () => {
    const counts = [0, 0, 0, 0];
    for (const x of test.filter((t) => t.options)) counts[x.answer]!++;
    expect(Math.max(...counts)).toBeLessThanOrEqual(2);
    expect(counts.filter((c) => c > 0).length).toBe(4);
  });
});

describe("final test order", () => {
  const items = exercisesJson.items as { id: string; kind?: string }[];
  const withKind = items.map((q) => ({ id: q.id, kind: q.kind ?? "choice" }));
  it("puts the choice items first, then the number items, each part shuffled per learner and stable", () => {
    const a = testOrder(withKind, seedOf("token-a"));
    expect([...a].sort()).toEqual(items.map((q) => q.id).sort());
    const kinds = a.map((id) => withKind.find((q) => q.id === id)!.kind);
    expect(kinds.lastIndexOf("choice")).toBeLessThan(kinds.indexOf("number"));
    expect(testOrder(withKind, seedOf("token-a"))).toEqual(a); // a reload shows the same order
    const orders = new Set(["a", "b", "c", "d", "e", "f"].map((t) => testOrder(withKind, seedOf(`token-${t}`)).join()));
    expect(orders.size).toBeGreaterThan(3); // learners get different orders
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
    // overlapping quotes from one message are one note, the longest, in the place of the first
    const overlap = {
      ...taught,
      notebook: [
        { fact: "n01.f1", verdict: "correct" as const, words: "You choose one of several options.", turn: 1 },
        { fact: "n01.f2", verdict: "correct" as const, words: "You choose one of several options. Each gives a random reward.", turn: 1 },
        { fact: "n03.f1", verdict: "correct" as const, words: "The estimate is the average", turn: 2 },
        { fact: "n05.f1", verdict: "correct" as const, words: "the estimate is the average!", turn: 3 },
      ],
    };
    expect(notesOf(overlap)).toEqual(["You choose one of several options. Each gives a random reward.", "The estimate is the average"]);
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
    expect(gate(p3, base)).toMatchObject({ needs: ["n11.f1|n11.f2"], missing: ["n11.f1|n11.f2"], canBeRight: false });
    // either fact carries the rule: "adds a bonus to each average and picks the highest total" is credited as n11.f1
    expect(gate(p3, { ...base, notebook: [{ fact: "n11.f1", verdict: "correct" as const, words: "adds a bonus and picks the highest", turn: 1 }] }).canBeRight).toBe(true);
    expect(gate(p3, ucb).canBeRight).toBe(true);
    expect(gate(p3, { ...ucb, notebook: [{ ...ucb.notebook[0]!, verdict: "partial" as const }] }).canBeRight).toBe(false); // vague isn't enough
    expect(gate(p3, { ...ucb, misconceptions: [{ node: "n11", words: "UCB picks at random", turn: 2 }] }).canBeRight).toBe(false);
    for (const p of practice.items)
      for (const n of p.needs ?? []) {
        for (const f of n.split("|")) expect(factIds.has(f), `${p.id} needs ${f}`).toBe(true);
        expect(p.steps.some((s) => n.split("|").some((f) => s.facts.includes(f))), `${p.id}: a step uses ${n}`).toBe(true);
      }
  });

  it("replaces a model's right answer without the facts by a wrong guess", async () => {
    const lucky = async (): Promise<Solution> => ({ steps: [{ text: "I add the bonus.", notes: [] }], answer: "B", correct: true, notes: [], leaked: [], by: "model", gate: gate(p3, base), guess: null });
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

describe("Kai's guesses (beliefs) when a needed fact is missing", () => {
  const base = initialState(bundle);

  it("are wrong, stand in for a needed fact, and cover every needed fact of every problem", () => {
    for (const p of practice.items) {
      const bs = p.beliefs ?? [];
      expect(bs.length, p.id).toBeGreaterThan(0);
      for (const b of bs) {
        expect((p.needs ?? []).some((n) => n.split("|").includes(b.replaces)), `${p.id}: ${b.belief}`).toBe(true);
        expect(checkPractice(p, p.kind === "choice" ? b.answer : String(b.answer)), `${p.id}: ${b.belief}`).toBe(false);
      }
      for (const n of p.needs ?? []) expect(bs.some((b) => n.split("|").includes(b.replaces)), `${p.id} has a guess for ${n}`).toBe(true);
    }
  });

  it("make the offline attempt reason from the guess to the guess's answer", () => {
    for (const p of practice.items) {
      const s = offlineSolve(bundle, p, base);
      expect(s.guess, p.id).not.toBeNull();
      expect(s.steps.some((x) => x.text.includes(s.guess!.belief)), p.id).toBe(true);
      expect(s.answer, p.id).toBe(p.kind === "choice" ? "ABCDEF"[s.guess!.answer] : String(s.guess!.answer));
      expect(s.correct, p.id).toBe(false);
    }
  });

  it("pick a guess for the fact that is actually missing", async () => {
    const { chooseGuess } = await import("../engine/tutor/solve");
    const p1 = item("p1");
    const knowsF1 = { ...base, notebook: [{ fact: "n05.f1", verdict: "correct" as const, words: "greedy picks the best average", turn: 1 }] };
    for (let i = 0; i < 10; i++) expect(chooseGuess(p1, gate(p1, knowsF1), `seed${i}`)!.replaces).toBe("n05.f2");
  });
});

import { summarize, tables, type Ev } from "../lib/analytics";

describe("the admin dashboard's numbers", () => {
  const at = (min: number) => new Date(Date.UTC(2026, 9, 14, 10, min)).toISOString();
  const ev = (sid: string, t: string, min: number, extra: Record<string, unknown> = {}): Ev => ({ t, sid, at: at(min), ...extra });
  const events: Ev[] = [
    // a direct participant who finished
    ev("a", "session_start", 0, { entry: "participant", condition: "direct", pid: "P1" }),
    ev("a", "client_page_view", 1, { path: "/pretest" }),
    ev("a", "client_page_view", 3, { path: "/watch" }),
    ev("a", "client_page_view", 12, { path: "/teach" }),
    ev("a", "client_page_view", 22, { path: "/practice" }),
    ev("a", "practice_check", 23, { id: "p1", round: 1, attempt: 1, correct: false }),
    ev("a", "practice_check", 24, { id: "p1", round: 1, attempt: 2, correct: true }),
    ev("a", "client_page_view", 32, { path: "/exercises" }),
    ev("a", "grade", 40, { score: 6, of: 10, items: [{ id: "q01", chosen: 1, answer: 1, correct: true }] }),
    // a recursive participant who stopped in practice
    ev("b", "session_start", 0, { entry: "participant", condition: "recursive", pid: "P2" }),
    ev("b", "client_page_view", 1, { path: "/pretest" }),
    ev("b", "client_page_view", 3, { path: "/watch" }),
    ev("b", "client_page_view", 12, { path: "/teach" }),
    ev("b", "client_page_view", 22, { path: "/practice" }),
    ev("b", "practice_kai_solve", 23, { id: "p1", round: 1, attempt: 1, correct: false }),
    ev("b", "practice_kai_reteach", 24, { id: "p1", round: 1, attempt: 2, correct: true, message: "random among all" }),
    // a team test session: left out unless all is asked for
    ev("c", "session_start", 0, { entry: "team", condition: "direct" }),
  ];
  const t = tables(events);

  it("count participants only, by condition, and how far they got", () => {
    const s = summarize(t);
    expect(s.sessions).toBe(2);
    expect(s.byCondition).toEqual({ direct: 1, recursive: 1 });
    expect(s.finished).toBe(1);
    expect(s.funnel.find((f) => f.step === "practice")!.n).toBe(2);
    expect(s.funnel.find((f) => f.step === "results")!.n).toBe(1);
    expect(summarize(t, { all: true }).sessions).toBe(3);
  });

  it("measure practice difficulty per condition", () => {
    const p1 = summarize(t).practice.find((p) => p.id === "p1")!;
    expect(p1.direct).toMatchObject({ tried: 1, firstTry: 0, solved: 100 });
    expect(p1.recursive).toMatchObject({ tried: 1, kaiFirst: 0, kaiAfter: 100, reteaches: 1 });
  });

  it("give time per chapter and the test by condition", () => {
    const s = summarize(t);
    expect(s.minutes.find((m) => m.chapter === "Teach")!.direct).toBe(10);
    expect(s.test.find((q) => q.id === "q01")).toMatchObject({ n: 1, all: 100, direct: 100 });
    // answers to another version of the test are left out of the per-item numbers, and counted
    const other = summarize(t, { testVersion: "deadbeef" });
    expect(other.test).toHaveLength(0);
    expect(other.testOtherVersions).toBe(1);
    expect(s.testMean.direct).toBe(6);
  });
});

import { csvCell } from "../lib/analytics";

describe("exports", () => {
  it("never let a learner's text run as a spreadsheet formula", () => {
    expect(csvCell('=HYPERLINK("http://x","click")')).toBe(`"'=HYPERLINK(""http://x"",""click"")"`);
    expect(csvCell("+1+1")).toBe("'+1+1");
    expect(csvCell("@SUM(A1)")).toBe("'@SUM(A1)");
    expect(csvCell(-3)).toBe("-3");
    expect(csvCell("-0.5")).toBe("-0.5");
    expect(csvCell("greedy picks the best")).toBe("greedy picks the best");
  });
});

describe("the offline attempt with a misconception", () => {
  it("answers what the misconception leads to", () => {
    const st = { ...initialState(bundle), turn: 2, notebook: [{ fact: "n07.f1", verdict: "correct" as const, words: "epsilon greedy sometimes explores at random", turn: 1 }], misconceptions: [{ node: "n07", words: "when it explores it goes to the restaurant it has visited the least", turn: 2 }] };
    const s = offlineSolve(bundle, item("p2"), st);
    expect(s.steps[0]!.text).toContain("visited the least");
    expect(s.answer).toBe("B"); // "Only at C, the truck you have tried least"
  });
});
