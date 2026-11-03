import type { NextRequest } from "next/server";
import { z } from "zod";
import { config } from "@/lib/server/env";
import { packFor } from "@/lib/server/content";
import { clientIp, fail, ok, readBody, sameOrigin } from "@/lib/server/http";
import { limitAll } from "@/lib/server/limit";
import { verifyToken } from "@/lib/server/token";
import { MESSAGE_MAX, State } from "@/engine/tutor/state";
import { takeTurn, type Deps } from "@/engine/tutor/turn";
import { takeScriptTurn, type ScriptTrace } from "@/engine/tutor/script";
import { llmJudge, mockJudge } from "@/engine/tutor/judge";
import { factScore, latest, progress } from "@/engine/tutor/state";
import { CONFIG } from "@/engine/tutor/policy";
import { mindView } from "@/engine/tutor/mind";
import { COPIED_RUN } from "@/lib/lesson";
import type { LlmCall } from "@/engine/llm";
import { record } from "@/lib/server/events";
import { getSettings } from "@/lib/server/settings";
import { llmReact, llmWrite, mockWrite } from "@/engine/tutor/writer";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const Body = z.object({
  token: z.string().max(400),
  message: z.string().trim().min(1).max(MESSAGE_MAX),
  history: z.array(z.object({ role: z.enum(["kai", "learner"]), text: z.string().max(MESSAGE_MAX + 100) })).max(80),
  state: State,
  elapsedMs: z.number().int().min(0).max(24 * 3600_000).optional(), // time since the teach page opened (client clock)
  composeMs: z.number().int().min(0).max(24 * 3600_000).optional(), // first keystroke to send, for the log
  pastedChars: z.number().int().min(0).max(100_000).optional(),
  dictatedChars: z.number().int().min(0).max(100_000).optional(), // spoken (voice input), then perhaps edited
});

/** The model account is out of credits (or its in-flight budget): resending won't help. */
const outOfCredits = (e: unknown) => e instanceof Error && /OpenRouter 402\b/.test(e.message);

/**
 * Kai's judge and writer for one request; every model call is collected for the
 * log. If the model account runs out of credits mid-study, the turn falls back
 * to the offline judge and writer rather than breaking the session (logged as
 * `degraded`); other errors still fail the turn so the learner can resend.
 */
function depsFor(calls: LlmCall[], degraded: string[]): Deps {
  const onCall = (c: LlmCall) => calls.push(c);
  if (config.demo)
    return {
      judge: async (b, m) => mockJudge(b, m),
      write: async (b, s, move, _h, mood) => mockWrite(b, s, move, mood),
    };
  return {
    judge: (b, m, kai) =>
      llmJudge(b, m, kai, onCall).catch((e) => {
        if (!outOfCredits(e)) throw e;
        degraded.push("judge");
        return mockJudge(b, m);
      }),
    write: (b, s, move, h, mood, avoid) =>
      llmWrite(b, s, move, h, avoid, mood, onCall).catch((e) => {
        if (!outOfCredits(e)) throw e;
        degraded.push("writer");
        return mockWrite(b, s, move, mood);
      }),
    // with the fixed questions; out of credits, the script's fixed line instead
    react: (b, s, kind, h, next, mood, avoid) =>
      llmReact(b, s, kind, h, next, avoid, mood, onCall).catch((e) => {
        if (!outOfCredits(e)) throw e;
        degraded.push("writer");
        return "";
      }),
  };
}

export async function POST(req: NextRequest) {
  if (!sameOrigin(req)) return fail(403, "Requests from other sites are not allowed.");
  const raw = await readBody(req, 500_000);
  const body = Body.safeParse(raw);
  if (!body.success) return fail(400, "Bad request.");
  const session = verifyToken(body.data.token);
  if (!session) return fail(401, "Your session has expired. Start again from the first page.", { expired: true });
  if (body.data.state.done) return fail(409, "Kai is already done. Continue to the exercises.");

  const ip = clientIp(req);
  const { settings } = await getSettings();
  const pack = packFor(session.topic); // the topic the session started with
  const { bundle } = pack;
  const r = await limitAll([
    // bursts: per server instance is enough; the shared checks below are what protect the model budget
    [`chat:sidmin:${session.sid}`, config.sessionTurnsPerMin, 60, "local"], // one learner's burst
    [`chat:ip:${ip}`, config.ipTurnsPerMin, 60, "local"], // one network (generous: a lab room shares an IP)
    [`chat:sid:${session.sid}`, config.sessionTurnLimit, config.sessionHours * 3600], // one learner, whole session (shared)
    ...(config.demo ? [] : ([["chat:global", settings.dailyTurnLimit, 86_400]] as [string, number, number][])), // the whole site
  ]);
  if (!r.ok) {
    record({ t: "chat_limited", sid: session.sid, turn: body.data.state.turn, retryAfter: r.retryAfter });
    return fail(429, "Kai needs a short break: too many messages right now. Try again in a moment.", { retryAfter: r.retryAfter }, { "Retry-After": String(r.retryAfter) });
  }

  const calls: LlmCall[] = [];
  const t0 = Date.now();
  const { message, state: before, elapsedMs } = body.data;
  // teaching's time limit (Study setup): the page closes the chat when it runs out; a message long after it is refused
  if ((elapsedMs ?? 0) > settings.teach.minutes * 60_000 + 90_000 && session.entry !== "team") return fail(409, "Time's up for teaching. Go on to the next step.");
  // a text lesson: how much of the message comes word for word from it (logged with every turn)
  const overlap = pack.lessonOverlap ? pack.lessonOverlap(message) : null;
  if (pack.lesson && overlap && overlap.longest >= COPIED_RUN) {
    // copied from the text: Kai asks for the learner's own words, judges nothing and writes nothing down; the message
    // still counts towards Kai's limit of messages
    const state = { ...before, turn: before.turn + 1 };
    const reply = pack.lesson.copied;
    const score = factScore(bundle, state);
    record({
      t: "chat_turn",
      sid: session.sid,
      demo: config.demo,
      turn: state.turn,
      elapsedMs: elapsedMs ?? null,
      composeMs: body.data.composeMs ?? null,
      pastedChars: body.data.pastedChars ?? 0,
      dictatedChars: body.data.dictatedChars ?? 0,
      overlap,
      copied: true,
      message,
      chars: message.length,
      words: message.split(/\s+/).filter(Boolean).length,
      kaiBefore: [...body.data.history].reverse().find((h) => h.role === "kai")?.text ?? null,
      reply,
      replyChars: reply.length,
      drafts: [],
      mood: "confused",
      kaiHappy: false,
      intent: "copied",
      move: { type: "copied", node: before.focus, fact: null, closure: null, cue: null, seed: null, then: null },
      focusBefore: before.focus,
      focusAfter: before.focus,
      judged: [],
      misconceptions: [],
      newCorrect: [],
      dropped: [],
      notesDropped: [],
      leaked: [],
      fallback: false,
      progress: Math.min(1, progress(bundle, state) / CONFIG.ready),
      score: { correct: score.correct, partial: score.partial, total: score.total, value: score.score },
      done: false,
      readyReason: null,
      helpAvailable: false,
      llm: [],
      degraded: [],
      latencyMs: Date.now() - t0,
    });
    return ok({ reply, mood: "confused", state, progress: Math.min(1, progress(bundle, state) / CONFIG.ready), mind: mindView(bundle, state), done: false, help: null, helpAvailable: false, demo: config.demo });
  }
  try {
    const degraded: string[] = [];
    const input = { message, history: body.data.history.slice(-20), state: before, elapsedMs, minutes: settings.teach.minutes };
    // Kai's fixed questions when the pack has them (and the session started with them); otherwise Kai chooses its own
    const result = pack.script && before.script ? await takeScriptTurn(bundle, pack.script, input, depsFor(calls, degraded)) : await takeTurn(bundle, input, depsFor(calls, degraded));
    const scripted = "script" in result.trace ? (result.trace as { script: ScriptTrace }).script : null;
    // Kai's help card: with a text lesson, the section about the idea Kai is asking about (its text only once help is
    // open, after an attempt); with videos, the moment if it lies in the lesson as currently set up (Settings: parts)
    const help = !settings.watch.on || !settings.tools.help ? null : pack.lesson ? (result.done ? null : pack.passageFor(result.state.focus, result.helpAvailable)) : pack.helpInLesson(result.help, settings.watch.parts);
    const tr = result.trace;
    const old = latest(before);
    const score = factScore(bundle, result.state);
    // research log: the whole exchange and every decision behind it
    record({
      t: "chat_turn",
      sid: session.sid,
      demo: config.demo,
      turn: result.state.turn,
      elapsedMs: elapsedMs ?? null,
      composeMs: body.data.composeMs ?? null,
      pastedChars: body.data.pastedChars ?? 0,
      dictatedChars: body.data.dictatedChars ?? 0,
      overlap, // a text lesson: the message's longest run of words from the text, and its words in shared runs of 8 or more
      message,
      chars: message.length,
      words: message.split(/\s+/).filter(Boolean).length,
      kaiBefore: [...body.data.history].reverse().find((h) => h.role === "kai")?.text ?? null,
      reply: result.reply,
      replyChars: result.reply.length,
      drafts: tr.drafts,
      mood: result.mood,
      kaiHappy: result.mood === "great" || result.mood === "okay",
      intent: tr.intent,
      move: { type: tr.move.type, node: tr.move.node, fact: tr.move.fact ?? null, closure: tr.move.closure ?? null, cue: tr.move.cue ?? null, seed: tr.move.seed, then: tr.move.then ? { type: tr.move.then.type, node: tr.move.then.node, fact: tr.move.then.fact ?? null } : null },
      script: scripted, // fixed questions: the one answered, the next one (null: Kai wrapped up), and whether Kai asked to say more
      focusBefore: before.focus,
      focusAfter: result.state.focus,
      judged: tr.judged,
      misconceptions: tr.misconceptions,
      newCorrect: tr.judged.filter((v) => v.verdict === "correct" && old.get(v.fact)?.verdict !== "correct").map((v) => v.fact),
      dropped: tr.dropped ?? [],
      notesDropped: tr.notesDropped ?? [], // whole-sentence notes the note check refused (the bare quote was kept)
      leaked: tr.leaked,
      fallback: tr.fallback,
      progress: result.progress,
      score: { correct: score.correct, partial: score.partial, total: score.total, value: score.score },
      nodes: Object.fromEntries(result.mind.nodes.map((n) => [n.id, n.status])),
      done: result.done,
      readyReason: tr.readyReason,
      helpAvailable: result.helpAvailable && !!help,
      llm: calls,
      degraded, // parts that fell back offline because the model account was out of credits
      latencyMs: Date.now() - t0,
    });
    if (result.done)
      record({ t: "notebook_snapshot", sid: session.sid, source: "server", reason: "kai_ready", readyReason: tr.readyReason, turn: result.state.turn, notebook: result.state.notebook, misconceptions: result.state.misconceptions });
    const { trace: _trace, ...visible } = result;
    return ok({ ...visible, help, helpAvailable: visible.helpAvailable && !!help, demo: config.demo });
  } catch (e) {
    const error = e instanceof Error ? e.message.slice(0, 300) : String(e);
    record({ t: "chat_error", sid: session.sid, turn: before.turn, message, error, llm: calls, latencyMs: Date.now() - t0 });
    return fail(502, "Kai lost its train of thought. Send your message again.");
  }
}
