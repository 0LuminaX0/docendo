import type { NextRequest } from "next/server";
import { z } from "zod";
import { gradeTest, keyText, otherForm, packFor } from "@/lib/server/content";
import { DONT_KNOW } from "@/lib/answers";
import { getSettings } from "@/lib/server/settings";
import { clientIp, fail, ok, readBody, sameOrigin } from "@/lib/server/http";
import { limitAll } from "@/lib/server/limit";
import { verifyToken } from "@/lib/server/token";
import { record } from "@/lib/server/events";
import { followUpOpens, getParticipant, markTest } from "@/lib/server/participants";
import { gradePretest } from "@/content/pretest";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ITEMS = 40; // at most, per session (both forms in a pilot; the session's own length is checked below)
// the delayed test asks first whether the learner has looked at the topic since: a confound for a delayed measure
const SINCE = ["no", "a little", "a lot"] as const;

const Body = z.union([
  z.object({ token: z.string().max(400), kind: z.literal("pretest"), answers: z.array(z.number().int().min(0).max(9)).max(ITEMS) }),
  // the session's test questions (its own form, or both forms in a pilot; without answers)
  z.object({ token: z.string().max(400), kind: z.literal("items") }),
  z.object({
    token: z.string().max(400),
    kind: z.literal("test").optional(),
    // in the order the server sent the items: an option's index, the statements ticked (multi), a typed number (as
    // typed), or "idk" (I don't know)
    answers: z.array(z.union([z.number().int().min(0).max(9), z.array(z.number().int().min(0).max(9)).max(6), z.string().max(40)]).nullable()).max(ITEMS),
    work: z.record(z.string().max(10), z.string().max(2_000)).optional(), // per question: the reason it asked for, or the learner's working
    order: z.array(z.string().max(10)).max(ITEMS).optional(), // the order the learner saw the items in
    since: z.enum(SINCE).optional(), // delayed test: studied the topic since the session?
    timedOut: z.boolean().optional(), // handed in by the time limit (unanswered questions count as unanswered)
  }),
  // the pretest by item id, with the sets the page showed, in order (the pilot takes every set; the array form above
  // is the first set's items in file order, from pages loaded before the sets)
  z.object({ token: z.string().max(400), kind: z.literal("pretest"), answers: z.record(z.string().max(20), z.number().int().min(0).max(9)), sets: z.array(z.string().max(20)).min(1).max(4), timedOut: z.boolean().optional() }),
]);

/**
 * Grade on the server, so the answers never ship to the browser: the final test or the delayed test (results go
 * back), or the pretest (recorded only; nothing is shown back). Each session takes its own form (A or B, in the token),
 * or in a pilot both forms, its own first (content/test.ts).
 */
export async function POST(req: NextRequest) {
  if (!sameOrigin(req)) return fail(403, "Requests from other sites are not allowed.");
  const body = Body.safeParse(await readBody(req, 30_000));
  if (!body.success) return fail(400, "Bad request.");
  const session = verifyToken(body.data.token);
  if (!session) return fail(401, "Your session has expired. Start again from the first page.", { expired: true });
  const pack = packFor(session.topic); // the topic the session started with

  if (body.data.kind === "items") {
    const r = await limitAll([[`items:sid:${session.sid}`, 30, 3600, "local"]]);
    if (!r.ok) return fail(429, "Too many requests. Try again later.");
    const forms = session.both ? [session.form, otherForm(session.form)] : [session.form];
    return ok({ items: pack.publicExercises(session.form, session.both), form: session.form, forms, phase: session.phase });
  }

  const r = await limitAll([
    [`grade:ip:${clientIp(req)}`, 30, 3600],
    [`grade:sid:${session.sid}`, 5, 6 * 3600],
  ]);
  if (!r.ok) return fail(429, "Too many attempts. Try again later.", { retryAfter: r.retryAfter });

  if (body.data.kind === "pretest") {
    if (session.phase === "delayed") return fail(400, "Bad request.");
    const b = body.data;
    // by item id with its sets, or (older pages) one answer per item of the first set, in file order
    const raw = Array.isArray(b.answers) ? (b.answers.length === pack.pretest.length ? Object.fromEntries(pack.pretest.map((q, i) => [q.id, (b.answers as number[])[i]!])) : null) : b.answers;
    // timedOut: the time limit ran out, so some questions may be unanswered
    const timedOut = "timedOut" in b && !!b.timedOut;
    const g = raw ? gradePretest(pack.pretestAll, raw, "sets" in b ? b.sets : pack.pretestSets.slice(0, 1), timedOut) : null;
    if (!g) return fail(400, "Bad request.");
    // sets: the knowledge sets in the order taken (a pilot: every set); setScores: right of asked, per set
    record({ t: "pretest", sid: session.sid, condition: session.cond, pid: session.pid, version: pack.pretestVersion, answers: g.answers, sets: g.sets, score: g.score, of: g.of, setScores: g.setScores, dontKnow: g.dontKnow, excluded: g.excluded, unanswered: g.unanswered, timedOut });
    return ok({ ok: true });
  }

  const answers = "answers" in body.data ? body.data.answers : [];
  const asked = pack.sessionItems(session.form, session.both);
  if (answers.length !== asked.length) return fail(400, "Bad request.");
  // anything that isn't a valid answer to its item counts as unanswered (content/test.ts)
  const g = gradeTest(pack.exercises, session.form, !!session.both, answers);
  const items = g.asked.map(({ q, chosen, correct }) => ({ id: q.id, form: q.form, kind: q.kind, chosen, answer: q.answer, key: keyText(q), correct, explain: q.explain }));
  const work = "work" in body.data ? body.data.work : undefined;
  const order = "order" in body.data ? body.data.order : undefined;
  const since = "since" in body.data ? (body.data.since ?? null) : null;
  const pos = (id: string) => (order && order.length === asked.length ? order.indexOf(id) + 1 || null : null);
  const versions = Object.fromEntries(g.forms.map((f) => [f, pack.testVersion(f)]));
  record({
    t: "grade",
    sid: session.sid,
    condition: session.cond,
    pid: session.pid,
    phase: session.phase, // main: the final test; delayed: the follow-up test
    form: session.form, // the session's form (in a pilot: the one it took first)
    forms: g.forms, // the forms it took, in order (a pilot: both)
    topic: pack.slug,
    version: pack.testVersion(session.form),
    versions, // each form's version (an item's answers count for the version of its own form)
    ...(session.phase === "delayed" ? { since } : {}),
    timedOut: "timedOut" in body.data && !!body.data.timedOut,
    score: g.score, // over the items it answered (an anchor once)
    of: g.of,
    formScores: g.perForm, // per form, each complete: an anchor answered once counts in both
    dontKnow: g.asked.filter((x) => x.chosen === DONT_KNOW).length,
    answers: items.map((x) => x.chosen),
    order: order ?? null,
    items: g.asked.map(({ q, chosen, correct }) => ({
      id: q.id,
      form: q.form,
      version: versions[q.form],
      kind: q.kind,
      pos: pos(q.id),
      chosen,
      answer: q.answer,
      correct,
      // the reason the item asked for (scored later against its rubric), or the learner's working
      ...(q.reason ? { reason: work?.[q.id] ?? null } : { work: work?.[q.id] ?? null }),
    })),
    // items the session didn't see because it answered their twin (the anchor): they take the twin's answer
    copies: g.copies.map((c) => ({ id: c.q.id, form: c.q.form, from: c.from, chosen: c.chosen, correct: c.correct })),
  });
  if (session.pid && (session.entry === "participant" || session.entry === "trial")) await markTest(session.pid, session.phase).catch(() => {});
  // the final test is done: now the practice problems' worked solutions can be shown too (not after the delayed test,
  // and not when the study has no practice step)
  const { settings } = await getSettings();
  // a person with a follow-up test (a code that names them, the follow-up switched on, two forms): when it opens
  let followUp: { opensAt: number } | null = null;
  if (session.phase === "main" && !session.both && settings.test.followUp && pack.forms.length > 1 && session.pid && (session.entry === "participant" || session.entry === "trial")) {
    const p = await getParticipant(session.pid).catch(() => null);
    const opens = p ? followUpOpens(p, settings.test.followUpDays) : null;
    if (opens !== null) followUp = { opensAt: opens };
  }
  // per part (a pilot's two forms): what the learner answered in each
  const parts = g.forms.map((f) => ({ form: f, score: g.asked.filter((x) => x.q.form === f && x.correct).length, of: g.asked.filter((x) => x.q.form === f).length }));
  return ok({ score: g.score, of: g.of, items, parts, followUp, ...(session.phase === "main" && settings.practice.on ? { practice: pack.practiceReview } : {}) });
}
