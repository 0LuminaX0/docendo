import type { NextRequest } from "next/server";
import { z } from "zod";
import { config } from "@/lib/server/env";
import { bundle } from "@/lib/server/content";
import { clientIp, fail, ok, readBody, sameOrigin } from "@/lib/server/http";
import { limitAll } from "@/lib/server/limit";
import { verifyToken } from "@/lib/server/token";
import { MESSAGE_MAX, State } from "@/engine/tutor/state";
import { takeTurn, type Deps } from "@/engine/tutor/turn";
import { llmJudge, mockJudge } from "@/engine/tutor/judge";
import { factScore, latest } from "@/engine/tutor/state";
import type { LlmCall } from "@/engine/llm";
import { record } from "@/lib/server/events";
import { llmWrite, mockWrite } from "@/engine/tutor/writer";

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
});

/** Kai's judge and writer for one request; every model call is collected for the log. */
function depsFor(calls: LlmCall[]): Deps {
  const onCall = (c: LlmCall) => calls.push(c);
  return config.demo
    ? {
        judge: async (b, m) => mockJudge(b, m),
        write: async (b, s, move, _h, mood) => mockWrite(b, s, move, mood),
      }
    : {
        judge: (b, m, kai) => llmJudge(b, m, kai, onCall),
        write: (b, s, move, h, mood, avoid) => llmWrite(b, s, move, h, avoid, mood, onCall),
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
  const r = await limitAll([
    // bursts: per server instance is enough; the shared checks below are what protect the model budget
    [`chat:sidmin:${session.sid}`, config.sessionTurnsPerMin, 60, "local"], // one learner's burst
    [`chat:ip:${ip}`, config.ipTurnsPerMin, 60, "local"], // one network (generous: a lab room shares an IP)
    [`chat:sid:${session.sid}`, config.sessionTurnLimit, config.sessionHours * 3600], // one learner, whole session (shared)
    ...(config.demo ? [] : ([["chat:global", config.dailyTurnLimit, 86_400]] as [string, number, number][])), // the whole site
  ]);
  if (!r.ok) {
    record({ t: "chat_limited", sid: session.sid, turn: body.data.state.turn, retryAfter: r.retryAfter });
    return fail(429, "Kai needs a short break: too many messages right now. Try again in a moment.", { retryAfter: r.retryAfter }, { "Retry-After": String(r.retryAfter) });
  }

  const calls: LlmCall[] = [];
  const t0 = Date.now();
  const { message, state: before, elapsedMs } = body.data;
  try {
    const result = await takeTurn(bundle, { message, history: body.data.history.slice(-20), state: before, elapsedMs }, depsFor(calls));
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
      focusBefore: before.focus,
      focusAfter: result.state.focus,
      judged: tr.judged,
      misconceptions: tr.misconceptions,
      newCorrect: tr.judged.filter((v) => v.verdict === "correct" && old.get(v.fact)?.verdict !== "correct").map((v) => v.fact),
      dropped: tr.dropped ?? [],
      leaked: tr.leaked,
      fallback: tr.fallback,
      progress: result.progress,
      score: { correct: score.correct, partial: score.partial, total: score.total, value: score.score },
      nodes: Object.fromEntries(result.mind.nodes.map((n) => [n.id, n.status])),
      done: result.done,
      readyReason: tr.readyReason,
      helpAvailable: result.helpAvailable,
      llm: calls,
      latencyMs: Date.now() - t0,
    });
    if (result.done)
      record({ t: "notebook_snapshot", sid: session.sid, source: "server", reason: "kai_ready", readyReason: tr.readyReason, turn: result.state.turn, notebook: result.state.notebook, misconceptions: result.state.misconceptions });
    const { trace: _trace, ...visible } = result;
    return ok({ ...visible, demo: config.demo });
  } catch (e) {
    const error = e instanceof Error ? e.message.slice(0, 300) : String(e);
    record({ t: "chat_error", sid: session.sid, turn: before.turn, message, error, llm: calls, latencyMs: Date.now() - t0 });
    return fail(502, "Kai lost its train of thought. Send your message again.");
  }
}
