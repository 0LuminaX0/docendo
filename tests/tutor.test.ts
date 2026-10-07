import { describe, expect, it } from "vitest";
import bundleJson from "../topics/bandits/bundle.json";
import { Bundle } from "../content/schema";
import { initialState, latest, State } from "../engine/tutor/state";
import { mockJudge, checkQuotes, findQuote, type Judgement } from "../engine/tutor/judge";
import { mockWrite, type Turn } from "../engine/tutor/writer";
import { forbiddenTerms } from "../engine/tutor/admit";
import { takeTurn, opening, type Deps } from "../engine/tutor/turn";
import { nextMove, CONFIG, type Move } from "../engine/tutor/policy";
import { applyJudgement } from "../engine/tutor/turn";

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

  // a judge that returns a fixed judgement, to drive the policy step by step
  const fixed = (...js: Judgement[]): Deps => {
    let i = 0;
    return { ...mock, judge: async () => js[Math.min(i++, js.length - 1)]! };
  };
  const say = (intent: Judgement["intent"], facts: Judgement["facts"] = []): Judgement => ({ intent, facts, termsUsed: [] });
  async function run(deps: Deps, n: number, state = initialState(bundle)) {
    const moves: Move[] = [];
    const replies: string[] = [];
    let s = state;
    for (let i = 0; i < n; i++) {
      const r = await takeTurn(bundle, { message: "a message", history: [], state: s }, deps);
      moves.push(r.trace.move);
      replies.push(r.reply);
      s = r.state;
    }
    return { moves, replies, state: s };
  }

  it("asks for one missing fact at a time with its question, then sets the idea aside", async () => {
    const { moves, replies, state } = await run(fixed(say("explain")), 3);
    expect(moves.map((m) => [m.type, m.fact ?? null])).toEqual([
      ["followUp", "n01.f1"],
      ["followUp", "n01.f2"],
      ["open", null],
    ]);
    expect(replies[0]).toContain(node("n01").facts[0]!.ask);
    expect(moves[2]!.closure).toBe("parked");
    expect(state.memo["n01"]?.parked).toBe(true);
    expect(state.focus).not.toBe("n01");
  });

  it("asks a fact's question a second time when the answer was partly right", async () => {
    const partial = say("explain", [{ fact: "n01.f1", verdict: "partial", quote: "x" }]);
    const { moves } = await run(fixed(partial, say("explain"), partial), 3);
    expect(moves.map((m) => m.fact)).toEqual(["n01.f1", "n01.f1", "n01.f2"]);
  });

  it("re-asks the same question after a reply that wasn't an answer, without using it up", async () => {
    const { moves, state } = await run(fixed(say("explain"), say("off_topic"), say("off_topic")), 3);
    expect(moves.map((m) => [m.fact, m.cue ?? null])).toEqual([
      ["n01.f1", null],
      ["n01.f1", "again"],
      ["n01.f1", "again"],
    ]);
    expect(state.memo["n01"]?.tries["n01.f1"]).toBe(1);
    expect(state.memo["n01"]?.attempts).toBe(1); // chit-chat doesn't count as having a go
  });

  it("moves to another question when the learner doesn't know", async () => {
    const partial = say("explain", [{ fact: "n01.f1", verdict: "partial", quote: "x" }]);
    const { moves } = await run(fixed(partial, say("unsure")), 2);
    expect(moves.map((m) => [m.fact, m.cue ?? null])).toEqual([
      ["n01.f1", null],
      ["n01.f2", "skip"],
    ]);
  });

  it("answers 'what's next?' once with the missing question, then moves on", async () => {
    const { moves } = await run(fixed(say("move_on")), 2);
    expect(moves.map((m) => [m.type, m.fact ?? null])).toEqual([
      ["nudge", "n01.f1"],
      ["open", null],
    ]);
    expect(moves[1]!.closure).toBe("parked");
  });

  it("answers a question from the learner and carries on with a question of its own", async () => {
    const { moves, replies } = await run(fixed(say("ask_kai")), 1);
    expect(moves[0]!.type).toBe("answer");
    expect(moves[0]!.then).toMatchObject({ type: "followUp", fact: "n01.f1" });
    expect(replies[0]!.trim().endsWith("?")).toBe(true);
  });

  it("says it got an idea once its last fact is explained", async () => {
    const both = say("explain", [
      { fact: "n01.f1", verdict: "correct", quote: "x" },
      { fact: "n01.f2", verdict: "correct", quote: "y" },
    ]);
    const { moves, replies } = await run(fixed(both), 1);
    expect(moves[0]!.closure).toBe("explained");
    expect(replies[0]).toMatch(/got that part/);
  });

  it("brings a set-aside idea back when one of its facts is explained", async () => {
    const { state } = await run(fixed(say("explain")), 3);
    expect(state.memo["n01"]?.parked).toBe(true);
    const back = applyJudgement(state, say("explain", [{ fact: "n01.f1", verdict: "correct", quote: "x" }]));
    expect(back.memo["n01"]?.parked).toBe(false);
  });

  it("accepts a slightly misquoted verdict but keeps the learner's exact words", () => {
    const msg = "Honestly, you only ever see the reward of the option that you picked, nothing else.";
    expect(findQuote(msg, "you only see the reward of the option you picked")).toBe("you only ever see the reward of the option that you picked");
    expect(findQuote(msg, "you see every reward of all options at once")).toBeNull();
    expect(findQuote(msg, "only see")).toBeNull(); // too short to be fuzzy
  });

  it("reads 'what's next' as moving on and gibberish as off topic in demo mode", () => {
    expect(mockJudge(bundle, "ok what's next?").intent).toBe("move_on");
    expect(mockJudge(bundle, "asdf qwer").intent).toBe("off_topic");
  });

  it("keeps the learner's wrong facts and asks the contradiction question once", async () => {
    const s = initialState(bundle);
    const j: Judgement = { intent: "explain", facts: [{ fact: "n05.f1", verdict: "wrong", quote: "greedy is always optimal" }], termsUsed: [] };
    const move = nextMove(bundle, { ...s, notebook: [{ fact: "n05.f1", verdict: "wrong", words: "greedy is always optimal", turn: 1 }] }, j);
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
import { applyMove, moodFor } from "../engine/tutor/turn";

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

  it("describes Kai's mind without any fact text or unasked questions", () => {
    let s = applyJudgement(s0, j([{ fact: "n01.f1", verdict: "correct", quote: "you choose between options" }]));
    s = applyMove(bundle, s, { type: "followUp", node: "n01", seed: node("n01").facts[1]!.ask!, fact: "n01.f2" });
    const m = mindView(bundle, s);
    expect(m.facts.total).toBe(20);
    expect(m.facts.needed).toBe(16);
    expect(m.maxTurns).toBe(30);
    const n01 = m.nodes.find((n) => n.id === "n01")!;
    expect(n01).toMatchObject({ status: "mentioned", correct: 1, focus: true, unasked: 0 });
    expect(n01.questions.map((q) => q.state)).toEqual(["answered", "current"]);
    expect(n01.asking).toBe(node("n01").facts[1]!.ask);
    expect(m.nodes.find((n) => n.id === "n03")).toMatchObject({ questions: [], unasked: 2 }); // not asked yet: a count only
    expect(m.nodes.find((n) => n.id === "n04")?.status).toBe("off"); // not in the videos
    const text = JSON.stringify(m);
    for (const n of bundle.nodes)
      for (const f of n.facts) {
        expect(text.includes(f.text)).toBe(false);
        if (f.ask && !["n01.f1", "n01.f2"].includes(f.id)) expect(text.includes(f.ask)).toBe(false);
      }
  });

  it("marks an idea outside the videos as a bonus when the learner explains it anyway", () => {
    const s = applyJudgement(s0, j([{ fact: "n04.f1", verdict: "correct", quote: "a" }]));
    const m = mindView(bundle, s);
    expect(m.nodes.find((n) => n.id === "n04")).toMatchObject({ status: "bonus", correct: 1, total: 1 });
    expect(m.facts.correct).toBe(0); // doesn't count towards the score
  });
});
