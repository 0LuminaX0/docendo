import type { NextRequest } from "next/server";
import { z } from "zod";
import { checkPractice, practice } from "@/lib/server/content";
import { clientIp, fail, ok, readBody, sameOrigin } from "@/lib/server/http";
import { limitAll } from "@/lib/server/limit";
import { verifyToken } from "@/lib/server/token";
import { record } from "@/lib/server/events";
import { momentsFor } from "@/lib/server/moments";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const Body = z.discriminatedUnion("action", [
  z.object({ token: z.string().max(400), action: z.literal("check"), id: z.string().max(20), answer: z.union([z.string().max(40), z.number()]), work: z.string().max(4000).optional() }),
  z.object({ token: z.string().max(400), action: z.literal("solution"), id: z.string().max(20) }),
  z.object({ token: z.string().max(400), action: z.literal("hint"), id: z.string().max(20) }),
]);

/**
 * Practice chapter: check an answer (as often as the learner likes) or reveal the
 * worked solution. Answers and solutions stay here until asked for, like the test's.
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

  // research log (Vercel function logs): what was tried and when solutions were opened
  if (body.data.action === "check") {
    const correct = checkPractice(item, body.data.answer);
    record({ t: "practice_check", sid: session.sid, id: item.id, kind: item.kind, answer: String(body.data.answer).slice(0, 40), correct, work: body.data.work ?? "", workChars: body.data.work?.length ?? 0 });
    return ok({ correct });
  }
  if (body.data.action === "hint") {
    // first level of help: the lesson moments that explain the facts this problem needs, no answer
    const moments = momentsFor([...new Set(item.steps.flatMap((s) => s.facts))]);
    record({ t: "practice_hint", sid: session.sid, id: item.id, moments: moments.map((m) => `${m.video}@${Math.round(m.start)}`) });
    return ok({ moments });
  }
  record({ t: "practice_solution", sid: session.sid, id: item.id });
  return ok({ steps: item.steps.map((s) => s.text), answer: item.kind === "choice" ? item.options![item.answer]! : `${item.answer}${item.unit ? ` ${item.unit}` : ""}` });
}
