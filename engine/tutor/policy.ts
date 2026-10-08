import type { Bundle } from "../../content/schema";
import { latest, memo, nodeStatus, progress, teachableRequired, type Entry, type MoveType, type Node, type State } from "./state";
import type { Judgement } from "./judge";

// Deterministic: the same state and judgement always give the same move.
// Every move except wrapUp ends in one concrete question, so the learner always
// knows what Kai is waiting for.

export const CONFIG = {
  ready: 0.8, // share of teachable required facts explained before Kai feels ready…
  readyLate: 0.5, // …or this share once the learner has taught for lateAfterMin minutes
  lateAfterMin: 8,
  maxTurns: 30, // learner messages; Kai wraps up after this many regardless
  tries: 1, // Kai asks each fact's question once…
  triesIfClose: 2, // …or twice when the answer was partly right (or wrong)
};

export type Move = {
  type: MoveType;
  node: string | null;
  seed: string | null; // a pre-checked question or line the writer may rephrase
  fact?: string | null; // followUp, nudge: the fact the seed asks about
  closure?: "explained" | "parked" | null; // close the previous idea first: "got it" or "let's come back to it"
  cue?: "again" | "skip" | null; // followUp: re-ask after a reply that wasn't an answer / the learner didn't know
  then?: Move | null; // answer: the question Kai carries on with
};

const PROBES = ["why", "whatIf", "compute"] as const;

export type ReadyReason = "score" | "time" | "maxTurns";

/**
 * Why Kai feels ready, or null. Ready at 80% of what it waits for, or at 50%
 * once the learner has taught for 8 minutes (elapsedMs, from the teach page).
 * Either way every goal needs at least one explained idea.
 */
export function readyReason(bundle: Bundle, state: State, elapsedMs = 0): ReadyReason | null {
  if (state.turn >= CONFIG.maxTurns) return "maxTurns";
  const facts = latest(state);
  const p = progress(bundle, state);
  const goalsOk = bundle.goals.every((g) =>
    bundle.nodes.some((n) => n.goals.includes(g.id) && teachableRequired(n).length > 0 && nodeStatus(n, state, facts) === "explained"),
  );
  if (!goalsOk) return null;
  if (p >= CONFIG.ready) return "score";
  if (p >= CONFIG.readyLate && elapsedMs >= CONFIG.lateAfterMin * 60_000) return "time";
  return null;
}

export const isReady = (bundle: Bundle, state: State, elapsedMs = 0): boolean => {
  const r = readyReason(bundle, state, elapsedMs);
  return r === "score" || r === "time";
};

/** How often Kai asks a fact's question: once, or twice if the first answer was close. */
const limitFor = (e: Entry | undefined) => (e && e.verdict !== "correct" ? CONFIG.triesIfClose : CONFIG.tries);

/** The next required fact of a node Kai still lacks and may still ask about. */
export function nextFact(n: Node, state: State, skip: string | null = null, ignoreTries = false) {
  const facts = latest(state);
  const m = memo(state, n.id);
  return (
    teachableRequired(n).find((f) => {
      const e = facts.get(f.id);
      if (e?.verdict === "correct" || f.id === skip) return false;
      return ignoreTries || (m.tries[f.id] ?? 0) < limitFor(e);
    }) ?? null
  );
}

export function nextMove(bundle: Bundle, state: State, j: Judgement, elapsedMs = 0): Move {
  const wrapUp: Move = { type: "wrapUp", node: null, seed: null };
  if (readyReason(bundle, state, elapsedMs)) return wrapUp;

  // 1. a question for Kai: answer from the notebook, then carry on with a question
  if (j.intent === "ask_kai") {
    const then = carryOn(bundle, state, j);
    return then.type === "wrapUp" ? wrapUp : { type: "answer", node: then.node, seed: null, then };
  }

  // 2. a new wrong fact that matches a known misconception
  for (const v of j.facts) {
    if (v.verdict !== "wrong") continue;
    const n = bundle.nodes.find((x) => x.id === v.fact.split(".")[0]);
    const m = n?.misconception;
    if (!n || !m || state.contradicted.includes(m.id)) continue;
    const q = bundle.questions.contradictions.find((c) => c.misconception === m.id);
    if (q) return { type: "contradict", node: n.id, seed: q.question };
  }

  // 3. "what's next?" before the idea is done: ask once about what's missing, then let it go
  const f = focusNode(bundle, state);
  if (j.intent === "move_on" && f && nodeStatus(f, state) !== "explained") {
    const fact = nextFact(f, state, null, true);
    if (fact && !memo(state, f.id).nudged) return { type: "nudge", node: f.id, seed: fact.ask ?? null, fact: fact.id };
    return moveOn(bundle, state, j, "parked");
  }

  return carryOn(bundle, state, j);
}

const focusNode = (bundle: Bundle, state: State) => (state.focus ? bundle.nodes.find((n) => n.id === state.focus) : undefined);

/** Stay on the focus idea while Kai still has a question about it; otherwise move on. */
function carryOn(bundle: Bundle, state: State, j: Judgement): Move {
  const f = focusNode(bundle, state);
  if (!f) return moveOn(bundle, state, j, null);
  const m = memo(state, f.id);

  if (nodeStatus(f, state) === "explained") {
    // the idea was completed by this very message: say so before anything else
    const closure = state.last?.node === f.id && ["open", "followUp", "nudge"].includes(state.last.type) ? "explained" : null;
    if (f.misconception && !m.voiced) return { type: "misconception", node: f.id, seed: f.misconception.says, closure };
    if (!m.probed) return { type: "deepen", node: f.id, seed: f.probes[PROBES[Math.max(0, bundle.nodes.indexOf(f)) % PROBES.length]!], closure };
    return moveOn(bundle, state, j, closure);
  }

  if (!teachableRequired(f).length) return moveOn(bundle, state, j, null);

  // a reply that wasn't an answer at all (chit-chat, gibberish): ask the same question again
  const lastFact = state.last?.node === f.id ? (state.last.fact ?? null) : null;
  if (j.intent === "off_topic" && lastFact && !j.facts.length) {
    const fact = f.facts.find((x) => x.id === lastFact);
    if (fact && latest(state).get(fact.id)?.verdict !== "correct")
      return { type: "followUp", node: f.id, seed: fact.ask ?? null, fact: fact.id, cue: "again" };
  }

  // the next fact Kai still lacks; "I don't know" skips the fact just asked
  const skip = j.intent === "unsure" ? lastFact : null;
  const fact = nextFact(f, state, skip);
  if (fact) return { type: "followUp", node: f.id, seed: fact.ask ?? null, fact: fact.id, cue: skip ? "skip" : null };

  // every question asked as often as allowed: set the idea aside for now
  return moveOn(bundle, state, j, "parked");
}

function moveOn(bundle: Bundle, state: State, j: Judgement, closure: Move["closure"]): Move {
  const n = pickNext(bundle, state, j);
  return n ? { type: "open", node: n.id, seed: n.probes.open, closure } : { type: "wrapUp", node: null, seed: null };
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
