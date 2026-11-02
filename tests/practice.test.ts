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

  it("accept the key and reject every other option", () => {
    for (const p of practice.items)
      p.options!.forEach((_, k) => expect(checkPractice(p, k), `${p.id} option ${k}`).toBe(k === p.answer));
  });

  // verify-items: every number behind a key is recomputed here, so a typo in the content fails the build
  it("have keys that match their own numbers", () => {
    // p1: ε = 0.2, four stages, A the favourite: 800 by exploiting, 200 random picks of which a quarter land on each stage
    expect(1000 * (0.8 + 0.2 / 4)).toBeCloseTo(850);
    expect(item("p1").options![item("p1").answer]).toMatch(/^About 850 to A; B and C about equally/);
    // p2: the stem's scores (average plus bonus) make UCB pick Dialogues
    expect(argmax([6.3 + 1.0, 5.0 + 2.5, 4.0 + 1.5])).toBe(1);
    // p4: B wins in the same round whatever the bonus scale c and the round t (bonus c √(ln t / n))
    const score = (avg: number, n: number, c: number, t: number) => avg + c * Math.sqrt(Math.log(t) / n);
    for (const c of [0.01, 0.1, 0.5, 1, 3]) for (const t of [110, 1000, 1e6]) expect(argmax([score(6.0, 50, c, t), score(6.4, 10, c, t), score(5.0, 10, c, t), score(6.4, 40, c, t)])).toBe(1);
    // p5: UCB picks A or B depending on c, never C or D
    const p5 = (c: number) => argmax([score(0.12, 2000, c, 6530), score(0.11, 30, c, 6530), score(0.02, 2000, c, 6530), score(0.1, 2500, c, 6530)]);
    const winners = new Set([0.001, 0.01, 0.02, 0.05, 0.1, 0.5, 2].map(p5));
    expect([...winners].sort()).toEqual([0, 1]);
  });

  it("come in two rounds that practise the same ideas", () => {
    const r1 = practice.items.filter((p) => p.round === 1).map((p) => p.idea);
    const r2 = practice.items.filter((p) => p.round === 2).map((p) => p.idea);
    expect(r1).toHaveLength(3);
    expect([...r2].sort()).toEqual([...r1].sort());
  });

  it("only use ideas the lesson teaches, and don't put every answer in the same place", () => {
    // the bundle holds only the lesson's nodes, so every cited fact must be in it (checked above);
    // here: choice answers are spread over the options
    const positions = practice.items.filter((p) => p.kind === "choice").map((p) => p.answer);
    expect(new Set(positions).size).toBeGreaterThan(2);
  });

  it("need only teachable facts, listed in the order the steps use them", () => {
    const teachable = new Set(bundle.nodes.flatMap((n) => n.facts.filter((f) => f.required && f.teachable && f.assume).map((f) => f.id)));
    for (const p of practice.items) {
      const needs = p.needs ?? [];
      for (const n of needs) expect(teachable.has(n), `${p.id} needs ${n}, which needs an assumption and must be taught`).toBe(true);
      const firstUse = (n: string) => p.steps.findIndex((s) => s.facts.includes(n));
      for (const n of needs) expect(firstUse(n), `${p.id}: a step uses ${n}`).toBeGreaterThanOrEqual(0);
      expect(needs.map(firstUse), `${p.id}: needs in step order`).toEqual([...needs.map(firstUse)].sort((a, b) => a - b));
    }
  });
});

describe("final test items", () => {
  type T = { id: string; form?: string; pair?: string; section: string; kind?: string; prompt: string; options?: string[]; answer: number; tolerance?: number };
  const test = exercisesJson.items as T[];
  const forms = { A: test.filter((x) => (x.form ?? "A") === "A"), B: test.filter((x) => x.form === "B") };
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

  it("form B's keys match their own numbers too", () => {
    expect(q("r01").answer).toBeCloseTo((5 * 18 + 30) / 6);
    // r02: vanilla 5, mango 8, pistachio 7; day 4 mango (8) gets 4; day 5 pistachio (7) gets 6
    expect(argmax([5, (8 + 4) / 2, (7 + 6) / 2])).toBe(2);
    expect(key("r02")).toMatch(/^Pistachio: its average, 6\.5/);
    expect(q("r03").answer).toBe(0);
    expect(argmax([8.4, 8.5, 7.0])).toBe(1);
    expect(key("r04")).toMatch(/^B/);
    expect(q("r05").answer).toBeCloseTo((2000 * 0.15) / 5);
    expect(Math.abs(q("r08").answer - ucb(3.2, 3.4, 5))).toBeLessThanOrEqual(q("r08").tolerance!);
    expect(Math.abs(q("r08").answer - ucb(3.2, Math.log(30), 5))).toBeLessThanOrEqual(q("r08").tolerance!);
    for (const lnT of [3.2, Math.log(25)]) expect(argmax([ucb(8, lnT, 16), ucb(6.8, lnT, 2), ucb(7.6, lnT, 8)])).toBe(0);
    expect(key("r09")).toMatch(/^Vanilla: its average plus its bonus, about 8\.63/);
    expect(ucb(7, 5, 4)).toBeGreaterThan(ucb(8, 5, 40));
    expect(ucb(7, 5, 5)).toBeLessThan(ucb(8, 5, 40));
    expect(key("r10")).toMatch(/^A: one more reader shrinks/);
  });

  it("come in two parallel forms: each B item is the twin of an A item (same idea and kind), ten each", () => {
    expect(forms.A).toHaveLength(10);
    expect(forms.B).toHaveLength(10);
    const twins = new Set<string>();
    for (const b of forms.B) {
      const a = forms.A.find((x) => x.id === b.pair);
      expect(a, b.id).toBeDefined();
      expect(b.kind ?? "choice", b.id).toBe(a!.kind ?? "choice");
      expect(b.section, b.id).toBe(a!.section);
      expect(b.options?.length ?? 0, b.id).toBe(a!.options?.length ?? 0);
      twins.add(b.pair!);
    }
    expect(twins.size).toBe(10); // every A item has exactly one twin
    // no prompt is shared between the forms, so nobody meets a question twice
    for (const b of forms.B) expect(forms.A.some((a) => a.prompt === b.prompt), b.id).toBe(false);
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
    for (const f of [forms.A, forms.B]) expect(f.filter((x) => x.kind === "number").length).toBeGreaterThanOrEqual(3);
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

  it("spread their keys over the positions, in each form", () => {
    for (const f of [forms.A, forms.B]) {
      const counts = [0, 0, 0, 0];
      for (const x of f.filter((t) => t.options)) counts[x.answer]!++;
      expect(Math.max(...counts)).toBeLessThanOrEqual(2);
      expect(counts.filter((c) => c > 0).length).toBe(4);
    }
  });
});

describe("final test order", () => {
  const items = (exercisesJson.items as { id: string; kind?: string; form?: string }[]).filter((q) => (q.form ?? "A") === "A");
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

import { initialState, type State } from "../engine/tutor/state";
import { beliefFor, chooseGuess, gate, isRight, notesOf, offlineSolve, solve, type Solution } from "../engine/tutor/solve";

// a notebook in which every fact listed is explained (correct) or only vaguely (partial); the learner's words name the fact
const taughtState = (facts: string[], vague: string[] = []): State => ({
  ...initialState(bundle),
  turn: facts.length,
  notebook: facts.map((fact, i) => ({ fact, verdict: vague.includes(fact) ? ("partial" as const) : ("correct" as const), words: `note about ${fact}`, turn: i + 1 })),
});
const LETTERS = "ABCDEF";
const factOf = (id: string) => bundle.nodes.flatMap((n) => n.facts).find((f) => f.id === id)!;

describe("the knowledge base: facts Kai can be taught, and its assumptions", () => {
  const lesson = bundle.nodes.filter((n) => n.inLesson !== false);
  const needed = new Set(practice.items.flatMap((p) => p.needs ?? []));

  it("gives every fact a practice problem needs one assumption, and never needs a given fact", () => {
    for (const id of needed) expect(factOf(id).assume, `${id} has Kai's assumption`).toBeTruthy();
    // given facts: the setup, averages and how reliable they are, trying each option once
    for (const id of ["n01.f1", "n01.f2", "n03.f1", "n03.f3", "n16.f1"]) expect(needed.has(id), `${id} is given`).toBe(false);
    // the teachable facts of the lesson: greedy, lock-in, ε-greedy (2), UCB's score and c, the bonus's two rules
    const withAssumption = lesson.flatMap((n) => n.facts.filter((f) => f.assume).map((f) => f.id));
    expect(withAssumption).toEqual(["n05.f1", "n06.f1", "n07.f1", "n07.f2", "n11.f1", "n11.f2", "n12.f1", "n12.f2"]);
    for (const id of withAssumption) expect(factOf(id).required && factOf(id).teachable, id).toBe(true);
  });

  it("copies each fact's assumption into the problems word for word, one per fact", () => {
    for (const p of practice.items)
      for (const b of p.beliefs ?? []) {
        const f = factOf(b.replaces);
        expect(b.belief, `${p.id} ${b.replaces}`).toBe(b.when === "vague" ? f.assumeVague : f.assume);
      }
  });
});

describe("Kai solving practice problems (recursive feedback)", () => {
  const base = initialState(bundle);

  it("gets every problem right when the notebook holds every fact it needs, citing the notes", () => {
    for (const p of practice.items) {
      const s = offlineSolve(bundle, p, taughtState(p.needs ?? []));
      expect(s.correct, p.id).toBe(true);
      expect(s.guess, p.id).toBeNull();
      // a step that uses a taught fact cites its note
      p.steps.forEach((st, i) => {
        if (st.facts.some((f) => (p.needs ?? []).includes(f))) expect(s.steps[i]!.notes.length, `${p.id} step ${i + 1}`).toBeGreaterThan(0);
      });
    }
  });

  it("goes wrong where a needed fact is missing: at that fact's step, with its assumption, to the option the assumption predicts", () => {
    for (const p of practice.items)
      for (const n of p.needs ?? []) {
        const st = taughtState((p.needs ?? []).filter((x) => x !== n));
        const g = gate(p, st);
        expect(g.canBeRight, `${p.id} without ${n}`).toBe(false);
        const b = beliefFor(p, n, "absent")!;
        expect(b, `${p.id} has an assumption for ${n}`).toBeTruthy();
        expect(checkPractice(p, b.answer), `${p.id}: Kai's assumption for ${n} leads to a wrong option`).toBe(false);
        expect(chooseGuess(p, g, "any")).toEqual(b);
        const s = offlineSolve(bundle, p, st);
        expect(s.answer, `${p.id} without ${n}`).toBe(LETTERS[b.answer]);
        expect(s.correct).toBe(false);
        // the attempt follows the solution up to the first step that uses the missing fact, and says it is guessing there
        const at = p.steps.findIndex((x) => x.facts.includes(n));
        expect(s.steps[at]!.text, `${p.id} without ${n}`).toMatch(/didn't tell me/);
        expect(s.steps[at]!.text).toContain(b.belief);
        expect(s.steps.slice(0, at).map((x) => x.text)).toEqual(p.steps.slice(0, at).map((x) => x.text));
      }
  });

  it("with several facts missing, fails at the first one in the order the steps use them", () => {
    for (const p of practice.items) {
      const s = offlineSolve(bundle, p, base);
      const first = beliefFor(p, p.needs![0]!, "absent")!;
      expect(s.guess, p.id).toEqual(first);
      expect(s.answer, p.id).toBe(LETTERS[first.answer]);
    }
  });

  it("treats a vague explanation as missing, unless the problem's vague reading still leads to the key", () => {
    for (const p of practice.items)
      for (const n of p.needs ?? []) {
        const st = taughtState(p.needs ?? [], [n]);
        const b = beliefFor(p, n, "vague")!;
        const s = offlineSolve(bundle, p, st);
        if (b.when === "vague" && checkPractice(p, b.answer)) {
          expect(gate(p, st).canBeRight, `${p.id}: a vague ${n} is enough`).toBe(true);
          expect(s.correct).toBe(true);
        } else {
          expect(gate(p, st).canBeRight, `${p.id}: a vague ${n} isn't enough`).toBe(false);
          expect(s.answer).toBe(LETTERS[b.answer]);
          expect(s.steps.find((x) => x.text.includes(b.belief))!.text).toMatch(/vaguely/);
        }
      }
    // the bonus "grows" without "ever more slowly": enough to see that it grows (p2, p3), not to see the gaps grow (p6)
    expect(gate(item("p2"), taughtState(item("p2").needs!, ["n12.f2"])).canBeRight).toBe(true);
    expect(offlineSolve(bundle, item("p6"), taughtState(item("p6").needs!, ["n12.f2"])).answer).toBe("B");
    expect(offlineSolve(bundle, item("p6"), taughtState(item("p6").needs!.filter((n) => n !== "n12.f2"))).answer).toBe("D");
  });

  it("is not affected by a fact the problem doesn't list", () => {
    const lessonFacts = bundle.nodes.filter((n) => n.inLesson !== false).flatMap((n) => n.facts.filter((f) => f.required && f.teachable).map((f) => f.id));
    for (const p of practice.items) {
      const all = taughtState(lessonFacts);
      for (const other of lessonFacts.filter((f) => !(p.needs ?? []).includes(f)))
        expect(gate(p, { ...all, notebook: all.notebook.filter((e) => e.fact !== other) }).canBeRight, `${p.id} without ${other}`).toBe(true);
    }
  });

  it("fails the same way for the same notebook, whatever the seed", () => {
    const p = item("p6");
    const st = taughtState(["n07.f1"]);
    const guesses = new Set(Array.from({ length: 10 }, (_, i) => chooseGuess(p, gate(p, st), `seed${i}`)!.replaces));
    expect([...guesses]).toEqual(["n11.f1"]);
  });

  it("follows a stated misconception and points to the learner's words", () => {
    const p = item("p1");
    const st: State = { ...taughtState(["n07.f1"]), misconceptions: [{ node: "n07", words: "when it explores it picks one of the other stages, never the favourite", turn: 3 }] };
    const s = offlineSolve(bundle, p, st);
    expect(s.correct).toBe(false);
    const bad = s.steps.find((x) => x.text.includes("never the favourite"))!;
    expect(s.notes[bad.notes[0]! - 1]).toBe("when it explores it picks one of the other stages, never the favourite");
    expect(s.answer).toBe("A"); // what skipping the favourite predicts: about 800 to A
  });

  it("numbers the notes without lesson text, and reads Kai's answer as a letter", () => {
    const taught = taughtState(["n07.f1", "n07.f2"]);
    expect(notesOf(taught)).toEqual(taught.notebook.map((e) => e.words));
    // overlapping quotes from one message are one note, the longest, in the place of the first
    const overlap: State = {
      ...taught,
      notebook: [
        { fact: "n01.f1", verdict: "correct" as const, words: "You choose one of several options.", turn: 1 },
        { fact: "n01.f2", verdict: "correct" as const, words: "You choose one of several options. You only see what you picked.", turn: 1 },
        { fact: "n03.f1", verdict: "correct" as const, words: "The estimate is the average", turn: 2 },
        { fact: "n05.f1", verdict: "correct" as const, words: "the estimate is the average!", turn: 3 },
      ],
    };
    expect(notesOf(overlap)).toEqual(["You choose one of several options. You only see what you picked.", "The estimate is the average"]);
    const p1 = item("p1");
    expect(isRight(p1, "C")).toBe(true);
    expect(isRight(p1, "c) About 850 to A")).toBe(true);
    expect(isRight(p1, "A")).toBe(false);
    expect(isRight(p1, "I'm not sure")).toBe(false);
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

describe("the gate: Kai can't be right without the facts", () => {
  const base = initialState(bundle);
  const p4 = item("p4");
  const ucb = taughtState(["n11.f1", "n12.f1"]);

  it("opens only with every needed fact explained correctly and no misconception left about them", () => {
    expect(gate(p4, base)).toMatchObject({ needs: ["n11.f1", "n12.f1"], missing: ["n11.f1", "n12.f1"], absent: ["n11.f1", "n12.f1"], canBeRight: false });
    expect(gate(p4, ucb).canBeRight).toBe(true);
    expect(gate(p4, taughtState(["n11.f1", "n12.f1"], ["n11.f1"])).canBeRight).toBe(false); // vague isn't enough here
    expect(gate(p4, { ...ucb, misconceptions: [{ node: "n11", words: "UCB picks at random", turn: 3 }] }).canBeRight).toBe(false);
    for (const p of practice.items)
      for (const n of p.needs ?? []) {
        for (const f of n.split("|")) expect(factIds.has(f), `${p.id} needs ${f}`).toBe(true);
        expect(p.steps.some((s) => n.split("|").some((f) => s.facts.includes(f))), `${p.id}: a step uses ${n}`).toBe(true);
      }
  });

  it("replaces a model's right answer without the facts by the assumption's wrong one", async () => {
    const lucky = async (): Promise<Solution> => ({ steps: [{ text: "I add the bonus.", notes: [] }], answer: "B", correct: true, notes: [], leaked: [], by: "model", gate: gate(p4, base), guess: null });
    let why = "";
    const s = await solve(bundle, p4, base, { demo: false, model: lucky, onError: (e) => (why = String(e)) });
    expect(s.correct).toBe(false);
    expect(s.by).toBe("offline");
    expect(s.answer).toBe("C"); // UCB picks the least tried, whatever its average: B or C
    expect(why).toMatch(/without the facts/);
    // with the facts, the model's right answer stands
    const earned = async (): Promise<Solution> => ({ ...(await lucky()), gate: gate(p4, ucb) });
    expect((await solve(bundle, p4, ucb, { demo: false, model: earned })).correct).toBe(true);
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
    const other = summarize(t, { testVersions: ["deadbeef"] });
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

import { plausibleWords } from "../lib/voice";
import { joinParts } from "../lib/client/dictation";

describe("voice input", () => {
  it("joins live readings of neighbouring stretches", () => {
    expect(joinParts("The bonus is", "is bigger for options")).toBe("The bonus is bigger for options");
    expect(joinParts("So we go out.", "every night")).toBe("So we go out every night");
    expect(joinParts("I don't know.", "Greedy picks the best.")).toBe("I don't know. Greedy picks the best.");
    expect(joinParts("", "Hello")).toBe("Hello");
  });
  it("drops transcripts longer than the audio could hold", () => {
    expect(plausibleWords(3)).toBe(15);
    expect(20 > plausibleWords(3)).toBe(true); // a made-up explanation
    expect(12 > plausibleWords(3)).toBe(false); // fast real speech
  });
});

import { compare } from "../lib/analytics";

describe("the dashboard's comparison of the conditions", () => {
  it("gives the mean difference with a Welch interval and Cohen's d", () => {
    const r = compare([6, 7, 8, 7, 9, 6, 8], [5, 6, 5, 7, 4, 6, 5])!;
    expect(r.diff).toBeCloseTo(7.29 - 5.43, 1);
    expect(r.lo).toBeLessThan(r.diff);
    expect(r.hi).toBeGreaterThan(r.diff);
    // reference (Welch): se ≈ 0.559, df ≈ 11.8, t(0.975, 11.8) ≈ 2.18 → interval ≈ 1.86 ± 1.22
    expect(r.lo).toBeCloseTo(0.64, 1);
    expect(r.hi).toBeCloseTo(3.08, 1);
    expect(r.d).toBeGreaterThan(1.5);
  });
  it("needs at least two in each group", () => {
    expect(compare([5], [4, 6])).toBeNull();
  });
});
