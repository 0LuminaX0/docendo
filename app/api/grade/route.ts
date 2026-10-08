import type { NextRequest } from "next/server";
import { z } from "zod";
import { exercises } from "@/lib/server/content";
import { clientIp, fail, ok, readBody, sameOrigin } from "@/lib/server/http";
import { limitAll } from "@/lib/server/limit";
import { verifyToken } from "@/lib/server/token";
import { record } from "@/lib/server/events";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const Body = z.object({
  token: z.string().max(400),
  answers: z.array(z.number().int().min(0).max(9).nullable()).length(exercises.length),
});

/** Grade the exercises on the server, so the answers never ship to the browser. */
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

  const items = exercises.map((q, i) => ({
    id: q.id,
    chosen: body.data.answers[i] ?? null,
    answer: q.answer,
    correct: body.data.answers[i] === q.answer,
    explain: q.explain,
  }));
  const score = items.filter((x) => x.correct).length;
  record({ t: "grade", sid: session.sid, score, of: items.length, answers: body.data.answers, items: items.map((x) => ({ id: x.id, chosen: x.chosen, answer: x.answer, correct: x.correct })) });
  return ok({ score, of: items.length, items });
}
