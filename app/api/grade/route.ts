import type { NextRequest } from "next/server";
import { z } from "zod";
import { checkExercise, formItems, keyText, practiceReview, pretest, publicExercises, testVersion } from "@/lib/server/content";
import { clientIp, fail, ok, readBody, sameOrigin } from "@/lib/server/http";
import { limitAll } from "@/lib/server/limit";
import { verifyToken } from "@/lib/server/token";
import { record } from "@/lib/server/events";
import { markTest } from "@/lib/server/participants";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ITEMS = 10; // each form's length (checked against the content in tests/practice.test.ts)
// the delayed test asks first whether the learner has looked at the topic since: a confound for a delayed measure
const SINCE = ["no", "a little", "a lot"] as const;

const Body = z.union([
  z.object({ token: z.string().max(400), kind: z.literal("pretest"), answers: z.array(z.number().int().min(0).max(9)).length(pretest.length) }),
  // the session's test questions (its own form only, without answers)
  z.object({ token: z.string().max(400), kind: z.literal("items") }),
  z.object({
    token: z.string().max(400),
    kind: z.literal("test").optional(),
    // an option's index, or a typed number (as typed), in the form's file order
    answers: z.array(z.union([z.number().int().min(0).max(9), z.string().max(40)]).nullable()).length(ITEMS),
    work: z.record(z.string().max(10), z.string().max(2_000)).optional(), // the learner's working per question, for the log
    order: z.array(z.string().max(10)).max(ITEMS).optional(), // the order the learner saw the items in
    since: z.enum(SINCE).optional(), // delayed test: studied the topic since the session?
  }),
]);

/**
 * Grade on the server, so the answers never ship to the browser: the final test or the delayed test (results go
 * back), or the pretest (recorded only; nothing is shown back). Each session takes its own form (A or B, in the token).
 */
export async function POST(req: NextRequest) {
  if (!sameOrigin(req)) return fail(403, "Requests from other sites are not allowed.");
  const body = Body.safeParse(await readBody(req, 30_000));
  if (!body.success) return fail(400, "Bad request.");
  const session = verifyToken(body.data.token);
  if (!session) return fail(401, "Your session has expired. Start again from the first page.", { expired: true });

  if (body.data.kind === "items") {
    const r = await limitAll([[`items:sid:${session.sid}`, 30, 3600, "local"]]);
    if (!r.ok) return fail(429, "Too many requests. Try again later.");
    return ok({ items: publicExercises(session.form), form: session.form, phase: session.phase });
  }

  const r = await limitAll([
    [`grade:ip:${clientIp(req)}`, 30, 3600],
    [`grade:sid:${session.sid}`, 5, 6 * 3600],
  ]);
  if (!r.ok) return fail(429, "Too many attempts. Try again later.", { retryAfter: r.retryAfter });

  if (body.data.kind === "pretest") {
    if (session.phase === "delayed") return fail(400, "Bad request.");
    const a = body.data.answers;
    const knowledge = pretest.map((q, i) => ({ q, a: a[i]! })).filter((x) => x.q.kind === "knowledge");
    const score = knowledge.filter((x) => x.a === x.q.answer).length;
    const dontKnow = knowledge.filter((x) => x.q.options[x.a] === "I don't know").length;
    const excluded = pretest.some((q, i) => q.exclude !== undefined && a[i] === q.exclude);
    const answers = Object.fromEntries(pretest.map((q, i) => [q.id, a[i]!]));
    record({ t: "pretest", sid: session.sid, condition: session.cond, pid: session.pid, answers, score, of: knowledge.length, dontKnow, excluded });
    return ok({ ok: true });
  }

  const answers = "answers" in body.data ? body.data.answers : [];
  const form = formItems(session.form);
  const items = form.map((q, i) => {
    const a = answers[i] ?? null;
    // a choice item takes an index, a number item a typed string: anything else counts as unanswered
    const chosen = q.kind === "choice" ? (typeof a === "number" ? a : null) : typeof a === "string" && a.trim() ? a.trim() : null;
    return { id: q.id, kind: q.kind, chosen, answer: q.answer, key: keyText(q), correct: checkExercise(q, chosen), explain: q.explain };
  });
  const score = items.filter((x) => x.correct).length;
  const work = "work" in body.data ? body.data.work : undefined;
  const order = "order" in body.data ? body.data.order : undefined;
  const since = "since" in body.data ? (body.data.since ?? null) : null;
  const pos = (id: string) => (order && order.length === form.length ? order.indexOf(id) + 1 || null : null);
  record({
    t: "grade",
    sid: session.sid,
    condition: session.cond,
    pid: session.pid,
    phase: session.phase, // main: the final test; delayed: the follow-up test
    form: session.form,
    version: testVersion(session.form),
    ...(session.phase === "delayed" ? { since } : {}),
    score,
    of: items.length,
    answers: items.map((x) => x.chosen),
    order: order ?? null,
    items: items.map((x) => ({ id: x.id, kind: x.kind, pos: pos(x.id), chosen: x.chosen, answer: x.answer, correct: x.correct, work: work?.[x.id] ?? null })),
  });
  if (session.pid && session.entry === "participant") await markTest(session.pid, session.phase).catch(() => {});
  // the final test is done: now the practice problems' worked solutions can be shown too (not after the delayed test)
  return ok({ score, of: items.length, items, ...(session.phase === "main" ? { practice: practiceReview } : {}) });
}
