// The leak audit (2026-11-17): did Kai show a learner something it wasn't taught? Run after the study, and between
// study days, to find the sessions to exclude (a decision for the team: this only lists candidates, with the words).
//   pnpm events audit                  every Kai attempt and Kai message, code checks only (free)
//   pnpm events audit --llm            also a model reads each one (the judge model; about $0.005 a session)
//   pnpm events audit --from f.jsonl   from a file (the admin panel's JSONL export) instead of Upstash
//
// Code checks: an attempt that states a caveat's point (its `leak` pattern: P8's slowing) while none of Kai's notes
// says it (its `covered` pattern); a misreading that says what Kai's notes leave out; a lesson term Kai used in the
// chat before the learner did. The model check reads each attempt against Kai's own notes (as logged with it), and
// each chat message against everything the learner had said so far (Kai's fixed questions taken out: asking states
// nothing). Writes data/audit-<time>/flags.csv (one row per flag, the text and the notes beside it) and sessions.csv.
// Both hold what learners wrote: data/ is ignored by git.

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";

import { toCsv, type Ev } from "../lib/analytics";
import { caveatsOf, PracticeFile, type PracticeItem } from "../content/practice";
import { notesLeaveOut } from "../engine/tutor/solve";

type Flag = { sid: string; entry: string; condition: string; at: string; where: string; source: "code" | "model"; what: string; text: string; given: string };

const ROOT = join(import.meta.dirname, "..");
const str = (x: unknown) => (typeof x === "string" ? x : "");
const practiceOf = (topic: string): PracticeItem[] => PracticeFile.parse(JSON.parse(readFileSync(join(ROOT, "topics", topic, "practice.json"), "utf8"))).items;
// Kai's fixed lines in the chat (questions, follow-ups, its set lines): taken out before the model reads a message
function fixedLines(topic: string): string[] {
  try {
    const s = JSON.parse(readFileSync(join(ROOT, "topics", topic, "script.json"), "utf8")) as { opening?: string; questions?: { text: string; follow?: { text: string }[]; again?: { text: string } }[]; lines?: Record<string, string> };
    return [s.opening ?? "", ...(s.questions ?? []).flatMap((q) => [q.text, ...(q.follow ?? []).map((f) => f.text), q.again?.text ?? ""]), ...Object.values(s.lines ?? {}).map((l) => l.replace(/\{notes\}.*$/, ""))].filter((t) => t.length > 8);
  } catch {
    return [];
  }
}
const re = (p: string) => {
  try {
    return new RegExp(p, "iu");
  } catch {
    return null;
  }
};

/** Code checks on one Kai attempt: a caveat's point stated with no note saying it, or a misreading naming a gap. */
function codeChecks(items: PracticeItem[], e: Ev): string[] {
  const steps = (e.steps as { text: string }[] | undefined) ?? [];
  const text = steps.map((s) => s.text).join(" ");
  const notes = ((e.notes as string[] | undefined) ?? []).join("\n");
  const out: string[] = [];
  for (const p of items)
    for (const c of caveatsOf(p)) {
      const m = c.leak ? re(c.leak)?.exec(text) : null;
      if (m && !re(c.covered)?.test(notes)) out.push(`states ${p.id}'s ${c.id ?? "caveat"} point, which no note says ("${m[0]}")`);
    }
  const gap = e.caveat === "misread" ? notesLeaveOut(text) : null;
  if (gap) out.push(`its misreading says what its notes leave out ("${gap}")`);
  return out;
}

const Verdict = z.object({ leak: z.boolean(), what: z.string(), step: z.number().int() });

export async function audit(events: Ev[], opts: { llm: boolean }) {
  const starts = new Map(events.filter((e) => e.t === "session_start").map((e) => [e.sid, e]));
  const who = (sid: string) => ({ entry: str(starts.get(sid)?.entry) || "?", condition: str(starts.get(sid)?.condition) || "?", topic: str(starts.get(sid)?.topic) || "bandits", demo: !!starts.get(sid)?.demo });
  const flags: Flag[] = [];
  const items = new Map<string, PracticeItem[]>();
  const itemsOf = (topic: string) => (items.has(topic) ? items.get(topic)! : (items.set(topic, practiceOf(topic)), items.get(topic)!));

  const attempts = events.filter((e) => e.t === "practice_kai_solve" || e.t === "practice_kai_reteach");
  const turns = events.filter((e) => e.t === "chat_turn" && !e.copied);
  const setAside = attempts.filter((e) => ((e.errors as string[] | undefined) ?? []).some((x) => x.startsWith("leak:")));
  const whereOf = (e: Ev) => `practice ${str(e.id)} try ${e.t === "practice_kai_solve" ? 1 : 2}${e.caveat ? ` (caveat ${str(e.caveatId) || ""} ${str(e.caveat)})` : ""}${e.correct ? ", right" : ", wrong"}, by ${str(e.by)}`;
  const stepsText = (e: Ev) => ((e.steps as { text: string }[] | undefined) ?? []).map((s, i) => `${i + 1}. ${s.text}`).join("\n");
  const notesText = (e: Ev) => ((e.notes as string[] | undefined) ?? []).map((n, i) => `[${i + 1}] ${n}`).join("\n");

  for (const e of attempts) {
    const w = who(e.sid);
    for (const what of codeChecks(itemsOf(w.topic), e)) flags.push({ sid: e.sid, entry: w.entry, condition: w.condition, at: e.at, where: whereOf(e), source: "code", what, text: stepsText(e), given: notesText(e) });
  }
  // the chat: lesson terms Kai used before the learner did (the writer's term check logs them; a fallback line replaced
  // the reply after two failures, so a logged leak may not have been shown: the text column has the reply as shown)
  for (const e of turns) {
    const leaked = (e.leaked as string[] | undefined) ?? [];
    if (!leaked.length) continue;
    const w = who(e.sid);
    flags.push({ sid: e.sid, entry: w.entry, condition: w.condition, at: e.at, where: `teaching turn ${Number(e.turn)}`, source: "code", what: `a lesson term before the learner used it: ${leaked.join(", ")}`, text: str(e.reply), given: str(e.message) });
  }

  let cost = 0;
  let read = 0;
  if (opts.llm) {
    const { chatJson, MODELS } = await import("../engine/llm");
    const ask = async (system: string, user: string) => {
      const r = await chatJson({ model: MODELS.judge, name: "leak", schema: Verdict, maxTokens: 300, timeoutMs: 30_000, retries: 1, messages: [{ role: "system", content: system }, { role: "user", content: user }] });
      cost += r.usage.costUsd ?? 0;
      read++;
      return r.data;
    };
    const ATTEMPT = `Kai is a student who knows only its notes, written from what a classmate told it. Kai solved a practice problem from them. Find knowledge Kai showed that its notes don't give it. Answer in JSON:
- leak: true if a step states as true a rule or fact about how a strategy (greedy, UCB), the averages or the bonuses behave that no note states or clearly implies, or hints at such a rule by naming what the notes leave out ("my notes don't say whether the growth slows down"). NOT a leak: the problem's own numbers and the arithmetic on them; what follows from the notes; a guess, hunch or reading Kai presents as its own, even a wrong one; a wrong belief; naming a topic without saying how it behaves ("my notes don't cover this part").
- what: the knowledge Kai showed and wasn't given, in a few words, or "".
- step: that step's number, or 0.`;
    const CHAT = `Kai is a student who missed a lecture and is being taught by a classmate. Kai may know only what the classmate has said, plus the setup from the slides: each round you pick one of a few options, the pick gives a random result, you only see how the one you picked did, and the strategies are called greedy and UCB. Answer in JSON:
- leak: true if Kai's message states as true something about how the strategies, the averages, the bonuses or exploring work that the classmate has not said in any of their messages so far (Kai saying back what they said, in other words, is fine), or hints at what the right answer to something is.
- what: what Kai showed and wasn't told, in a few words, or "".
- step: 0.`;
    // a few at a time
    const jobs: (() => Promise<void>)[] = [];
    for (const e of attempts) {
      if (who(e.sid).demo) continue; // demo sessions answer offline, from fixed wording
      const w = who(e.sid);
      const item = itemsOf(w.topic).find((p) => p.id === e.id);
      const problem = item ? `${item.prompt}${item.options ? `\n${item.options.map((o, i) => `${"ABCDEF"[i]}) ${o}`).join("\n")}` : ""}` : "";
      jobs.push(async () => {
        const v = await ask(ATTEMPT, `KAI'S NOTES:\n${notesText(e) || "(none)"}\n\nPROBLEM:\n${problem}\n\nKAI'S STEPS:\n${stepsText(e)}`).catch(() => null);
        if (v?.leak) flags.push({ sid: e.sid, entry: w.entry, condition: w.condition, at: e.at, where: `${whereOf(e)}${v.step ? `, step ${v.step}` : ""}`, source: "model", what: v.what, text: stepsText(e), given: notesText(e) });
      });
    }
    const bySession = new Map<string, Ev[]>();
    for (const e of turns) bySession.set(e.sid, [...(bySession.get(e.sid) ?? []), e]);
    for (const [sid, list] of bySession) {
      const w = who(sid);
      if (w.demo) continue;
      const fixed = fixedLines(w.topic);
      const sorted = [...list].sort((a, b) => Number(a.turn) - Number(b.turn));
      sorted.forEach((e, i) => {
        let reply = str(e.reply);
        for (const f of fixed) reply = reply.split(f).join(" ");
        reply = reply.replace(/\s+/g, " ").trim();
        if (reply.split(/\s+/).length < 4) return; // only a fixed question: nothing of Kai's own
        const said = sorted.slice(0, i + 1).map((x) => `- ${str(x.message)}`).join("\n");
        jobs.push(async () => {
          const v = await ask(CHAT, `WHAT THE CLASSMATE HAS SAID SO FAR (oldest first):\n${said}\n\nKAI'S MESSAGE (its fixed question taken out):\n${reply}`).catch(() => null);
          if (v?.leak) flags.push({ sid, entry: w.entry, condition: w.condition, at: e.at, where: `teaching turn ${Number(e.turn)}`, source: "model", what: v.what, text: str(e.reply), given: str(e.message) });
        });
      });
    }
    for (let i = 0; i < jobs.length; i += 6) await Promise.all(jobs.slice(i, i + 6).map((j) => j()));
  }

  // per session: what was flagged, to decide on exclusions
  const sids = [...new Set([...attempts, ...turns].map((e) => e.sid))];
  const sessions = sids.map((sid) => {
    const w = who(sid);
    const mine = flags.filter((f) => f.sid === sid);
    return {
      sid,
      entry: w.entry,
      condition: w.condition,
      demo: w.demo,
      kaiAttempts: attempts.filter((e) => e.sid === sid).length,
      kaiMessages: turns.filter((e) => e.sid === sid).length,
      leaksSetAside: setAside.filter((e) => e.sid === sid).length, // caught before the learner saw them
      flagsPractice: mine.filter((f) => f.where.startsWith("practice")).length,
      flagsTeaching: mine.filter((f) => f.where.startsWith("teaching")).length,
    };
  });
  const dir = join("data", `audit-${new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19)}`);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "flags.csv"), toCsv(flags.sort((a, b) => a.sid.localeCompare(b.sid) || a.at.localeCompare(b.at))));
  writeFileSync(join(dir, "sessions.csv"), toCsv(sessions));
  const part = sessions.filter((s) => s.entry === "participant" && !s.demo);
  const flagged = (xs: typeof sessions) => xs.filter((s) => s.flagsPractice + s.flagsTeaching > 0).length;
  console.log(`${attempts.length} Kai attempts and ${turns.length} Kai messages in ${sessions.length} sessions; ${setAside.length} attempts had a leaking try set aside before it was shown`);
  console.log(`flags: ${flags.length} (${flags.filter((f) => f.source === "code").length} by code, ${flags.filter((f) => f.source === "model").length} by the model${opts.llm ? `, ${read} read, $${cost.toFixed(3)}` : "; add --llm for the model's reading"})`);
  console.log(`sessions with a flag: participants ${flagged(part)} of ${part.length}, all ${flagged(sessions)} of ${sessions.length}`);
  console.log(`wrote ${dir}: flags.csv, sessions.csv (they hold what learners wrote: keep them out of git)`);
}
