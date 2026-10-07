import type { NextRequest } from "next/server";
import { z } from "zod";
import { config } from "@/lib/server/env";
import { bundle } from "@/lib/server/content";
import { clientIp, fail, ok, readBody, sameOrigin } from "@/lib/server/http";
import { limitAll } from "@/lib/server/limit";
import { verifyToken } from "@/lib/server/token";
import { State } from "@/engine/tutor/state";
import { takeTurn, type Deps } from "@/engine/tutor/turn";
import { llmJudge, mockJudge } from "@/engine/tutor/judge";
import { llmWrite, mockWrite } from "@/engine/tutor/writer";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const Body = z.object({
  token: z.string().max(400),
  message: z.string().trim().min(1).max(1200),
  history: z.array(z.object({ role: z.enum(["kai", "learner"]), text: z.string().max(1500) })).max(80),
  state: State,
});

const deps: Deps = config.demo
  ? {
      judge: async (b, m) => mockJudge(b, m),
      write: async (b, s, move, _h, mood) => mockWrite(b, s, move, mood),
    }
  : {
      judge: (b, m, kai) => llmJudge(b, m, kai),
      write: (b, s, move, h, mood, avoid) => llmWrite(b, s, move, h, avoid, mood),
    };

export async function POST(req: NextRequest) {
  if (!sameOrigin(req)) return fail(403, "Requests from other sites are not allowed.");
  const raw = await readBody(req, 200_000);
  const body = Body.safeParse(raw);
  if (!body.success) return fail(400, "Bad request.");
  const session = verifyToken(body.data.token);
  if (!session) return fail(401, "Your session has expired. Start again from the first page.", { expired: true });
  if (body.data.state.done) return fail(409, "Kai is already done. Continue to the exercises.");

  const ip = clientIp(req);
  const r = await limitAll([
    [`chat:sidmin:${session.sid}`, config.sessionTurnsPerMin, 60], // one learner's burst
    [`chat:ip:${ip}`, config.ipTurnsPerMin, 60], // one network (generous: a lab room shares an IP)
    [`chat:sid:${session.sid}`, config.sessionTurnLimit, config.sessionHours * 3600], // one learner, whole session
    ...(config.demo ? [] : ([["chat:global", config.dailyTurnLimit, 86_400]] as [string, number, number][])), // the whole site
  ]);
  if (!r.ok)
    return fail(429, "Kai needs a short break: too many messages right now. Try again in a moment.", { retryAfter: r.retryAfter }, { "Retry-After": String(r.retryAfter) });

  try {
    const result = await takeTurn(bundle, { message: body.data.message, history: body.data.history.slice(-20), state: body.data.state }, deps);
    // research log (Vercel function logs): what was judged and decided, never the API key
    console.log(JSON.stringify({ t: "turn", sid: session.sid, turn: result.state.turn, move: result.trace.move.type, node: result.trace.move.node, fact: result.trace.move.fact ?? null, intent: result.trace.intent, judged: result.trace.judged.map((f) => `${f.fact}:${f.verdict}`), dropped: result.trace.dropped?.map((d) => d.fact), leaked: result.trace.leaked, fallback: result.trace.fallback, progress: Math.round(result.progress * 100) }));
    const { trace: _trace, ...visible } = result;
    return ok({ ...visible, demo: config.demo });
  } catch (e) {
    console.error(JSON.stringify({ t: "turn-error", sid: session.sid, error: e instanceof Error ? e.message.slice(0, 300) : String(e) }));
    return fail(502, "Kai lost its train of thought. Send your message again.");
  }
}
