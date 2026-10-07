import type { Bundle } from "../../content/schema";
import { forbiddenTerms } from "./admit";
import type { Judgement } from "./judge";
import { CONFIG, isReady, nextMove, type Move } from "./policy";
import { blankMemo, latest, memo, nodeStatus, progress, type State } from "./state";
import { mindView, type Mind } from "./mind";
import type { Turn } from "./writer";

/**
 * How Kai feels about the learner's last message:
 * great    2+ facts newly explained, an idea fully explained, or Kai is ready
 * okay     one new fact, partly explained ones, or facts Kai already knew (consistent, nothing new)
 * confused no lesson fact at all, a wrong fact, or "I'm not sure"
 * neutral  Kai is answering the learner's question, the learner asked to move on, or just opening
 */
export type Mood = "neutral" | "great" | "okay" | "confused";

export type Deps = {
  judge: (bundle: Bundle, message: string, kaiLast: string) => Promise<Judgement>;
  write: (bundle: Bundle, state: State, move: Move, history: Turn[], mood: Mood, avoid: string[]) => Promise<string>;
};

export type TurnResult = {
  reply: string;
  mood: Mood;
  state: State;
  progress: number; // 0..1 of what Kai needs before it feels ready
  mind: Mind; // node states and counts for the "Kai's mind" view
  done: boolean;
  help: { video: string; start: number; end: number } | null; // for the current question
  helpAvailable: boolean; // answer first: help opens after one attempt on the current idea
  trace: { move: Move; intent: Judgement["intent"]; judged: Judgement["facts"]; dropped: Judgement["dropped"]; leaked: string[]; fallback: boolean }; // for logs, not shown
};

export function opening(bundle: Bundle, state: State): string {
  const first = state.focus ? bundle.nodes.find((n) => n.id === state.focus) : undefined;
  return `Hi! I'm Kai. I missed the lecture on ${bundle.title.toLowerCase()}, and I heard you just watched it. Could you teach me? ${first?.probes.open ?? "Where should we start?"}`;
}

/** Apply the judgement to a copy of the state: notebook, used terms, attempts on the focus, unparking. */
export function applyJudgement(state: State, j: Judgement): State {
  const next: State = structuredClone(state);
  next.turn += 1;
  const known = latest(state);
  for (const v of j.facts) {
    // a vague later mention never undoes a correct explanation; only a wrong one does
    if (v.verdict === "partial" && known.get(v.fact)?.verdict === "correct") continue;
    next.notebook.push({ fact: v.fact, verdict: v.verdict, words: v.quote.slice(0, 400), turn: next.turn });
  }
  if (next.notebook.length > 300) next.notebook = next.notebook.slice(-300);
  for (const t of j.termsUsed) if (!next.usedTerms.includes(t)) next.usedTerms.push(t);
  // only a real answer counts as having a go (it unlocks the help card); chit-chat doesn't
  if (next.focus && ["explain", "answer", "unsure"].includes(j.intent)) next.memo[next.focus] = { ...memo(next, next.focus), attempts: memo(next, next.focus).attempts + 1 };
  // explaining any fact of a set-aside idea brings it back
  for (const v of j.facts) {
    const id = v.fact.split(".")[0]!;
    if (v.verdict === "correct" && next.memo[id]?.parked) next.memo[id] = { ...memo(next, id), parked: false };
  }
  return next;
}

/** Record what the chosen move does to the state. */
export function applyMove(bundle: Bundle, state: State, move: Move): State {
  const next: State = structuredClone(state);
  const touch = (id: string, f: (m: ReturnType<typeof blankMemo>) => void) => {
    const m = { ...memo(next, id) };
    f(m);
    next.memo[id] = m;
  };
  const asked = (id: string, fact: string | null | undefined) => touch(id, (m) => fact && (m.tries = { ...m.tries, [fact]: (m.tries[fact] ?? 0) + 1 }));
  switch (move.type) {
    case "open":
      if (next.focus && next.focus !== move.node && move.closure === "parked") {
        const old = bundle.nodes.find((n) => n.id === next.focus);
        if (old && nodeStatus(old, next) !== "explained") touch(old.id, (m) => (m.parked = true));
      }
      next.focus = move.node;
      // a fresh start on the idea, also when a set-aside one comes back
      if (move.node) touch(move.node, (m) => ((m.attempts = 0), (m.followUps = 0), (m.parked = false), (m.tries = {}), (m.nudged = false)));
      break;
    case "followUp":
      if (move.node) touch(move.node, (m) => (m.followUps += 1));
      // re-asking after a reply that wasn't an answer doesn't use up the question
      if (move.node && move.cue !== "again") asked(move.node, move.fact);
      break;
    case "nudge":
      if (move.node) touch(move.node, (m) => (m.nudged = true));
      if (move.node) asked(move.node, move.fact);
      break;
    case "answer":
      // answering the learner's question, then carrying on: the follow-on question is what changes the state
      return move.then ? applyMove(bundle, state, move.then) : { ...next, last: { type: "answer", node: move.node, fact: null } };
    case "deepen":
      if (move.node) touch(move.node, (m) => (m.probed = true));
      break;
    case "misconception":
      if (move.node) touch(move.node, (m) => (m.voiced = true));
      break;
    case "contradict": {
      const n = bundle.nodes.find((x) => x.id === move.node);
      if (n?.misconception) next.contradicted.push(n.misconception.id);
      break;
    }
    case "wrapUp":
      next.done = true;
      break;
  }
  next.last = { type: move.type, node: move.node, fact: move.fact ?? null };
  return next;
}

export async function takeTurn(
  bundle: Bundle,
  input: { message: string; history: Turn[]; state: State },
  deps: Deps,
): Promise<TurnResult> {
  const kaiLast = [...input.history].reverse().find((t) => t.role === "kai")?.text ?? "";
  const j = await deps.judge(bundle, input.message, kaiLast);
  let state = applyJudgement(input.state, j);

  const move = nextMove(bundle, state, j);
  state = applyMove(bundle, state, move);

  const mood = moodFor(bundle, input.state, state, j, move);

  // write, then admit: one rewrite with the offending words named, then a safe fallback
  const history: Turn[] = [...input.history, { role: "learner", text: input.message }];
  let reply = await deps.write(bundle, state, move, history, mood, []);
  let leaked = forbiddenTerms(bundle, state, reply);
  let fallback = false;
  if (leaked.length) {
    reply = await deps.write(bundle, state, move, history, mood, leaked);
    const again = forbiddenTerms(bundle, state, reply);
    if (again.length) {
      fallback = true;
      const seed = move.seed ?? move.then?.seed ?? null;
      const seedOk = seed && forbiddenTerms(bundle, state, seed).length === 0;
      reply = seedOk ? seed : bundle.questions.fallbacks.dontKnow[state.turn % bundle.questions.fallbacks.dontKnow.length]!;
    }
    leaked = [...new Set([...leaked, ...again])];
  }

  const focus = state.focus ? bundle.nodes.find((n) => n.id === state.focus) : undefined;
  const done = state.done || isReady(bundle, state);
  return {
    reply,
    mood,
    state,
    progress: Math.min(1, progress(bundle, state) / CONFIG.ready),
    mind: mindView(bundle, state),
    done,
    help: !done && focus?.help[0] ? focus.help[0] : null,
    helpAvailable: !!focus && memo(state, focus.id).attempts > 0,
    trace: { move, intent: j.intent, judged: j.facts, dropped: j.dropped ?? [], leaked, fallback },
  };
}

export function moodFor(bundle: Bundle, before: State, after: State, j: Judgement, move: Move): Mood {
  if (move.type === "wrapUp") return "great";
  if (j.intent === "ask_kai" || (j.intent === "move_on" && !j.facts.length)) return "neutral";
  const old = latest(before);
  const newCorrect = j.facts.filter((v) => v.verdict === "correct" && old.get(v.fact)?.verdict !== "correct").length;
  const newPartial = j.facts.filter((v) => v.verdict === "partial" && !old.has(v.fact)).length;
  const wrong = j.facts.some((v) => v.verdict === "wrong");
  const nowExplained = bundle.nodes.some((n) => nodeStatus(n, after) === "explained" && nodeStatus(n, before) !== "explained");
  const touched = j.facts.some((v) => v.verdict !== "wrong");
  if (wrong || j.intent === "unsure" || j.intent === "off_topic" || (!touched && newCorrect === 0 && newPartial === 0)) return "confused";
  if (newCorrect >= 2 || nowExplained) return "great";
  return "okay";
}
