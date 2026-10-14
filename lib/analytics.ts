// The research log as tables: one row per session, chat turn, practice problem, test answer and video event.
// Shared by `pnpm events export` (CSV files) and the admin dashboard, so both always count the same way.
// Pure: no file or network access here.

export type Ev = { t: string; sid: string; at: string; [k: string]: unknown };
export type Tables = ReturnType<typeof tables>;


export const csvCell = (v: unknown) => {
  if (v === null || v === undefined) return "";
  const s = typeof v === "object" ? JSON.stringify(v) : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};
export const toCsv = (rows: Record<string, unknown>[]) => {
  if (!rows.length) return "";
  const cols = [...new Set(rows.flatMap((r) => Object.keys(r)))];
  return [cols.join(","), ...rows.map((r) => cols.map((c) => csvCell(r[c])).join(","))].join("\n") + "\n";
};
// browser events carry their own timestamp (clientAt); the server stamps `at` when a batch arrives
const ms = (e: Ev | undefined) => (e ? (typeof e.clientAt === "number" ? e.clientAt : Date.parse(e.at)) : null);
const minutes = (a: number | null, b: number | null) => (a !== null && b !== null ? Math.round(((b - a) / 60_000) * 100) / 100 : null);
const count = <T,>(xs: T[], f: (x: T) => boolean) => xs.filter(f).length;
const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);
export const mean = (xs: number[]) => (xs.length ? Math.round((sum(xs) / xs.length) * 10) / 10 : null);

export function tables(events: Ev[]) {
  events.sort((a, b) => a.at.localeCompare(b.at) || Number(a.seq ?? 0) - Number(b.seq ?? 0));
  const bySid = new Map<string, Ev[]>();
  for (const e of events) (bySid.get(e.sid) ?? bySid.set(e.sid, []).get(e.sid)!).push(e);

  const sessions: Record<string, unknown>[] = [];
  const turns: Record<string, unknown>[] = [];
  const practice: Record<string, unknown>[] = [];
  const test: Record<string, unknown>[] = [];
  const video: Record<string, unknown>[] = [];
  const feedback: Record<string, unknown>[] = [];

  for (const [sid, evs] of bySid) {
    const of = (t: string) => evs.filter((e) => e.t === t);
    const first = (t: string, f: (e: Ev) => boolean = () => true) => evs.find((e) => e.t === t && f(e));
    const view = (path: string) => first("client_page_view", (e) => e.path === path);
    const start = first("session_start");
    const chat = of("chat_turn");
    const grade = first("grade");
    const lastTurn = chat[chat.length - 1];
    const watchDone = first("client_watch_continue");
    const tAt = { start: ms(start), watch: ms(view("/watch")), teach: ms(view("/teach")), practice: ms(view("/practice")), test: ms(view("/exercises")), results: ms(first("client_test_submit")) ?? ms(grade) };
    const llm = [...chat, ...of("practice_kai_solve"), ...of("practice_kai_reteach")].flatMap((c) => (c.llm as { ms: number; usage: { promptTokens: number; completionTokens: number; costUsd?: number } }[]) ?? []);
    const moods = chat.map((c) => String(c.mood));
    const moves = chat.map((c) => String((c.move as { type: string })?.type));
    const intents = chat.map((c) => String(c.intent));

    sessions.push({
      sid,
      pid: start?.pid ?? null,
      condition: start?.condition ?? "direct", // sessions before conditions existed were all direct
      entry: start?.entry ?? null, // participant (own code), team (shared code) or open
      // the practice the learner actually did: their condition, or the view a team session switched to
      practiceView: of("practice_kai_solve").length ? "recursive" : of("practice_check").length ? "direct" : null,
      demo: start?.demo ?? null,
      browser: (start?.device as { browser?: string })?.browser ?? null,
      os: (start?.device as { os?: string })?.os ?? null,
      mobile: (start?.device as { mobile?: boolean })?.mobile ?? null,
      startedAt: start?.at ?? evs[0]?.at,
      minWatch: minutes(tAt.watch, tAt.teach),
      minTeach: minutes(tAt.teach, tAt.practice),
      minPractice: minutes(tAt.practice, tAt.test),
      minTest: minutes(tAt.test, tAt.results),
      minTotal: minutes(tAt.start, tAt.results),
      reachedStep: tAt.results ? "results" : tAt.test ? "test" : tAt.practice ? "practice" : tAt.teach ? "teach" : tAt.watch ? "watch" : first("pretest") || view("/pretest") ? "pretest" : "start",
      watchedSec: watchDone?.watchedTotal ?? null,
      lessonSec: watchDone?.totalSec ?? null,
      watchedAll: watchDone?.allWatched ?? null,
      videoSeeks: of("client_video_seek").length,
      videoPauses: of("client_video_pause").length,
      videoRateChanges: of("client_video_rate").length,
      turns: chat.length,
      learnerChars: sum(chat.map((c) => Number(c.chars))),
      meanChars: mean(chat.map((c) => Number(c.chars))),
      meanWords: mean(chat.map((c) => Number(c.words))),
      meanComposeSec: mean(chat.filter((c) => c.composeMs != null).map((c) => Number(c.composeMs) / 1000)),
      pastes: of("client_paste").length,
      pastedChars: sum(chat.map((c) => Number(c.pastedChars ?? 0))),
      kaiConfused: count(moods, (m) => m === "confused"),
      kaiOkay: count(moods, (m) => m === "okay"),
      kaiGreat: count(moods, (m) => m === "great"),
      kaiNeutral: count(moods, (m) => m === "neutral"),
      kaiUnhappyShare: chat.length ? Math.round((count(moods, (m) => m === "confused") / chat.length) * 100) / 100 : null,
      followUps: count(moves, (m) => m === "followUp"),
      nudges: count(moves, (m) => m === "nudge"),
      ideasOpened: count(moves, (m) => m === "open"),
      ideasParked: chat.filter((c) => (c.move as { closure?: string })?.closure === "parked").length,
      answersToLearner: count(moves, (m) => m === "answer"),
      misconceptionMoves: count(moves, (m) => m === "misconception"),
      misconceptionsStated: sum(chat.map((c) => ((c.misconceptions as unknown[]) ?? []).length)),
      contradictions: count(moves, (m) => m === "contradict"),
      intentOffTopic: count(intents, (i) => i === "off_topic"),
      intentUnsure: count(intents, (i) => i === "unsure"),
      intentMoveOn: count(intents, (i) => i === "move_on"),
      intentAskKai: count(intents, (i) => i === "ask_kai"),
      droppedVerdicts: sum(chat.map((c) => ((c.dropped as unknown[]) ?? []).length)),
      leakTurns: count(chat, (c) => ((c.leaked as unknown[]) ?? []).length > 0),
      fallbacks: count(chat, (c) => !!c.fallback),
      degradedTurns: count(chat, (c) => ((c.degraded as unknown[]) ?? []).length > 0), // offline judge or writer: the model account was out of credits
      chatErrors: of("chat_error").length,
      factsCorrect: (lastTurn?.score as { correct?: number })?.correct ?? 0,
      factsPartial: (lastTurn?.score as { partial?: number })?.partial ?? 0,
      factsTotal: (lastTurn?.score as { total?: number })?.total ?? null,
      finalProgress: lastTurn?.progress ?? 0,
      readyReason: chat.find((c) => c.readyReason)?.readyReason ?? (first("client_skip_confirm") ? "skipped" : null),
      teachElapsedMinAtEnd: lastTurn?.elapsedMs != null ? Math.round((Number(lastTurn.elapsedMs) / 60_000) * 100) / 100 : null,
      helpOpens: of("client_help_open").length,
      mindViews: count(of("client_view_toggle"), (e) => e.to === "mind"),
      skipOpened: of("client_skip_open").length,
      notebookEntriesAtEnd: (() => {
        const snap = [...of("notebook_snapshot")].pop();
        return snap ? ((snap.notebook as unknown[]) ?? []).length : null;
      })(),
      practiceChecks: of("practice_check").length,
      practiceSolved: new Set(of("practice_check").filter((e) => e.correct).map((e) => e.id)).size,
      practiceFirstTry: count(of("practice_check"), (e) => e.correct === true && Number(e.attempt ?? 1) === 1),
      practiceOnRetry: count(of("practice_check"), (e) => e.correct === true && Number(e.attempt ?? 1) > 1),
      practiceRound1: new Set(of("practice_check").filter((e) => e.correct && Number(e.round) === 1).map((e) => e.id)).size,
      practiceRound2: new Set(of("practice_check").filter((e) => e.correct && Number(e.round) === 2).map((e) => e.id)).size,
      practiceSkipped: of("client_practice_skip").length,
      // recursive feedback: Kai's attempts from its notebook
      kaiSolved: of("practice_kai_solve").length,
      kaiFirstTry: count(of("practice_kai_solve"), (e) => e.correct === true),
      kaiOnRetry: count(of("practice_kai_reteach"), (e) => e.correct === true),
      reteaches: of("practice_kai_reteach").length,
      kaiStepClicks: of("client_practice_kai_step_click").length,
      kaiOffline: count([...of("practice_kai_solve"), ...of("practice_kai_reteach")], (e) => e.by === "offline"),
      kaiLeakSteps: count([...of("practice_kai_solve"), ...of("practice_kai_reteach")], (e) => ((e.leaked as unknown[]) ?? []).length > 0),
      practiceHints: of("practice_hint").length,
      practiceSolutions: of("practice_solution").length, // older sessions only: solutions now come after the test
      practiceTimeUp: of("client_practice_time_up").length > 0,
      practiceLeftSec: first("client_practice_leave")?.leftMs != null ? Math.round(Number(first("client_practice_leave")!.leftMs) / 1000) : null,
      pretestScore: first("pretest")?.score ?? null, // knowledge items right, of pretestOf
      pretestOf: first("pretest")?.of ?? null,
      pretestDontKnow: first("pretest")?.dontKnow ?? null,
      rlCourse: (first("pretest")?.answers as Record<string, number> | undefined)?.b1 === 0 ? true : first("pretest") ? false : null,
      heardOfBandits: (first("pretest")?.answers as Record<string, number> | undefined)?.b2 ?? null, // 0 no, 1 the name, 2 roughly how they work
      excluded: first("pretest")?.excluded ?? null, // took an RL course: keep the data, leave out of the main analysis
      minPretest: minutes(ms(view("/pretest")), tAt.watch),
      testScore: grade?.score ?? null,
      feedbackRating: [...of("client_feedback")].pop()?.rating ?? null,
      feedback: [...of("client_feedback")].pop()?.text ?? null,
      testOf: grade?.of ?? null,
      tabHidden: of("client_tab_hidden").length,
      tabAwaySec: Math.round(sum(of("client_tab_visible").map((e) => Number(e.awayMs ?? 0))) / 1000),
      llmCalls: llm.length,
      llmSec: Math.round(sum(llm.map((c) => c.ms)) / 100) / 10,
      tokensIn: sum(llm.map((c) => c.usage.promptTokens)),
      tokensOut: sum(llm.map((c) => c.usage.completionTokens)),
      costUsd: Math.round(sum(llm.map((c) => c.usage.costUsd ?? 0)) * 10000) / 10000,
    });

    for (const c of chat) {
      const mv = c.move as { type: string; node: string | null; fact: string | null; closure: string | null; cue: string | null };
      turns.push({
        sid,
        turn: c.turn,
        at: c.at,
        elapsedSec: c.elapsedMs != null ? Math.round(Number(c.elapsedMs) / 1000) : null,
        composeSec: c.composeMs != null ? Math.round(Number(c.composeMs) / 1000) : null,
        chars: c.chars,
        words: c.words,
        pastedChars: c.pastedChars,
        intent: c.intent,
        judged: ((c.judged as { fact: string; verdict: string }[]) ?? []).map((v) => `${v.fact}:${v.verdict}`).join(" "),
        newCorrect: ((c.newCorrect as string[]) ?? []).join(" "),
        dropped: ((c.dropped as unknown[]) ?? []).length,
        mood: c.mood,
        kaiHappy: c.kaiHappy,
        move: mv?.type,
        node: mv?.node,
        fact: mv?.fact,
        closure: mv?.closure,
        cue: mv?.cue,
        leaked: ((c.leaked as string[]) ?? []).join(" "),
        fallback: c.fallback,
        progress: c.progress,
        factsCorrect: (c.score as { correct: number })?.correct,
        done: c.done,
        readyReason: c.readyReason,
        latencyMs: c.latencyMs,
        message: c.message,
        reply: c.reply,
      });
    }

    const ids = [...new Set([...of("practice_check"), ...of("practice_hint"), ...of("practice_solution"), ...of("practice_kai_solve"), ...of("client_practice_problem_show")].map((e) => String(e.id)))].sort();
    for (const id of ids) {
      const checks = of("practice_check").filter((e) => e.id === id);
      const firstRight = checks.findIndex((e) => e.correct);
      const sol = first("practice_solution", (e) => e.id === id);
      practice.push({
        sid,
        condition: start?.condition ?? "direct",
        id,
        round: checks[0]?.round ?? first("client_practice_problem_show", (e) => e.id === id)?.round ?? null,
        // time on the problem, from when it was shown until the learner moved on
        sec: Math.round(sum(of("client_practice_problem_leave").filter((e) => e.id === id).map((e) => Number(e.ms ?? 0))) / 1000),
        kaiFirstTry: first("practice_kai_solve", (e) => e.id === id)?.correct ?? null,
        kaiRetry: first("practice_kai_reteach", (e) => e.id === id)?.correct ?? null,
        reteach: first("practice_kai_reteach", (e) => e.id === id)?.message ?? null,
        stepClicks: of("client_practice_kai_step_click").filter((e) => e.id === id).map((e) => e.step).join(" "),
        firstTryCorrect: checks.length ? !!checks[0]!.correct : null,
        retryCorrect: checks.length > 1 ? !!checks[1]!.correct : null,
        skipped: of("client_practice_skip").some((e) => e.id === id),
        checks: checks.length,
        solved: firstRight >= 0,
        checksToSolve: firstRight >= 0 ? firstRight + 1 : null,
        solvedBeforeSolution: firstRight >= 0 && (!sol || Date.parse(checks[firstRight]!.at) < Date.parse(sol.at)),
        hints: of("practice_hint").filter((e) => e.id === id).length,
        solutionOpened: !!sol,
        answers: checks.map((e) => e.answer).join(" | "),
        lastWork: checks.length ? checks[checks.length - 1]!.work : null,
      });
    }

    for (const it of (grade?.items as { id: string; chosen: number | null; answer: number; correct: boolean }[]) ?? [])
      test.push({ sid, id: it.id, chosen: it.chosen, answer: it.answer, correct: it.correct });

    for (const e of of("client_feedback"))
      feedback.push({ sid, at: e.at, pid: start?.pid ?? null, condition: start?.condition ?? "direct", entry: start?.entry ?? null, rating: e.rating ?? null, text: e.text ?? "", testScore: grade?.score ?? null });

    for (const e of evs.filter((x) => x.t.startsWith("client_video_")))
      video.push({ sid, at: new Date(ms(e)!).toISOString(), event: e.t.replace("client_video_", ""), seg: e.seg ?? null, pos: e.pos ?? null, from: e.from ?? null, to: e.to ?? null, rate: e.rate ?? null, code: e.code ?? null });
  }
  return { sessions, turns, practice, test, video, feedback };
}

// ---------- the admin dashboard's summary ----------

export const STEPS = ["start", "pretest", "watch", "teach", "practice", "test", "results"] as const;
const num = (v: unknown) => (typeof v === "number" ? v : typeof v === "string" && v !== "" && !Number.isNaN(Number(v)) ? Number(v) : null);
export const median = (xs: (number | null)[]) => {
  const v = xs.filter((x): x is number => x !== null).sort((a, b) => a - b);
  if (!v.length) return null;
  const m = v.length / 2;
  return Math.round((v.length % 2 ? v[Math.floor(m)]! : (v[m - 1]! + v[m]!) / 2) * 10) / 10;
};
const pct = (n: number, of: number) => (of ? Math.round((n / of) * 100) : null);

/** Which practice a session did: its condition, or the view a team session switched to. */
const viewOf = (s: Record<string, unknown>) => String(s.practiceView ?? s.condition ?? "direct");

/**
 * The dashboard's numbers. By default only participants' sessions (their own code): team, open and demo
 * sessions are tests. `all` counts every session.
 */
export function summarize(t: Pick<Tables, "sessions" | "practice" | "test">, opts: { all?: boolean } = {}) {
  const sessions = t.sessions.filter((s) => opts.all || (s.entry === "participant" && !s.demo));
  const sids = new Set(sessions.map((s) => s.sid));
  const view = new Map(sessions.map((s) => [s.sid, viewOf(s)]));
  const conds = ["direct", "recursive"] as const;
  const inCond = (c: string) => sessions.filter((s) => viewOf(s) === c);
  const reached = (s: Record<string, unknown>) => STEPS.indexOf(String(s.reachedStep ?? "start") as (typeof STEPS)[number]);

  const practice = t.practice.filter((p) => sids.has(p.sid));
  const ids = [...new Set(practice.map((p) => String(p.id)))].sort();
  const test = t.test.filter((r) => sids.has(r.sid));
  const testIds = [...new Set(test.map((r) => String(r.id)))].sort();

  return {
    sessions: sessions.length,
    finished: sessions.filter((s) => s.testScore !== null && s.testScore !== undefined).length,
    excluded: sessions.filter((s) => s.excluded === true).length,
    byCondition: Object.fromEntries(conds.map((c) => [c, inCond(c).length])) as Record<(typeof conds)[number], number>,
    funnel: STEPS.map((step, i) => ({ step, n: sessions.filter((s) => reached(s) >= i).length })),
    minutes: (["minPretest", "minWatch", "minTeach", "minPractice", "minTest", "minTotal"] as const).map((k) => ({
      chapter: k.replace("min", ""),
      all: median(sessions.map((s) => num(s[k]))),
      direct: median(inCond("direct").map((s) => num(s[k]))),
      recursive: median(inCond("recursive").map((s) => num(s[k]))),
    })),
    practice: ids.map((id) => {
      const rows = practice.filter((p) => p.id === id);
      const d = rows.filter((p) => view.get(String(p.sid)) === "direct" && Number(p.checks) > 0);
      const r = rows.filter((p) => p.kaiFirstTry !== null && p.kaiFirstTry !== undefined && p.kaiFirstTry !== "");
      return {
        id,
        round: rows[0]?.round ?? null,
        direct: { tried: d.length, firstTry: pct(d.filter((p) => p.firstTryCorrect === true).length, d.length), solved: pct(d.filter((p) => p.solved === true).length, d.length), sec: median(d.map((p) => num(p.sec))) },
        recursive: {
          tried: r.length,
          kaiFirst: pct(r.filter((p) => p.kaiFirstTry === true).length, r.length),
          kaiAfter: pct(r.filter((p) => p.kaiFirstTry === true || p.kaiRetry === true).length, r.length),
          reteaches: r.filter((p) => p.reteach).length,
          sec: median(r.map((p) => num(p.sec))),
        },
      };
    }),
    test: testIds.map((id) => {
      const rows = test.filter((r) => r.id === id);
      const by = (c: string) => rows.filter((r) => view.get(String(r.sid)) === c);
      return { id, n: rows.length, all: pct(rows.filter((r) => r.correct === true).length, rows.length), direct: pct(by("direct").filter((r) => r.correct === true).length, by("direct").length), recursive: pct(by("recursive").filter((r) => r.correct === true).length, by("recursive").length) };
    }),
    testMean: Object.fromEntries(conds.map((c) => [c, mean(inCond(c).map((s) => num(s.testScore)).filter((x): x is number => x !== null))])) as Record<(typeof conds)[number], number | null>,
    teaching: {
      readyReasons: sessions.reduce<Record<string, number>>((a, s) => {
        const k = String(s.readyReason ?? (Number(s.turns) ? "still teaching" : "not started"));
        a[k] = (a[k] ?? 0) + 1;
        return a;
      }, {}),
      turns: median(sessions.filter((s) => Number(s.turns) > 0).map((s) => num(s.turns))),
      facts: median(sessions.filter((s) => Number(s.turns) > 0).map((s) => num(s.factsCorrect))),
      factsTotal: num(sessions.find((s) => s.factsTotal)?.factsTotal) ?? null,
      misconceptions: mean(sessions.filter((s) => Number(s.turns) > 0).map((s) => Number(s.misconceptionsStated ?? 0))),
      degraded: sessions.reduce((a, s) => a + Number(s.degradedTurns ?? 0), 0),
      leaks: sessions.reduce((a, s) => a + Number(s.leakTurns ?? 0), 0),
    },
    pretest: { mean: mean(sessions.map((s) => num(s.pretestScore)).filter((x): x is number => x !== null)), of: num(sessions.find((s) => s.pretestOf)?.pretestOf) ?? 3 },
    cost: Math.round(sessions.reduce((a, s) => a + Number(s.costUsd ?? 0), 0) * 100) / 100,
  };
}
export type Summary = ReturnType<typeof summarize>;
