import type { Bundle } from "../../content/schema";
import type { ScriptFile } from "../../content/pack";
import { forbiddenTerms } from "./admit";
import { CONFIG, type Move, type ReadyReason } from "./policy";
import { activeMisconceptions, initialState, latest, memo, notesOf, progress, type State } from "./state";
import { mindView } from "./mind";
import { applyJudgement, moodFor, type Deps, type TurnResult } from "./turn";
import type { Reaction, Turn } from "./writer";

// Kai's teaching questions (script.json): the same fixed texts for everyone, in the graph's order, instead of Kai
// choosing and wording its questions (policy.ts). The judge still reads every message and Kai's notebook fills as
// before. What Kai asks is fixed, word for word; which question comes next is a fixed rule over the notebook:
// - each question names the teachable facts it is there for (`targets`); one whose facts are all taught already is
//   skipped (logged as `covered`), so a learner is never asked what they have just explained;
// - after an answer, each target still missing (or only vaguely taught) gets its follow-up (`follow`), once; a short
//   answer that taught the facts gets none. A question without targets ("anything else?") never gets one;
// - a question naming a lesson term the learner hasn't used yet is skipped (the term check of Kai's free replies);
// - a question to Kai or a reply that isn't an answer gets the same question again, once; "I don't know", or a reply
//   that still isn't an answer, moves on, and that question comes back once after the last one if its facts are still
//   missing.
// Before the question Kai reacts in its own words (the writer, from the notebook only, with no question of its own and
// the same term check; offline, or when the check fails twice, a fixed line). Kai wraps up after the last question, at
// the first message after `minutes`, or after CONFIG.maxTurns messages, and then reads its notes back without judging.

export type Script = ScriptFile;
type Pos = NonNullable<State["script"]>;

/** A fresh session that follows the script: on its first question, about that question's idea. */
export function initialScriptState(bundle: Bundle, script: Script): State {
  const s = initialState(bundle);
  const q = script.questions[0]!;
  const focus = q.node ?? s.focus;
  return { ...s, focus, last: { type: "open", node: focus, fact: null }, script: { at: 0, more: false, again: 0, skipped: [], back: false, probe: null, probed: [], covered: [], repeats: 0, ids: idsOf(script) } };
}

/** The script's questions, as a session's state remembers them (the question ids in order). */
export const idsOf = (script: Script) => script.questions.map((q) => q.id).join(" ");

type Question = Script["questions"][number];
const taught = (state: State, f: string) => latest(state).get(f)?.verdict === "correct";
/** The learner has answered it: taught it, or said something wrong about it (Kai believes it, and doesn't ask again). */
const answered = (state: State, f: string) => taught(state, f) || latest(state).get(f)?.verdict === "wrong" || activeMisconceptions(state).some((m) => m.fact === f);
/** Every fact the question is there for is answered already. */
export const isCovered = (state: State, q: Question) => q.targets.length > 0 && q.targets.every((f) => answered(state, f));
/** A question the learner has already started on (said something about one of its facts, vaguely or in part, before Kai
 * got to it): Kai goes straight to the follow-up on what is still missing, instead of asking the whole question again
 * (2026-11-05: learners answered "is there ever a reason to pick what doesn't look best?" with ε-greedy's random picks,
 * and then "How does ε-greedy decide?" read as a repeat). */
const begunOn = (bundle: Bundle, script: Script, state: State, q: Question) =>
  q.targets.some((f) => latest(state).has(f) || activeMisconceptions(state).some((m) => m.fact === f))
    ? q.follow.find((f) => q.targets.includes(f.fact) && !answered(state, f.fact) && !untaught(bundle, script, state, f.text).length)
    : undefined;
/** Lesson terms in Kai's words that the learner hasn't used (or Kai hasn't written down), apart from the ones Kai knows. */
const untaught = (bundle: Bundle, script: Script, state: State, text: string) => {
  const known = new Set(script.known.map((t) => t.toLowerCase()));
  return forbiddenTerms(bundle, state, text).filter((t) => !known.has(t.toLowerCase()));
};

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
export function following(
  bundle: Bundle,
  script: Script,
  state: State,
  pos: Pos,
  skipped: number[],
): { next: { at: number; back: boolean; skipped: number[] } | null; covered: number[]; gated: number[] } {
  // covered: its facts are answered already; gated: it names a term the learner hasn't used yet (it waits at the back,
  // in case they use it later)
  const covered: number[] = [];
  const gated: number[] = [];
  const open = (i: number, back: boolean) => {
    const q = script.questions[i];
    if (!q) return false;
    if (isCovered(state, q)) return (covered.push(i), false);
    if (untaught(bundle, script, state, q.text).length > 0) return (back || gated.push(i), false);
    return true;
  };
  const queue = (rest: number[]) => [...rest, ...gated.filter((i) => !rest.includes(i))];
  if (!pos.back) for (let i = pos.at + 1; i < script.questions.length; i++) if (open(i, false)) return { next: { at: i, back: false, skipped: queue(skipped) }, covered, gated };
  const waiting = queue(skipped);
  for (let k = 0; k < waiting.length; k++) if (open(waiting[k]!, true)) return { next: { at: waiting[k]!, back: true, skipped: waiting.slice(k + 1) }, covered, gated };
  return { next: null, covered, gated };
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

// probe: the fact the next follow-up asks about; covered: questions skipped because their facts were taught already
// gated: questions waiting for a term the learner hasn't used; restart: the session was saved under other questions
export type ScriptTrace = { asked: string; next: string | null; sayMore: boolean; back: boolean; reaction: Reaction; probe: string | null; covered: string[]; gated: string[]; restart: boolean };

export async function takeScriptTurn(
  bundle: Bundle,
  script: Script,
  input: { message: string; history: Turn[]; state: State; elapsedMs?: number; minutes?: number }, // minutes: the study's limit (Infinity: none, the pilot's soft timing)
  deps: Pick<Deps, "judge" | "react">,
): Promise<TurnResult & { trace: TurnResult["trace"] & { script: ScriptTrace } }> {
  const kaiLast = [...input.history].reverse().find((t) => t.role === "kai")?.text ?? "";
  const j = await deps.judge(bundle, input.message, kaiLast);
  let state = applyJudgement(input.state, j);
  const saved = state.script;
  // a session saved under another version of the questions: its indices mean other questions, so it carries on from
  // the first question whose facts aren't answered yet (no follow-up or back queue from the old version)
  const restart = saved?.ids !== idsOf(script);
  const n = script.questions.length;
  const at = restart ? 0 : Math.min(saved?.at ?? 0, n - 1);
  const pos: Pos = restart
    ? { at: 0, more: false, again: 0, skipped: [], back: false, probe: null, probed: [], covered: [], repeats: 0, ids: idsOf(script) }
    : { at, more: saved?.more ?? false, again: saved?.again ?? 0, skipped: (saved?.skipped ?? []).filter((i) => i < n), back: saved?.back ?? false, probe: saved?.probe ?? null, probed: saved?.probed ?? [], covered: saved?.covered ?? [], repeats: saved?.repeats ?? 0, ids: saved?.ids };
  const q = script.questions[at]!;
  const L = script.lines;
  const words = input.message.split(/\s+/).filter(Boolean).length;
  const notes = wroteNow(state);
  const echo = notes.length ? L.wrote.replace("{notes}", listed(notes)) : null;
  // what is on the screen: the question, or its follow-up about one fact
  const asking = pos.probe ? (q.follow.find((f) => f.fact === pos.probe)?.text ?? q.text) : q.text;

  // what this reply does: ask the same again (after a reply that wasn't an answer), a follow-up on a fact still missing,
  // or go on
  const notAnswer = j.intent === "ask_kai" || j.intent === "off_topic";
  const toKai: Reaction = j.intent === "ask_kai" ? "askedKai" : "again";
  const isAnswer = j.intent === "explain" || j.intent === "answer";
  const probe = isAnswer && !restart ? q.follow.find((f) => q.targets.includes(f.fact) && !answered(state, f.fact) && !pos.probed.includes(f.fact) && !untaught(bundle, script, state, f.text).length) : undefined;
  let kind: Reaction;
  let stay: "more" | "again" | "probe" | "repeat" | null = null;
  if (notAnswer && pos.again < 1 && !restart) (stay = "again"), (kind = toKai);
  else if (j.intent === "unsure") kind = "unsure";
  else if (j.intent === "move_on") kind = "moveOn";
  else if (probe) (stay = "probe"), (kind = "answered");
  else if (isAnswer && q.sayMore && !q.targets.length && !pos.more && words < script.shortWords) (stay = "more"), (kind = "more");
  // "anything else?" again, while the answers give Kai something new to write down and no other question is waiting
  else if (isAnswer && !restart && q.again && notes.length > 0 && (pos.repeats ?? 0) < q.again.max && !following(bundle, script, state, pos, pos.skipped).next) (stay = "repeat"), (kind = "answered");
  else kind = notAnswer ? toKai : "answered";
  // a question that got no answer (still none after asking again) comes back once at the end, if its facts are still
  // missing ("anything else?" doesn't; "I don't know" is an answer, and asking it again only annoys)
  const unanswered = !restart && !stay && !pos.back && !pos.probe && q.targets.length > 0 && !isCovered(state, q) && notAnswer;
  const skipped = unanswered ? [...pos.skipped, at] : pos.skipped;

  const timeUp = (input.elapsedMs ?? 0) >= (input.minutes ?? script.minutes) * 60_000;
  const after = stay ? null : following(bundle, script, state, restart ? { ...pos, at: -1 } : pos, skipped);
  const nextPos = after?.next ?? null;
  const end = timeUp || state.turn >= CONFIG.maxTurns || (!stay && !nextPos);
  const why: ReadyReason | null = end ? (timeUp ? "time" : state.turn >= CONFIG.maxTurns ? "maxTurns" : "script") : null;
  if (end && kind === "answered") kind = "end";

  // the fixed part: the question (the same one, the next one, or one left unanswered), or the notes read back
  let tail: string;
  let move: Move;
  let nextId: string | null = null;
  let started: string | null = null;
  if (end) {
    tail = readBack(script, state);
    move = { type: "wrapUp", node: null, seed: null };
    state = { ...state, done: true, script: pos };
  } else if (stay === "probe") {
    tail = probe!.text;
    nextId = q.id;
    move = { type: "followUp", node: q.node, seed: tail, fact: probe!.fact };
    state = { ...state, script: { ...pos, again: 0, probe: probe!.fact, probed: [...pos.probed, probe!.fact] } };
  } else if (stay === "repeat") {
    tail = q.again!.text;
    nextId = q.id;
    move = { type: "followUp", node: q.node, seed: tail, fact: null };
    state = { ...state, script: { ...pos, again: 0, repeats: (pos.repeats ?? 0) + 1 } };
  } else if (stay) {
    tail = stay === "more" ? L.sayMore : asking;
    nextId = q.id;
    move = { type: "followUp", node: q.node, seed: tail, fact: pos.probe, cue: "again" };
    state = { ...state, script: { ...pos, more: pos.more || stay === "more", again: pos.again + (stay === "again" ? 1 : 0) } };
  } else {
    const nq = script.questions[nextPos!.at]!;
    // already started on: straight to the follow-up on what is still missing
    const begun = begunOn(bundle, script, state, nq);
    const text = begun?.text ?? nq.text;
    tail = nextPos!.back ? `${L.back} ${text}` : text;
    nextId = nq.id;
    started = begun?.fact ?? null;
    move = begun ? { type: "followUp", node: nq.node, seed: text, fact: begun.fact } : { type: "open", node: nq.node, seed: nq.text, fact: null };
    state = { ...state, focus: nq.node ?? state.focus, script: { ...pos, at: nextPos!.at, more: false, again: 0, skipped: nextPos!.skipped, back: nextPos!.back, probe: started, probed: started ? [...pos.probed, started] : pos.probed, repeats: 0, covered: [...new Set([...pos.covered, ...after!.covered])] } };
  }
  state = { ...state, last: { type: move.type, node: move.node, fact: null } };
  // Kai believes what it is told: a message that only taught a wrong belief leaves Kai content, not lost (a lost Kai
  // would tell the learner they were wrong, which the fixed questions never do)
  const judged = moodFor(bundle, input.state, state, j, move);
  const misled = (j.misconceptions ?? []).length > 0 && !j.facts.some((v) => v.verdict !== "wrong");
  // an answer that teaches nothing on the list (a true remark beyond it, an example, a comparison) isn't met with
  // "I'm not sure I follow": in the pilot Kai said that to "all options get chosen eventually, so the averages converge"
  const mood = judged === "confused" && (misled || isAnswer) ? "okay" : judged;
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
    leaked = untaught(bundle, script, state, lead);
    if (leaked.length) {
      lead = await react(leaked);
      drafts.push(lead);
      const again = untaught(bundle, script, state, lead);
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
      script: {
        asked: restart ? "(an earlier version's question)" : pos.probe ? `${q.id}:${pos.probe}` : q.id,
        next: nextId,
        sayMore: stay === "more",
        back: !stay && !end && nextPos!.back,
        reaction: kind,
        probe: stay === "probe" ? probe!.fact : started,
        covered: (after?.covered ?? []).map((i) => script.questions[i]!.id),
        gated: (after?.gated ?? []).map((i) => script.questions[i]!.id),
        restart,
      },
    },
  };
}
