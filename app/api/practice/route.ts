import type { NextRequest } from "next/server";
import { z } from "zod";
import { checkPractice, practice } from "@/lib/server/content";
import { parseNumber } from "@/content/practice";
import { clientIp, fail, ok, readBody, sameOrigin } from "@/lib/server/http";
import { limitAll } from "@/lib/server/limit";
import { verifyToken } from "@/lib/server/token";
import { record } from "@/lib/server/events";
import { momentsFor } from "@/lib/server/moments";
import { config } from "@/lib/server/env";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const Body = z.discriminatedUnion("action", [
  z.object({
    token: z.string().max(400),
    action: z.literal("check"),
    id: z.string().max(20),
    answer: z.union([z.string().max(40), z.number()]),
    attempt: z.number().int().min(1).max(20),
    work: z.string().max(4000).optional(),
    msOnProblem: z.number().int().min(0).max(24 * 3600_000).optional(),
  }),
  z.object({ token: z.string().max(400), action: z.literal("hint"), id: z.string().max(20) }),
]);

/**
 * Practice chapter: check an answer (a first try and one retry per problem) or
 * find the lesson moment to rewatch. Answers and worked solutions stay here; the
 * solutions go out with the graded final test (/api/grade).
 */
export async function POST(req: NextRequest) {
  if (!sameOrigin(req)) return fail(403, "Requests from other sites are not allowed.");
  const body = Body.safeParse(await readBody(req, 10_000));
  if (!body.success) return fail(400, "Bad request.");
  const session = verifyToken(body.data.token);
  if (!session) return fail(401, "Your session has expired. Start again from the first page.", { expired: true });
  const r = await limitAll([
    // no model calls here, so per-instance limits are enough
    [`practice:sidmin:${session.sid}`, 30, 60, "local"],
    [`practice:sid:${session.sid}`, 400, 6 * 3600, "local"],
    [`practice:ip:${clientIp(req)}`, 600, 60, "local"],
  ]);
  if (!r.ok) {
    record({ t: "practice_limited", sid: session.sid, id: body.data.id });
    return fail(429, "Too many tries in a short time. Wait a moment.", { retryAfter: r.retryAfter });
  }

  const item = practice.find((p) => p.id === body.data.id);
  if (!item) return fail(404, "Unknown problem.");

  // research log: every try, with the learner's working
  if (body.data.action === "check") {
    // an answer that isn't a number doesn't use up a try
    if (item.kind === "number" && typeof body.data.answer === "string" && parseNumber(body.data.answer) === null)
      return fail(400, "Type a number, for example 120 or 0.85.");
    // the browser counts the tries; this per-instance count backs it up
    const tries = await limitAll([[`practice:try:${session.sid}:${item.id}`, config.practiceTries, 6 * 3600, "local"]]);
    if (!tries.ok || body.data.attempt > config.practiceTries) {
      record({ t: "practice_no_tries", sid: session.sid, id: item.id, attempt: body.data.attempt });
      return fail(409, "No tries left for this problem. Go on to the next one.");
    }
    const correct = checkPractice(item, body.data.answer);
    record({
      t: "practice_check",
      sid: session.sid,
      condition: session.cond,
      id: item.id,
      round: item.round,
      kind: item.kind,
      attempt: body.data.attempt,
      answer: String(body.data.answer).slice(0, 40),
      correct,
      work: body.data.work ?? "",
      workChars: body.data.work?.length ?? 0,
      msOnProblem: body.data.msOnProblem ?? null,
    });
    return ok({ correct });
  }
  // the help: the lesson moments that explain the facts this problem needs, no answer
  const moments = momentsFor([...new Set(item.steps.flatMap((s) => s.facts))]);
  record({ t: "practice_hint", sid: session.sid, id: item.id, moments: moments.map((m) => `${m.video}@${Math.round(m.start)}`) });
  return ok({ moments });
}
