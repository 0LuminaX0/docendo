import type { Bundle } from "../../content/schema";
import type { ScriptFile } from "../../content/pack";
import { forbiddenTerms } from "./admit";
import { CONFIG, type Move, type ReadyReason } from "./policy";
import { initialState, memo, notesOf, progress, type State } from "./state";
import { mindView } from "./mind";
import { applyJudgement, moodFor, type Deps, type TurnResult } from "./turn";
import type { Reaction, Turn } from "./writer";

// Kai's fixed teaching questions (script.json): the same questions for everyone, in order, instead of Kai choosing
// its next question from the lesson's ideas (policy.ts). The judge still reads every message and Kai's notebook
// fills as before. What Kai asks is fixed, word for word; before it, Kai reacts to the message in its own words (the
// writer, from the notebook only, with no question of its own and the same term check as Kai's free replies; offline,
// or when the check fails twice, a fixed line). A short answer to a question that asks for an explanation gets one
// "Can you say more about that?"; a question to Kai or a reply that isn't an answer gets the question again, once; "I
// don't know", or a reply that still isn't an answer, moves on, and that question comes back once after the last one.
// Kai wraps up after the last question, at the first message after `minutes`, or after CONFIG.maxTurns messages, and
// then reads its notes back without judging them.

export type Script = ScriptFile;
type Pos = NonNullable<State["script"]>;

/** A fresh session that follows the script: on its first question, about that question's idea. */
export function initialScriptState(bundle: Bundle, script: Script): State {
  const s = initialState(bundle);
  const q = script.questions[0]!;
  const focus = q.node ?? s.focus;
  return { ...s, focus, last: { type: "open", node: focus, fact: null }, script: { at: 0, more: false, again: 0, skipped: [], back: false } };
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

/** The question after this one: the next in order, then once more each one left unanswered; null when none is left. */
export function following(script: Script, pos: Pos, skipped: number[]): { at: number; back: boolean; skipped: number[] } | null {
  if (!pos.back && pos.at + 1 < script.questions.length) return { at: pos.at + 1, back: false, skipped };
  const [first, ...rest] = skipped;
  return first === undefined ? null : { at: first, back: true, skipped: rest };
}

/** Offline, or when the writer's line fails the term check twice: a fixed line for each kind of message. */
function fixedReaction(script: Script, kind: Reaction, echo: string | null): string {
  const L = script.lines;
  switch (kind) {
    case "answered":
    case "end":
      return echo ?? L.wroteNothing;
    case "more":
      return echo ?? "";
    case "again":
      return L.notAnswer;
    case "askedKai":
      return L.askedKai;
    case "unsure":
      return L.dontKnow;
    case "moveOn":
      return echo ?? L.moveOn;
  }
}

export type ScriptTrace = { asked: string; next: string | null; sayMore: boolean; back: boolean; reaction: Reaction };

export async function takeScriptTurn(
  bundle: Bundle,
  script: Script,
  input: { message: string; history: Turn[]; state: State; elapsedMs?: number },
  deps: Pick<Deps, "judge" | "react">,
): Promise<TurnResult & { trace: TurnResult["trace"] & { script: ScriptTrace } }> {
  const kaiLast = [...input.history].reverse().find((t) => t.role === "kai")?.text ?? "";
  const j = await deps.judge(bundle, input.message, kaiLast);
  let state = applyJudgement(input.state, j);
  const saved = state.script;
  const at = Math.min(saved?.at ?? 0, script.questions.length - 1);
  const pos: Pos = { at, more: saved?.more ?? false, again: saved?.again ?? 0, skipped: saved?.skipped ?? [], back: saved?.back ?? false };
  const q = script.questions[at]!;
  const L = script.lines;
  const words = input.message.split(/\s+/).filter(Boolean).length;
  const notes = wroteNow(state);
  const echo = notes.length ? L.wrote.replace("{notes}", listed(notes)) : null;

  // what this reply does: ask the same question again (say more, or after a reply that wasn't an answer), or go on
  const notAnswer = j.intent === "ask_kai" || j.intent === "off_topic";
  const toKai: Reaction = j.intent === "ask_kai" ? "askedKai" : "again";
  let kind: Reaction;
  let stay: "more" | "again" | null = null;
  if (notAnswer && pos.again < 1) (stay = "again"), (kind = toKai);
  else if (j.intent === "unsure") kind = "unsure";
  else if (j.intent === "move_on") kind = "moveOn";
  else if ((j.intent === "explain" || j.intent === "answer") && q.sayMore && !pos.more && words < script.shortWords) (stay = "more"), (kind = "more");
  else kind = notAnswer ? toKai : "answered";
  // a question that asks for an explanation and got none ("I don't know", or still no answer after asking again) comes
  // back once at the end ("anything else?" doesn't)
  const unanswered = !stay && !pos.back && q.sayMore && (j.intent === "unsure" || notAnswer);
  const skipped = unanswered ? [...pos.skipped, at] : pos.skipped;

  const timeUp = (input.elapsedMs ?? 0) >= script.minutes * 60_000;
  const nextPos = stay ? null : following(script, pos, skipped);
  const end = timeUp || state.turn >= CONFIG.maxTurns || (!stay && !nextPos);
  const why: ReadyReason | null = end ? (timeUp ? "time" : state.turn >= CONFIG.maxTurns ? "maxTurns" : "script") : null;
  if (end && kind === "answered") kind = "end";

  // the fixed part: the question (the same one, the next one, or one left unanswered), or the notes read back
  let tail: string;
  let move: Move;
  let nextId: string | null = null;
  if (end) {
    tail = readBack(script, state);
    move = { type: "wrapUp", node: null, seed: null };
    state = { ...state, done: true, script: pos };
  } else if (stay) {
    tail = stay === "more" ? L.sayMore : q.text;
    nextId = q.id;
    move = { type: "followUp", node: q.node, seed: tail, fact: null, cue: "again" };
    state = { ...state, script: { ...pos, more: pos.more || stay === "more", again: pos.again + (stay === "again" ? 1 : 0) } };
  } else {
    const nq = script.questions[nextPos!.at]!;
    tail = nextPos!.back ? `${L.back} ${nq.text}` : nq.text;
    nextId = nq.id;
    move = { type: "open", node: nq.node, seed: nq.text, fact: null };
    state = { ...state, focus: nq.node ?? state.focus, script: { at: nextPos!.at, more: false, again: 0, skipped: nextPos!.skipped, back: nextPos!.back } };
  }
  state = { ...state, last: { type: move.type, node: move.node, fact: null } };
  // Kai believes what it is told: a message that only taught a wrong belief leaves Kai content, not lost (a lost Kai
  // would tell the learner they were wrong, which the fixed questions never do)
  const judged = moodFor(bundle, input.state, state, j, move);
  const misled = (j.misconceptions ?? []).length > 0 && !j.facts.some((v) => v.verdict !== "wrong");
  const mood = judged === "confused" && misled ? "okay" : judged;
  // and its words take a wrong belief as gladly as a right one: "it clicked", never "I didn't follow" its words
  const feels = misled ? "great" : mood;

  // Kai's own words before it: from the notebook, no question, term-checked (one rewrite, then a fixed line)
  const history: Turn[] = [...input.history, { role: "learner", text: input.message }];
  const drafts: string[] = [];
  let leaked: string[] = [];
  let fallback = false;
  let lead = "";
  // the reaction is not what the turn is for: a writer that fails or times out leaves the fixed line
  const react = deps.react && ((avoid: string[]) => deps.react!(bundle, state, kind, history, end ? null : tail, feels, avoid).catch(() => ((fallback = true), "")));
  if (react) {
    lead = await react([]);
    drafts.push(lead);
    leaked = forbiddenTerms(bundle, state, lead);
    if (leaked.length) {
      lead = await react(leaked);
      drafts.push(lead);
      const again = forbiddenTerms(bundle, state, lead);
      if (again.length) (fallback = true), (lead = "");
      leaked = [...new Set([...leaked, ...again])];
    }
  }
  if (!lead) lead = fixedReaction(script, kind, echo);
  const reply = !lead ? tail : end ? `${lead}\n\n${tail}` : `${lead} ${tail}`;

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
      leaked,
      fallback,
      readyReason: why,
      drafts,
      script: { asked: q.id, next: nextId, sayMore: stay === "more", back: !stay && !end && nextPos!.back, reaction: kind },
    },
  };
}
