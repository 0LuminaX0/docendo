import type { Bundle } from "../../content/schema";
import { latest, memo, nodeStatus, progress, teachableRequired, type MoveType, type Node, type State } from "./state";
import type { Judgement } from "./judge";

// Deterministic: the same state and judgement always give the same move.

export const CONFIG = {
  ready: 0.8, // share of teachable required facts explained before Kai feels ready
  maxTurns: 30, // learner messages; Kai wraps up after this many regardless
  maxFollowUps: 2, // per node, before the node is parked
  listenWords: 45, // a long message that taught 2+ new facts gets "go on"
};

export type Move = {
  type: MoveType;
  node: string | null;
  seed: string | null; // a pre-checked question or line the writer may rephrase
};

const PROBES = ["why", "whatIf", "compute"] as const;

export function isReady(bundle: Bundle, state: State): boolean {
  const facts = latest(state);
  const p = progress(bundle, state);
  // every goal needs at least one explained node, so Kai doesn't finish on one goal alone
  const goalsOk = bundle.goals.every((g) =>
    bundle.nodes.some((n) => n.goals.includes(g.id) && teachableRequired(n).length > 0 && nodeStatus(n, state, facts) === "explained"),
  );
  return p >= CONFIG.ready && goalsOk;
}

export function nextMove(bundle: Bundle, state: State, j: Judgement, learnerWords: number): Move {
  const byId = new Map(bundle.nodes.map((n) => [n.id, n]));
  const facts = latest(state);
  const status = (n: Node) => nodeStatus(n, state, facts);

  if (isReady(bundle, state) || state.turn >= CONFIG.maxTurns) return { type: "wrapUp", node: null, seed: null };

  // 1. a question for Kai: answer from the notebook, then carry on with the focus
  if (j.intent === "ask_kai") {
    const f = state.focus ? byId.get(state.focus) : undefined;
    return { type: "answer", node: f?.id ?? null, seed: f && status(f) !== "explained" ? f.probes.open : null };
  }

  // 2. a new wrong fact that matches a known misconception
  for (const v of j.facts) {
    if (v.verdict !== "wrong") continue;
    const n = byId.get(v.fact.split(".")[0]!);
    const m = n?.misconception;
    if (!n || !m || state.contradicted.includes(m.id)) continue;
    const q = bundle.questions.contradictions.find((c) => c.misconception === m.id);
    if (q) return { type: "contradict", node: n.id, seed: q.question };
  }

  // 3. the learner is in full flow: let them continue
  const newCorrect = j.facts.filter((v) => v.verdict === "correct").length;
  const f = state.focus ? byId.get(state.focus) : undefined;
  if (f && newCorrect >= 2 && learnerWords >= CONFIG.listenWords && status(f) !== "explained" && state.last?.type !== "listen")
    return { type: "listen", node: f.id, seed: null };

  // 4. stay on the focus node: misconception, one deepening question, or a follow-up
  if (f) {
    const m = memo(state, f.id);
    if (status(f) === "explained") {
      if (f.misconception && !m.voiced) return { type: "misconception", node: f.id, seed: f.misconception.says };
      if (!m.probed) {
        const kind = PROBES[bundle.nodes.indexOf(f) % PROBES.length]!;
        return { type: "deepen", node: f.id, seed: f.probes[kind] };
      }
    } else if (teachableRequired(f).length && !m.parked && m.followUps < CONFIG.maxFollowUps && m.attempts > 0) {
      return { type: "followUp", node: f.id, seed: null };
    }
  }

  // 5. move on to the best next idea
  const n = pickNext(bundle, state, j);
  if (n) return { type: "open", node: n.id, seed: n.probes.open };

  return { type: "wrapUp", node: null, seed: null };
}

/** Score unlocked, unexplained nodes; fall back to parked ones once everything else is done. */
export function pickNext(bundle: Bundle, state: State, j: Judgement): Node | null {
  const facts = latest(state);
  const byId = new Map(bundle.nodes.map((n) => [n.id, n]));
  const status = (n: Node) => nodeStatus(n, state, facts);
  const done = (id: string) => {
    const n = byId.get(id);
    return !n || status(n) === "explained" || teachableRequired(n).length === 0 || memo(state, id).parked;
  };
  const open = bundle.nodes.filter((n) => n.kind === "core" && teachableRequired(n).length > 0 && status(n) !== "explained");
  const candidates = open.filter((n) => !memo(state, n.id).parked && n.id !== state.focus);
  const pool = candidates.length ? candidates : open.filter((n) => n.id !== state.focus || open.length === 1);
  if (!pool.length) return null;

  // goal coverage: explained share per goal
  const goalShare = new Map(
    bundle.goals.map((g) => {
      const ns = bundle.nodes.filter((n) => n.goals.includes(g.id) && teachableRequired(n).length);
      return [g.id, ns.length ? ns.filter((n) => status(n) === "explained").length / ns.length : 1];
    }),
  );
  const leastGoal = [...goalShare.entries()].sort((a, b) => a[1] - b[1])[0]?.[0];
  const mentionedNow = new Set(j.facts.map((v) => v.fact.split(".")[0]));

  const score = (n: Node) =>
    (n.needs.every(done) ? 10 : 0) + // unlocked first
    (mentionedNow.has(n.id) || n.lexicon.some((t) => j.termsUsed.includes(t)) ? 3 : 0) +
    (leastGoal && n.goals.includes(leastGoal) ? 2 : 0) +
    (state.focus && n.needs.includes(state.focus) ? 1 : 0) -
    (memo(state, n.id).parked ? 2 : 0);
  return [...pool].sort((a, b) => score(b) - score(a) || bundle.nodes.indexOf(a) - bundle.nodes.indexOf(b))[0] ?? null;
}
