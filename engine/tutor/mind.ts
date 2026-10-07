import type { Bundle } from "../../content/schema";
import { CONFIG, isReady } from "./policy";
import { factScore, latest, memo, nodeStatus, teachableRequired, type State } from "./state";

// A read-only picture of what Kai knows, for the "Kai's mind" view. It never
// carries lesson fact text: per idea it lists the questions Kai has already
// asked (or that the learner answered unasked) with the learner's own words,
// and only counts the questions Kai hasn't asked yet, so it gives no hints.

export type MindStatus = "off" | "bonus" | "unseen" | "mentioned" | "explained" | "checked" | "parked";

export type Question = {
  state: "answered" | "partly" | "wrong" | "asked" | "current";
  ask: string | null; // Kai's question, once asked or answered (null for facts without one)
  words: string | null; // what the learner said about it
};

export type MindNode = {
  id: string;
  status: MindStatus;
  correct: number;
  partial: number;
  total: number;
  focus: boolean;
  asking: string | null; // Kai's current question about this idea, if any
  questions: Question[];
  unasked: number; // questions Kai still has but hasn't asked
};

export type Mind = {
  understanding: number; // 0..1, where 1 = Kai feels ready (score / CONFIG.ready, capped)
  facts: { correct: number; partial: number; total: number; needed: number };
  goals: { id: string; level: string; explained: number; total: number; ok: boolean }[];
  nodes: MindNode[];
  turn: number;
  maxTurns: number;
  ready: boolean;
};

const STATE = { correct: "answered", partial: "partly", wrong: "wrong" } as const;

export function mindView(bundle: Bundle, state: State): Mind {
  const facts = latest(state);
  const s = factScore(bundle, state);
  const done = state.done || isReady(bundle, state);
  const nodes = bundle.nodes.map((n): MindNode => {
    const need = teachableRequired(n);
    const st = nodeStatus(n, state, facts);
    const m = memo(state, n.id);
    const focus = state.focus === n.id && !done;
    const current = focus && state.last?.node === n.id ? (state.last.fact ?? null) : null;
    const bonusFacts = need.length === 0 ? n.facts.filter((f) => facts.get(f.id)?.verdict === "correct") : [];
    const status: MindStatus =
      need.length === 0 ? (bonusFacts.length ? "bonus" : "off") : st === "explained" ? (m.probed ? "checked" : "explained") : m.parked ? "parked" : st;

    const questions: Question[] = [];
    let unasked = 0;
    for (const f of n.facts) {
      const e = facts.get(f.id);
      const waited = need.includes(f);
      if (e) questions.push({ state: STATE[e.verdict], ask: f.ask ?? null, words: e.words });
      else if (!waited) continue;
      else if (f.id === current) questions.push({ state: "current", ask: f.ask ?? null, words: null });
      else if ((m.tries[f.id] ?? 0) > 0) questions.push({ state: "asked", ask: f.ask ?? null, words: null });
      else unasked++;
    }
    const asking = !focus ? null : state.last?.type === "open" ? n.probes.open : current ? (n.facts.find((f) => f.id === current)?.ask ?? null) : null;

    return {
      id: n.id,
      status,
      correct: need.length ? need.filter((f) => facts.get(f.id)?.verdict === "correct").length : bonusFacts.length,
      partial: need.filter((f) => facts.get(f.id)?.verdict === "partial").length,
      total: need.length || bonusFacts.length,
      focus,
      asking,
      questions,
      unasked,
    };
  });
  const goals = bundle.goals.map((g) => {
    const ns = nodes.filter((x) => x.status !== "off" && x.status !== "bonus" && bundle.nodes.find((n) => n.id === x.id)?.goals.includes(g.id));
    const explained = ns.filter((x) => x.status === "explained" || x.status === "checked").length;
    return { id: g.id, level: g.level, explained, total: ns.length, ok: explained > 0 };
  });
  return {
    understanding: Math.min(1, s.score / CONFIG.ready),
    facts: { correct: s.correct, partial: s.partial, total: s.total, needed: Math.ceil(s.total * CONFIG.ready) },
    goals,
    nodes,
    turn: state.turn,
    maxTurns: CONFIG.maxTurns,
    ready: done,
  };
}
