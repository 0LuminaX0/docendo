import { z } from "zod";
import type { Bundle } from "../../content/schema";

// Kai's state travels with the browser between turns and is validated on every
// request. Tampering with it only changes that learner's own session.

/** Longest learner message, in characters (about 600 words: room for a pasted explanation). */
export const MESSAGE_MAX = 4000;

export const Verdict = z.enum(["correct", "partial", "wrong"]);
export type Verdict = z.infer<typeof Verdict>;

export const Entry = z.object({
  fact: z.string().max(12),
  verdict: Verdict,
  words: z.string().max(400), // the learner's own words
  turn: z.number().int().min(0).max(1000),
});
export type Entry = z.infer<typeof Entry>;

/**
 * A wrong belief the learner stated, in their own words. Not tied to a fixed
 * list: misconceptions arise while explaining, so the judge records whatever it
 * finds, under the idea it is about. Kai believes it like everything else it was
 * told; the practice chapter can later show where it leads.
 */
export const Belief = z.object({
  node: z.string().max(12),
  words: z.string().max(400), // the learner's own words
  turn: z.number().int().min(0).max(1000),
});
export type Belief = z.infer<typeof Belief>;

export const NodeMemo = z.object({
  attempts: z.number().int().min(0).max(100), // real answers (not chit-chat) while this node was the focus
  followUps: z.number().int().min(0).max(100),
  probed: z.boolean(),
  voiced: z.boolean(),
  parked: z.boolean(),
  tries: z.record(z.string().max(12), z.number().int().min(0).max(100)).default({}), // times Kai asked each fact's question
  nudged: z.boolean().default(false), // "before we move on…" already asked once
});
export type NodeMemo = z.infer<typeof NodeMemo>;

// "listen" is no longer chosen (every Kai message ends with a question); kept so older saved states still parse
export const MoveType = z.enum(["open", "followUp", "nudge", "deepen", "misconception", "contradict", "answer", "listen", "wrapUp"]);
export type MoveType = z.infer<typeof MoveType>;

export const State = z.object({
  v: z.literal(1),
  turn: z.number().int().min(0).max(1000),
  focus: z.string().max(12).nullable(),
  notebook: z.array(Entry).max(300),
  misconceptions: z.array(Belief).max(100).default([]), // older saved states have none
  memo: z.record(z.string().max(12), NodeMemo),
  contradicted: z.array(z.string().max(60)).max(50),
  usedTerms: z.array(z.string().max(60)).max(300), // lesson terms the learner has used
  last: z.object({ type: MoveType, node: z.string().max(12).nullable(), fact: z.string().max(12).nullable().default(null) }).nullable(),
  done: z.boolean(),
});
export type State = z.infer<typeof State>;

export type Node = Bundle["nodes"][number];

export const blankMemo = (): NodeMemo => ({ attempts: 0, followUps: 0, probed: false, voiced: false, parked: false, tries: {}, nudged: false });

export function initialState(bundle: Bundle): State {
  const first = bundle.nodes.find((n) => n.kind === "core") ?? null;
  return {
    v: 1,
    turn: 0,
    focus: first?.id ?? null,
    notebook: [],
    misconceptions: [],
    memo: {},
    contradicted: [],
    usedTerms: [],
    last: first ? { type: "open", node: first.id, fact: null } : null,
    done: false,
  };
}

/** Latest verdict per fact: a later verdict on the same fact replaces earlier ones. */
export function latest(state: State): Map<string, Entry> {
  const m = new Map<string, Entry>();
  for (const e of state.notebook) m.set(e.fact, e);
  return m;
}

/**
 * Misconceptions Kai still believes: a later correct explanation of any fact of
 * the same idea replaces them, as a later verdict replaces an earlier one on a
 * fact. (All stay in `state.misconceptions` for the log.)
 */
export function activeMisconceptions(state: State): Belief[] {
  const corrected = (m: Belief) => state.notebook.some((e) => e.verdict === "correct" && e.turn > m.turn && e.fact.split(".")[0] === m.node);
  return (state.misconceptions ?? []).filter((m) => !corrected(m));
}

/** Required facts the learner-facing videos cover: what Kai waits for. */
export const teachableRequired = (n: Node) => n.facts.filter((f) => f.required && f.teachable);

export type NodeStatus = "unseen" | "mentioned" | "explained";

export function nodeStatus(n: Node, state: State, facts = latest(state)): NodeStatus {
  const need = teachableRequired(n);
  if (need.length && need.every((f) => facts.get(f.id)?.verdict === "correct")) return "explained";
  const touched = n.facts.some((f) => facts.has(f.id)) || n.lexicon.some((t) => state.usedTerms.includes(t));
  return touched ? "mentioned" : "unseen";
}

/**
 * How much of what Kai needs has been taught. Counted over the required facts
 * the videos cover ("teachable"): a correct explanation counts 1, a partial
 * one 0.5, a wrong or missing one 0. The latest verdict per fact counts.
 */
export function factScore(bundle: Bundle, state: State) {
  const facts = latest(state);
  const all = bundle.nodes.flatMap(teachableRequired);
  let correct = 0;
  let partial = 0;
  for (const f of all) {
    const v = facts.get(f.id)?.verdict;
    if (v === "correct") correct++;
    else if (v === "partial") partial++;
  }
  return { correct, partial, total: all.length, score: all.length ? (correct + 0.5 * partial) / all.length : 1 };
}

export const progress = (bundle: Bundle, state: State): number => factScore(bundle, state).score;

export const memo = (state: State, id: string): NodeMemo => ({ ...blankMemo(), ...state.memo[id] });
