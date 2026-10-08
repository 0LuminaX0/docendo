import type { NextRequest } from "next/server";
import { z } from "zod";
import { bundle, checkPractice, practice } from "@/lib/server/content";
import { State } from "@/engine/tutor/state";
import { applyJudgement } from "@/engine/tutor/turn";
import { llmJudge, mockJudge } from "@/engine/tutor/judge";
import { solve, type Solution } from "@/engine/tutor/solve";
import type { LlmCall } from "@/engine/llm";
import { parseNumber } from "@/content/practice";
import { clientIp, fail, ok, readBody, sameOrigin } from "@/lib/server/http";
import { limitAll } from "@/lib/server/limit";
import { verifyToken } from "@/lib/server/token";
import { record } from "@/lib/server/events";
import { momentsFor } from "@/lib/server/moments";
import { config } from "@/lib/server/env";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

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
  // recursive feedback: Kai solves the problem from its notebook (attempt 1)
  z.object({ token: z.string().max(400), action: z.literal("solve"), id: z.string().max(20), state: State, msOnProblem: z.number().int().min(0).max(24 * 3600_000).optional() }),
  // the learner's one correction after a wrong answer: judged like teaching, then Kai tries again (attempt 2)
  z.object({
    token: z.string().max(400),
    action: z.literal("reteach"),
    id: z.string().max(20),
    state: State,
    message: z.string().trim().min(1).max(1500),
    step: z.string().max(600), // the step the learner clicked as faulty, Kai's words (the judge reads the correction in its light)
    clicks: z.array(z.number().int().min(0).max(10)).max(30), // every step the learner clicked, in order
    msOnProblem: z.number().int().min(0).max(24 * 3600_000).optional(),
  }),
]);

/**
 * Practice chapter. Direct feedback: check the learner's answer (a first try and
 * one retry per problem). Recursive feedback: Kai solves the problem from its
 * notebook, and after a wrong answer the learner reteaches once and Kai tries
 * again. Both: find the lesson moment to rewatch. Answers and worked solutions
 * stay here; the solutions go out with the graded final test (/api/grade).
 */
export async function POST(req: NextRequest) {
  if (!sameOrigin(req)) return fail(403, "Requests from other sites are not allowed.");
  const body = Body.safeParse(await readBody(req, 300_000));
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

  if (body.data.action === "solve" || body.data.action === "reteach") {
    // a participant only gets their own condition; team sessions may look at both
    if (session.entry === "participant" && session.cond !== "recursive") return fail(403, "Not available in this session.");
    const budget = await limitAll([
      [`practice:kai:${session.sid}:${item.id}`, 2, 6 * 3600, "local"], // two attempts per problem
      ...(config.demo ? [] : ([["chat:global", config.dailyTurnLimit, 86_400]] as [string, number, number][])), // the site's daily model budget
    ]);
    if (!budget.ok) {
      record({ t: "practice_no_tries", sid: session.sid, id: item.id, condition: "recursive" });
      return fail(409, "Kai has had its two tries at this problem. Go on to the next one.");
    }
    const calls: LlmCall[] = [];
    const onCall = (c: LlmCall) => calls.push(c);
    const t0 = Date.now();
    let state = body.data.state;
    let judged: unknown = null;
    if (body.data.action === "reteach") {
      const msg = body.data.message;
      const j = config.demo ? mockJudge(bundle, msg) : await llmJudge(bundle, msg, body.data.step, onCall, { timeoutMs: 15_000, retries: 1 }).catch(() => mockJudge(bundle, msg)); // worst case with the solver stays under 60 s
      state = applyJudgement(state, j);
      judged = { intent: j.intent, facts: j.facts, misconceptions: j.misconceptions ?? [], dropped: j.dropped ?? [] };
    }
    let error: string | null = null;
    const sol: Solution = await solve(bundle, item, state, { demo: config.demo, onCall, onError: (e) => (error = e instanceof Error ? e.message.slice(0, 300) : String(e)) });
    const attempt = body.data.action === "solve" ? 1 : 2;
    record({
      t: body.data.action === "solve" ? "practice_kai_solve" : "practice_kai_reteach",
      sid: session.sid,
      condition: "recursive",
      entry: session.entry,
      id: item.id,
      round: item.round,
      attempt,
      ...(body.data.action === "reteach" ? { message: body.data.message, chars: body.data.message.length, step: body.data.step, clicks: body.data.clicks, judged } : {}),
      correct: sol.correct,
      answer: sol.answer,
      steps: sol.steps,
      notes: sol.notes,
      leaked: sol.leaked,
      gate: sol.gate, // the facts this problem needs, which were missing, misconceptions still believed: Kai can only be right with all of them

      by: sol.by, // model, or offline (demo mode, or the model failed)
      error,
      msOnProblem: body.data.msOnProblem ?? null,
      llm: calls,
      latencyMs: Date.now() - t0,
    });
    if (body.data.action === "reteach") record({ t: "notebook_snapshot", sid: session.sid, source: "server", reason: "reteach", id: item.id, turn: state.turn, notebook: state.notebook, misconceptions: state.misconceptions });
    // the browser gets Kai's attempt and, after a correction, Kai's updated notebook (the learner's words only)
    return ok({ solution: { steps: sol.steps, answer: sol.answer, correct: sol.correct, notes: sol.notes }, state: body.data.action === "reteach" ? state : undefined });
  }

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
