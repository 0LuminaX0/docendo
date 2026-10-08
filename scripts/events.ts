// Research data export.
//   pnpm events export              all events → data/export-<time>/ (JSONL + CSV tables)
//   pnpm events export --from f.jsonl   use a local events file instead of Upstash
//   pnpm events summary             a quick overview in the terminal
// Reads Upstash Redis when UPSTASH_REDIS_REST_URL/TOKEN are set (.env), otherwise .data/events.jsonl.
// The output contains what learners wrote: keep it out of git (data/ is ignored) and share it carefully.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { Redis } from "@upstash/redis";

const EVENTS_KEY = "docendo:events:v1";
type Ev = { t: string; sid: string; at: string; [k: string]: unknown };

// .env, and .env.local (what `vercel env pull .env.local` writes)
for (const f of [".env", ".env.local"]) {
  try {
    process.loadEnvFile?.(f);
  } catch {
    // file missing: use the environment as is
  }
}

async function load(from?: string): Promise<Ev[]> {
  const parse = (lines: string[]) => {
    const all = lines.filter((l) => l.trim()).map((l) => JSON.parse(l) as Ev);
    const ok = all.filter((e) => typeof e.t === "string" && typeof e.sid === "string" && typeof e.at === "string");
    if (ok.length < all.length) console.warn(`skipped ${all.length - ok.length} malformed events`);
    return ok;
  };
  if (from) return parse(readFileSync(from, "utf8").split("\n"));
  const url = process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN;
  if (url && token) {
    const redis = new Redis({ url, token, automaticDeserialization: false });
    const n = await redis.llen(EVENTS_KEY);
    const out: string[] = [];
    for (let i = 0; i < n; i += 1000) out.push(...((await redis.lrange(EVENTS_KEY, i, Math.min(n, i + 1000) - 1)) as string[]));
    console.log(`read ${out.length} events from Upstash`);
    return parse(out);
  }
  const local = join(".data", "events.jsonl");
  if (!existsSync(local)) throw new Error("No events: set UPSTASH_REDIS_REST_URL/TOKEN in .env, or run the app locally first.");
  console.log(`read events from ${local}`);
  return parse(readFileSync(local, "utf8").split("\n"));
}

// ---------- tables ----------

const csvCell = (v: unknown) => {
  if (v === null || v === undefined) return "";
  const s = typeof v === "object" ? JSON.stringify(v) : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};
const toCsv = (rows: Record<string, unknown>[]) => {
  if (!rows.length) return "";
  const cols = [...new Set(rows.flatMap((r) => Object.keys(r)))];
  return [cols.join(","), ...rows.map((r) => cols.map((c) => csvCell(r[c])).join(","))].join("\n") + "\n";
};
// browser events carry their own timestamp (clientAt); the server stamps `at` when a batch arrives
const ms = (e: Ev | undefined) => (e ? (typeof e.clientAt === "number" ? e.clientAt : Date.parse(e.at)) : null);
const minutes = (a: number | null, b: number | null) => (a !== null && b !== null ? Math.round(((b - a) / 60_000) * 100) / 100 : null);
const count = <T,>(xs: T[], f: (x: T) => boolean) => xs.filter(f).length;
const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);
const mean = (xs: number[]) => (xs.length ? Math.round((sum(xs) / xs.length) * 10) / 10 : null);

function tables(events: Ev[]) {
  events.sort((a, b) => a.at.localeCompare(b.at) || Number(a.seq ?? 0) - Number(b.seq ?? 0));
  const bySid = new Map<string, Ev[]>();
  for (const e of events) (bySid.get(e.sid) ?? bySid.set(e.sid, []).get(e.sid)!).push(e);

  const sessions: Record<string, unknown>[] = [];
  const turns: Record<string, unknown>[] = [];
  const practice: Record<string, unknown>[] = [];
  const test: Record<string, unknown>[] = [];
  const video: Record<string, unknown>[] = [];

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
    const llm = chat.flatMap((c) => (c.llm as { ms: number; usage: { promptTokens: number; completionTokens: number; costUsd?: number } }[]) ?? []);
    const moods = chat.map((c) => String(c.mood));
    const moves = chat.map((c) => String((c.move as { type: string })?.type));
    const intents = chat.map((c) => String(c.intent));

    sessions.push({
      sid,
      pid: start?.pid ?? null,
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
      reachedStep: tAt.results ? "results" : tAt.test ? "test" : tAt.practice ? "practice" : tAt.teach ? "teach" : tAt.watch ? "watch" : "start",
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
      misconceptions: count(moves, (m) => m === "misconception"),
      contradictions: count(moves, (m) => m === "contradict"),
      intentOffTopic: count(intents, (i) => i === "off_topic"),
      intentUnsure: count(intents, (i) => i === "unsure"),
      intentMoveOn: count(intents, (i) => i === "move_on"),
      intentAskKai: count(intents, (i) => i === "ask_kai"),
      droppedVerdicts: sum(chat.map((c) => ((c.dropped as unknown[]) ?? []).length)),
      leakTurns: count(chat, (c) => ((c.leaked as unknown[]) ?? []).length > 0),
      fallbacks: count(chat, (c) => !!c.fallback),
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
      practiceChecks: of("practice_check").length,
      practiceSolved: new Set(of("practice_check").filter((e) => e.correct).map((e) => e.id)).size,
      practiceHints: of("practice_hint").length,
      practiceSolutions: of("practice_solution").length,
      practiceTimeUp: of("client_practice_time_up").length > 0,
      practiceLeftSec: first("client_practice_leave")?.leftMs != null ? Math.round(Number(first("client_practice_leave")!.leftMs) / 1000) : null,
      testScore: grade?.score ?? null,
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

    const ids = [...new Set([...of("practice_check"), ...of("practice_hint"), ...of("practice_solution")].map((e) => String(e.id)))].sort();
    for (const id of ids) {
      const checks = of("practice_check").filter((e) => e.id === id);
      const firstRight = checks.findIndex((e) => e.correct);
      const sol = first("practice_solution", (e) => e.id === id);
      practice.push({
        sid,
        id,
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

    for (const e of evs.filter((x) => x.t.startsWith("client_video_")))
      video.push({ sid, at: new Date(ms(e)!).toISOString(), event: e.t.replace("client_video_", ""), seg: e.seg ?? null, pos: e.pos ?? null, from: e.from ?? null, to: e.to ?? null, rate: e.rate ?? null, code: e.code ?? null });
  }
  return { sessions, turns, practice, test, video };
}

// ---------- commands ----------

const [cmd = "summary", ...rest] = process.argv.slice(2);
const from = rest.includes("--from") ? rest[rest.indexOf("--from") + 1] : undefined;
const events = await load(from);
const t = tables(events);

if (cmd === "export") {
  const dir = join("data", `export-${new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19)}`);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "events.jsonl"), events.map((e) => JSON.stringify(e)).join("\n") + "\n");
  for (const [name, rows] of Object.entries(t)) writeFileSync(join(dir, `${name}.csv`), toCsv(rows));
  console.log(`wrote ${dir}: events.jsonl (${events.length}), ${Object.entries(t).map(([n, r]) => `${n}.csv (${r.length})`).join(", ")}`);
} else {
  const done = t.sessions.filter((s) => s.testScore !== null);
  console.log(`${events.length} events · ${t.sessions.length} sessions · ${done.length} finished the test`);
  console.log(`mean turns ${mean(t.sessions.map((s) => Number(s.turns)))} · mean test score ${mean(done.map((s) => Number(s.testScore)))} · Kai unhappy in ${mean(t.sessions.filter((s) => Number(s.turns) > 0).map((s) => Number(s.kaiUnhappyShare) * 100))}% of turns`);
  console.log(`mean minutes: watch ${mean(t.sessions.filter((s) => s.minWatch !== null).map((s) => Number(s.minWatch)))}, teach ${mean(t.sessions.filter((s) => s.minTeach !== null).map((s) => Number(s.minTeach)))}, practice ${mean(t.sessions.filter((s) => s.minPractice !== null).map((s) => Number(s.minPractice)))}, test ${mean(t.sessions.filter((s) => s.minTest !== null).map((s) => Number(s.minTest)))}`);
}
