import type { Bundle } from "../../content/schema";
import { CONFIG, isReady } from "./policy";
import { factScore, latest, memo, nodeStatus, teachableRequired, type State } from "./state";

// A read-only picture of what Kai knows, for the "Kai's mind" view. It carries
// ids, states and counts only, never lesson fact text.

export type MindStatus = "off" | "unseen" | "mentioned" | "explained" | "checked" | "parked";

export type Mind = {
  understanding: number; // 0..1, where 1 = Kai feels ready (score / CONFIG.ready, capped)
  facts: { correct: number; partial: number; total: number; needed: number };
  goals: { id: string; level: string; explained: number; total: number; ok: boolean }[];
  nodes: { id: string; status: MindStatus; correct: number; partial: number; total: number; focus: boolean }[];
  turn: number;
  maxTurns: number;
  ready: boolean;
};

export function mindView(bundle: Bundle, state: State): Mind {
  const facts = latest(state);
  const s = factScore(bundle, state);
  const nodes = bundle.nodes.map((n) => {
    const need = teachableRequired(n);
    const st = nodeStatus(n, state, facts);
    const m = memo(state, n.id);
    const status: Mind["nodes"][number]["status"] =
      need.length === 0 ? "off" : st === "explained" ? (m.probed ? "checked" : "explained") : m.parked ? "parked" : st;
    return {
      id: n.id,
      status,
      correct: need.filter((f) => facts.get(f.id)?.verdict === "correct").length,
      partial: need.filter((f) => facts.get(f.id)?.verdict === "partial").length,
      total: need.length,
      focus: state.focus === n.id && !state.done,
    };
  });
  const goals = bundle.goals.map((g) => {
    const ns = nodes.filter((x) => x.status !== "off" && bundle.nodes.find((n) => n.id === x.id)?.goals.includes(g.id));
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
    ready: state.done || isReady(bundle, state),
  };
}
