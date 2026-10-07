import { describe, expect, it } from "vitest";
import bundleJson from "../topics/bandits/bundle.json";
import { Bundle } from "../content/schema";
import { initialState, latest, State } from "../engine/tutor/state";
import { mockJudge, checkQuotes, type Judgement } from "../engine/tutor/judge";
import { mockWrite, type Turn } from "../engine/tutor/writer";
import { forbiddenTerms } from "../engine/tutor/admit";
import { takeTurn, opening, type Deps } from "../engine/tutor/turn";
import { nextMove, CONFIG } from "../engine/tutor/policy";

const bundle = Bundle.parse(bundleJson);
const mock: Deps = {
  judge: async (b, m) => mockJudge(b, m),
  write: async (b, s, move, _h, mood) => mockWrite(b, s, move, mood === "neutral" ? "neutral" : mood),
};
const node = (id: string) => bundle.nodes.find((n) => n.id === id)!;

describe("tutor engine", () => {
  it("opens on the first core node", () => {
    const s = initialState(bundle);
    expect(s.focus).toBe("n01");
    expect(opening(bundle, s)).toContain(node("n01").probes.open);
  });

  it("drops judge verdicts whose quote is not in the message", () => {
    const facts: Judgement["facts"] = [
      { fact: "n09.f1", verdict: "correct", quote: "regret is the difference" },
      { fact: "n09.f2", verdict: "correct", quote: "something the learner never wrote" },
      { fact: "zz.f1", verdict: "correct", quote: "regret" },
    ];
    expect(checkQuotes(bundle, "So regret is the difference between best and ours.", facts).map((f) => f.fact)).toEqual(["n09.f1"]);
  });

  it("asks a follow-up when an answer doesn't explain the idea, then moves on after two", async () => {
    let s = initialState(bundle);
    const history: Turn[] = [{ role: "kai", text: opening(bundle, s) }];
    const types: string[] = [];
    for (let i = 0; i < 3; i++) {
      const r = await takeTurn(bundle, { message: "hmm it's kind of about choices I guess", history, state: s }, mock);
      types.push(r.trace.move.type);
      s = r.state;
    }
    expect(types).toEqual(["followUp", "followUp", "open"]);
    expect(s.focus).not.toBe("n01");
  });

  it("keeps the learner's wrong facts and asks the contradiction question once", async () => {
    const s = initialState(bundle);
    const j: Judgement = { intent: "explain", facts: [{ fact: "n05.f1", verdict: "wrong", quote: "greedy is always optimal" }], termsUsed: [] };
    const move = nextMove(bundle, { ...s, notebook: [{ fact: "n05.f1", verdict: "wrong", words: "greedy is always optimal", turn: 1 }] }, j, 4);
    expect(move.type).toBe("contradict");
    expect(move.seed).toBe(bundle.questions.contradictions.find((c) => c.misconception === "m_greedy_optimal")!.question);
  });

  it("blocks lesson terms the learner hasn't taught or used", () => {
    const s = initialState(bundle);
    expect(forbiddenTerms(bundle, s, "So that's why we measure regret!")).toEqual(["regret"]);
    const taught: State = { ...s, notebook: [{ fact: "n09.f1", verdict: "correct", words: "x", turn: 1 }] };
    expect(forbiddenTerms(bundle, taught, "So that's why we measure regret!")).toEqual([]);
    expect(forbiddenTerms(bundle, { ...s, usedTerms: ["regret"] }, "regret again")).toEqual([]);
  });

  it("falls back to a safe line when Kai's draft keeps leaking", async () => {
    const leaky: Deps = { ...mock, write: async () => "Is that the upper confidence bound thing?" };
    const r = await takeTurn(bundle, { message: "you pick between restaurants", history: [], state: initialState(bundle) }, leaky);
    expect(r.trace.fallback).toBe(true);
    expect(forbiddenTerms(bundle, r.state, r.reply)).toEqual([]);
  });

  it("finishes once a learner explains enough, and never crashes on the way", async () => {
    let s = initialState(bundle);
    const history: Turn[] = [{ role: "kai", text: opening(bundle, s) }];
    let done = false;
    let turns = 0;
    let lastProgress = 0;
    while (!done && turns < CONFIG.maxTurns + 2) {
      // a good teacher: explain whatever Kai is focused on, in the lesson's own words
      const f = s.focus ? node(s.focus) : bundle.nodes[0]!;
      const message = f.facts.filter((x) => x.teachable).map((x) => x.text).join(" ") || "I'm not sure about that one.";
      const r = await takeTurn(bundle, { message, history, state: s }, mock);
      expect(State.safeParse(r.state).success).toBe(true);
      expect(r.progress).toBeGreaterThanOrEqual(lastProgress);
      expect(forbiddenTerms(bundle, r.state, r.reply)).toEqual([]);
      history.push({ role: "learner", text: message }, { role: "kai", text: r.reply });
      lastProgress = r.progress;
      s = r.state;
      done = r.done;
      turns++;
    }
    expect(done).toBe(true);
    expect(turns).toBeLessThan(CONFIG.maxTurns);
    expect(latest(s).size).toBeGreaterThan(15);
  });

  it("offers help only after an attempt on the current idea", async () => {
    const s = initialState(bundle);
    const r = await takeTurn(bundle, { message: "not sure", history: [], state: s }, mock);
    expect(r.trace.move.type).toBe("followUp");
    expect(r.help).not.toBeNull();
    expect(r.helpAvailable).toBe(true);
  });
});

import { factScore } from "../engine/tutor/state";
import { mindView } from "../engine/tutor/mind";
import { applyJudgement, moodFor } from "../engine/tutor/turn";

describe("understanding, moods and Kai's mind", () => {
  const s0 = initialState(bundle);
  const j = (facts: Judgement["facts"], intent: Judgement["intent"] = "explain"): Judgement => ({ intent, facts, termsUsed: [] });
  const open = { type: "open" as const, node: "n03", seed: "?" };

  it("counts partial facts as half", () => {
    const s = applyJudgement(s0, j([{ fact: "n01.f1", verdict: "correct", quote: "a" }, { fact: "n01.f2", verdict: "partial", quote: "b" }]));
    const sc = factScore(bundle, s);
    expect(sc.correct).toBe(1);
    expect(sc.partial).toBe(1);
    expect(sc.score).toBeCloseTo(1.5 / sc.total);
  });

  it("never downgrades a correct fact to partial, but a wrong one replaces it", () => {
    let s = applyJudgement(s0, j([{ fact: "n01.f1", verdict: "correct", quote: "a" }]));
    s = applyJudgement(s, j([{ fact: "n01.f1", verdict: "partial", quote: "b" }]));
    expect(latest(s).get("n01.f1")?.verdict).toBe("correct");
    s = applyJudgement(s, j([{ fact: "n01.f1", verdict: "wrong", quote: "c" }]));
    expect(latest(s).get("n01.f1")?.verdict).toBe("wrong");
  });

  it("feels great, okay or confused depending on the answer", () => {
    const two = j([{ fact: "n09.f1", verdict: "correct", quote: "a" }, { fact: "n09.f2", verdict: "correct", quote: "b" }]);
    expect(moodFor(bundle, s0, applyJudgement(s0, two), two, open)).toBe("great");
    const one = j([{ fact: "n09.f1", verdict: "correct", quote: "a" }]);
    expect(moodFor(bundle, s0, applyJudgement(s0, one), one, open)).toBe("okay");
    const none = j([]);
    expect(moodFor(bundle, s0, applyJudgement(s0, none), none, open)).toBe("confused");
    const known = applyJudgement(s0, one);
    expect(moodFor(bundle, known, applyJudgement(known, one), one, open)).toBe("okay"); // repeats a known fact
    const wrong = j([{ fact: "n05.f1", verdict: "wrong", quote: "a" }]);
    expect(moodFor(bundle, s0, applyJudgement(s0, wrong), wrong, open)).toBe("confused");
    expect(moodFor(bundle, s0, s0, j([], "ask_kai"), open)).toBe("neutral");
  });

  it("describes Kai's mind without any fact text", () => {
    const m = mindView(bundle, applyJudgement(s0, j([{ fact: "n01.f1", verdict: "correct", quote: "a" }])));
    expect(m.facts.total).toBe(20);
    expect(m.facts.needed).toBe(16);
    expect(m.maxTurns).toBe(30);
    expect(m.nodes.find((n) => n.id === "n01")).toMatchObject({ status: "mentioned", correct: 1, focus: true });
    expect(m.nodes.find((n) => n.id === "n04")?.status).toBe("off"); // not in the videos
    const text = JSON.stringify(m);
    for (const n of bundle.nodes) for (const f of n.facts) expect(text.includes(f.text)).toBe(false);
  });
});
