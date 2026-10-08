import type { NextRequest } from "next/server";
import { z } from "zod";
import { exercises, practiceReview, pretest } from "@/lib/server/content";
import { clientIp, fail, ok, readBody, sameOrigin } from "@/lib/server/http";
import { limitAll } from "@/lib/server/limit";
import { verifyToken } from "@/lib/server/token";
import { record } from "@/lib/server/events";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const Body = z.union([
  z.object({ token: z.string().max(400), kind: z.literal("pretest"), answers: z.array(z.number().int().min(0).max(9)).length(pretest.length) }),
  z.object({ token: z.string().max(400), kind: z.literal("test").optional(), answers: z.array(z.number().int().min(0).max(9).nullable()).length(exercises.length) }),
]);

/**
 * Grade on the server, so the answers never ship to the browser: the final test
 * (results go back) or the pretest (recorded only; nothing is shown back).
 */
export async function POST(req: NextRequest) {
  if (!sameOrigin(req)) return fail(403, "Requests from other sites are not allowed.");
  const body = Body.safeParse(await readBody(req, 5_000));
  if (!body.success) return fail(400, "Bad request.");
  const session = verifyToken(body.data.token);
  if (!session) return fail(401, "Your session has expired. Start again from the first page.", { expired: true });
  const r = await limitAll([
    [`grade:ip:${clientIp(req)}`, 30, 3600],
    [`grade:sid:${session.sid}`, 5, 6 * 3600],
  ]);
  if (!r.ok) return fail(429, "Too many attempts. Try again later.", { retryAfter: r.retryAfter });

  if (body.data.kind === "pretest") {
    const a = body.data.answers;
    const knowledge = pretest.map((q, i) => ({ q, a: a[i]! })).filter((x) => x.q.kind === "knowledge");
    const score = knowledge.filter((x) => x.a === x.q.answer).length;
    const dontKnow = knowledge.filter((x) => x.q.options[x.a] === "I don't know").length;
    const excluded = pretest.some((q, i) => q.exclude !== undefined && a[i] === q.exclude);
    const answers = Object.fromEntries(pretest.map((q, i) => [q.id, a[i]!]));
    record({ t: "pretest", sid: session.sid, condition: session.cond, pid: session.pid, answers, score, of: knowledge.length, dontKnow, excluded });
    return ok({ ok: true });
  }

  const items = exercises.map((q, i) => ({
    id: q.id,
    chosen: body.data.answers[i] ?? null,
    answer: q.answer,
    correct: body.data.answers[i] === q.answer,
    explain: q.explain,
  }));
  const score = items.filter((x) => x.correct).length;
  record({ t: "grade", sid: session.sid, condition: session.cond, pid: session.pid, score, of: items.length, answers: body.data.answers, items: items.map((x) => ({ id: x.id, chosen: x.chosen, answer: x.answer, correct: x.correct })) });
  // the test is done: now the practice problems' worked solutions can be shown too
  return ok({ score, of: items.length, items, practice: practiceReview });
}
