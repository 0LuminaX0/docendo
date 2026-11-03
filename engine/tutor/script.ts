import type { Bundle } from "../../content/schema";
import type { ScriptFile } from "../../content/pack";
import { CONFIG, type Move, type ReadyReason } from "./policy";
import { initialState, memo, notesOf, progress, type State } from "./state";
import { mindView } from "./mind";
import { applyJudgement, moodFor, type Deps, type TurnResult } from "./turn";
import type { Turn } from "./writer";

// Kai's fixed teaching questions (script.json): the same questions for everyone, in order, instead of Kai choosing
// its next question from the lesson's ideas (policy.ts). The judge still reads every message and Kai's notebook
// fills as before; only what Kai says is fixed. Between questions Kai repeats what it wrote down, in the learner's own
// words, so no model writes Kai's lines and nothing can leak lesson content. A short answer to a question that asks
// for an explanation gets one "Can you say more about that?"; "I don't know" or "next" moves on; a question to Kai or a
// reply that isn't an answer gets the question again, once. Kai wraps up after the last question, at the first
// message after `minutes`, or after CONFIG.maxTurns messages, and then reads its notes back without judging them.

export type Script = ScriptFile;

/** A fresh session that follows the script: on its first question, about that question's idea. */
export function initialScriptState(bundle: Bundle, script: Script): State {
  const s = initialState(bundle);
  const q = script.questions[0]!;
  const focus = q.node ?? s.focus;
  return { ...s, focus, last: { type: "open", node: focus, fact: null }, script: { at: 0, more: false, again: 0 } };
}

/** Kai's first message: its opening and its first question. */
export const scriptOpening = (script: Script) => `${script.opening} ${script.questions[0]!.text}`;

const clip = (t: string, max = 220) => {
  const s = t.trim().replace(/\s+/g, " ");
  if (s.length <= max) return s;
  const cut = s.slice(0, max);
  return `${cut.slice(0, Math.max(cut.lastIndexOf(" "), 60)).trimEnd()}…`;
};

/** “A”, “A” and “B”, “A”, “B” and “C” (a note's own full stop stays outside, before Kai's) */
const listed = (xs: string[]) => {
  const q = xs.map((x) => `“${x.replace(/[\s.!;:,]+$/u, "")}”`);
  return q.length < 2 ? (q[0] ?? "") : `${q.slice(0, -1).join(", ")} and ${q.at(-1)}`;
};

/** What Kai wrote down from this message: the notes it added this turn (facts and misconceptions alike), each once. */
export function wroteNow(state: State): string[] {
  const now = [...state.notebook.filter((e) => e.turn === state.turn), ...(state.misconceptions ?? []).filter((m) => m.turn === state.turn)];
  const norm = (t: string) => t.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
  const out: string[] = [];
  const keys: string[] = [];
  for (const e of now) {
    const text = e.note || e.words;
    const k = norm(e.words);
    if (!k) continue;
    // one message can state several facts in overlapping words: keep the longest, in the place of the first
    const i = keys.findIndex((o) => o.includes(k) || k.includes(o));
    if (i < 0) (out.push(text), keys.push(k));
    else if (k.length > keys[i]!.length) ((out[i] = text), (keys[i] = k));
  }
  return out.slice(0, 3).map((t) => clip(t));
}

/** Kai's wrap-up: its notes as they stand, read back without judging them. */
export function readBack(script: Script, state: State): string {
  const notes = notesOf(state).slice(0, 10);
  return notes.length ? `${script.lines.ready}\n${notes.map((n) => `• ${clip(n, 240)}`).join("\n")}` : script.lines.readyEmpty;
}

export async function takeScriptTurn(
  bundle: Bundle,
  script: Script,
  input: { message: string; history: Turn[]; state: State; elapsedMs?: number },
  deps: Pick<Deps, "judge">,
): Promise<TurnResult & { trace: TurnResult["trace"] & { script: { asked: string; next: string | null; sayMore: boolean } } }> {
  const kaiLast = [...input.history].reverse().find((t) => t.role === "kai")?.text ?? "";
  const j = await deps.judge(bundle, input.message, kaiLast);
  let state = applyJudgement(input.state, j);
  const at = Math.min(state.script?.at ?? 0, script.questions.length - 1);
  const pos = { at, more: state.script?.more ?? false, again: state.script?.again ?? 0 };
  const q = script.questions[at]!;
  const L = script.lines;
  const words = input.message.split(/\s+/).filter(Boolean).length;
  const notes = wroteNow(state);
  const echo = notes.length ? L.wrote.replace("{notes}", listed(notes)) : null;

  // what this reply does: ask the same question again (say more, or after a reply that wasn't an answer), or go on
  let lead: string;
  let stay: "more" | "again" | null = null;
  if ((j.intent === "ask_kai" || j.intent === "off_topic") && pos.again < 1) (stay = "again"), (lead = j.intent === "ask_kai" ? L.askedKai : L.notAnswer);
  else if (j.intent === "unsure") lead = L.dontKnow;
  else if (j.intent === "move_on") lead = echo ?? L.moveOn;
  else if ((j.intent === "explain" || j.intent === "answer") && q.sayMore && !pos.more && words < script.shortWords) (stay = "more"), (lead = echo ? `${echo} ${L.sayMore}` : L.sayMore);
  else lead = echo ?? (j.intent === "ask_kai" || j.intent === "off_topic" ? L.moveOn : L.wroteNothing);

  const timeUp = (input.elapsedMs ?? 0) >= script.minutes * 60_000;
  const next = stay ? at : at + 1;
  const end = timeUp || state.turn >= CONFIG.maxTurns || next >= script.questions.length;
  const why: ReadyReason | null = end ? (timeUp ? "time" : state.turn >= CONFIG.maxTurns ? "maxTurns" : "script") : null;

  let reply: string;
  let move: Move;
  if (end) {
    // time's up or the last question answered: no "say more" or re-asked question before the wrap-up
    const last = stay ? (echo ?? "") : lead;
    reply = last ? `${last}\n\n${readBack(script, state)}` : readBack(script, state);
    move = { type: "wrapUp", node: null, seed: null };
    state = { ...state, done: true, script: { ...pos } };
  } else if (stay) {
    reply = stay === "more" ? lead : `${lead} ${q.text}`;
    move = { type: "followUp", node: q.node, seed: stay === "more" ? L.sayMore : q.text, fact: null, cue: "again" };
    state = { ...state, script: { at, more: pos.more || stay === "more", again: pos.again + (stay === "again" ? 1 : 0) } };
  } else {
    const nq = script.questions[next]!;
    reply = `${lead} ${nq.text}`;
    move = { type: "open", node: nq.node, seed: nq.text, fact: null };
    state = { ...state, focus: nq.node ?? state.focus, script: { at: next, more: false, again: 0 } };
  }
  state = { ...state, last: { type: move.type, node: move.node, fact: null } };

  const mood = moodFor(bundle, input.state, state, j, move);
  const focus = state.focus ? bundle.nodes.find((n) => n.id === state.focus) : undefined;
  const done = state.done;
  return {
    reply,
    mood,
    state,
    progress: Math.min(1, progress(bundle, state) / CONFIG.ready),
    mind: mindView(bundle, state),
    done,
    help: !done && focus?.help[0] ? focus.help[0] : null,
    helpAvailable: !!focus && memo(state, focus.id).attempts > 0,
    trace: {
      move,
      intent: j.intent,
      judged: j.facts,
      misconceptions: j.misconceptions ?? [],
      dropped: j.dropped ?? [],
      notesDropped: j.notesDropped ?? [],
      leaked: [],
      fallback: false,
      readyReason: why,
      drafts: [],
      script: { asked: q.id, next: end ? null : script.questions[next]!.id, sayMore: stay === "more" },
    },
  };
}
