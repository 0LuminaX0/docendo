"use client";

import { useCallback, useSyncExternalStore } from "react";
import type { Passage } from "@/lib/lesson";
import type { State } from "@/engine/tutor/state";
import type { Mind } from "@/engine/tutor/mind";
import type { TestAnswer } from "@/lib/answers";

// Progress lives in this browser only (localStorage), so a reload or a closed
// tab doesn't lose the session. Nothing here is secret: the token is useless
// without the server's secret, and answers are graded on the server.

// learned: the ideas Kai finished with this reply (shown as a small milestone under it)
// help: a video moment the learner opened ({ part, start }), or a passage of the text lesson ({ section, title })
export type Turn = { role: "kai" | "learner"; text: string; mood?: Mood; help?: { part: number; start: number } | { section: string; title: string }; learned?: string[] };
// the judge's moods (great, okay, confused) plus faces drawn only in the browser: neutral, thinking, aha (an idea just
// landed), proud (Kai feels ready)
export type Mood = "neutral" | "great" | "okay" | "confused" | "thinking" | "aha" | "proud";
/** Kai's help card: a moment of the video lesson, or a passage of the text lesson (its text once help is open). */
export type Help = { video: string; start: number; end: number } | Passage;
export type GradeResult = {
  score: number;
  of: number;
  // choice items: chosen is the option's index; multi: the statements ticked (answer: the true ones); number items: the
  // typed answer, and key the value with its unit; "idk": I don't know
  items: { id: string; form?: "A" | "B"; kind?: "choice" | "multi" | "number"; chosen: TestAnswer; answer: number | number[]; key?: string; correct: boolean; explain: string }[];
  // a pilot's two forms: the score in each part (absent with one form)
  parts?: { form: "A" | "B"; score: number; of: number }[];
  // the practice problems' worked solutions, shown only after the test (absent in older sessions)
  practice?: { id: string; round: number; title: string; prompt: string; options: string[] | null; answer: string; answerIndex: number | null; steps: string[] }[];
  // a person with a follow-up test: when it opens (null or absent: no follow-up for this session)
  followUp?: { opensAt: number } | null;
};

/** One test question as the browser gets it: no key, no explanation, nothing for the team. */
export type TestItem = {
  id: string;
  form?: "A" | "B";
  section: string;
  kind: "choice" | "multi" | "number";
  prompt: string;
  table?: { head: string[]; rows: string[][] } | null;
  question?: string | null;
  options: string[] | null;
  unit: string | null;
  dontKnow?: boolean;
  reason?: boolean;
};

export type PracticeEntry = {
  work: string; // the learner's own working
  answer: string; // typed number, or the chosen option index as a string
  checks: number; // how many times the learner checked (at most the number of tries)
  hints?: number; // how many times the learner replayed the lesson moment
  correct: boolean | null; // result of the last check
  firstCorrect?: boolean; // result of the first check
  ms?: number; // time spent on this problem
};
export type Condition = "direct" | "recursive";

/** Recursive feedback: Kai's attempts at one problem (two at most), and the learner's one correction. */
export type KaiStep = { text: string; notes: number[] };
export type KaiAttempt = { steps: KaiStep[]; answer: string; correct: boolean; notes: string[]; call?: boolean }; // call: the learner's guess before the light (true = right)
export type KaiEntry = { attempts: KaiAttempt[]; clicks: number[]; correction: string | null; ms?: number };

// one problem at a time, in order; `current` is its index. `view` is the condition a team session looks at.
export type PracticeState = { startedAt: number | null; current?: number; items: Record<string, PracticeEntry>; kai?: Record<string, KaiEntry>; view?: Condition };
export const blankEntry = (): PracticeEntry => ({ work: "", answer: "", checks: 0, correct: null });

export type Saved = {
  v: 1;
  token: string;
  expiresAt: number;
  demo: boolean;
  team?: boolean; // started with the shared code (or no code): test shortcuts are on. Participants' own codes: false
  condition?: Condition; // from the participant's code (team sessions: direct, with a switch on the practice page)
  startedAt: number;
  step: "pretest" | "watch" | "teach" | "practice" | "exercises" | "results";
  phase?: "main" | "delayed"; // delayed: the follow-up test only (a session of its own, days after the main one)
  finishedAt?: number; // when the test was graded (the follow-up opens some days later)
  pretest?: (number | null)[]; // answers before the video (sessions started before the pretest have none)
  pretestSets?: string[]; // the pretest's knowledge sets this session takes, in order (a pilot: every set)
  pretestAnswers?: Record<string, number>; // the pretest's answers by item id (an option's index)
  pretestPart?: number; // a pilot's pretest: how many parts are done and locked
  pretestStartedAt?: number; // when the pretest opened (its time limit survives a reload)
  testStartedAt?: number; // when the final (or follow-up) test opened
  practice?: PracticeState; // absent in sessions started before the practice chapter existed
  watched: string[]; // lesson parts watched (≥ 90%), as "s0", "s1", …
  watchedSec?: number[]; // seconds watched per lesson part
  readStartedAt?: number; // a text lesson: when reading began (the minimum time before "Continue" survives a reload)
  readAt?: number; // a text lesson: the chapter on screen, and the furthest one reached (a reload keeps the place)
  readMax?: number;
  readChapterAt?: number; // when the chapter on screen opened (its "Next" waits for a quick read of it)
  chat: {
    startedAt?: number; // when the teach page first opened (for Kai's 8-minute rule and the log)
    turns: Turn[];
    state: State | null;
    progress: number;
    mind: Mind | null;
    done: boolean;
    skipped: boolean;
    timeUp?: boolean; // teaching ended at its time limit (skipped is set too: the chat is closed)
    mood: Mood;
    help: Help | null;
    helpAvailable: boolean;
    // what Kai's mind showed when the learner last left it, per idea: its status and facts explained (correct, partly),
    // so the next look can mark what changed
    mindSeen?: Record<string, [string, number, number]>;
  };
  answers: TestAnswer[]; // final test: an option's index, the statements ticked, a typed number, or "idk" (lib/answers.ts)
  testWork?: Record<string, string>; // final test: the reason (or the working) under each question
  testOrder?: string[]; // final test: the item ids in the order this learner sees them (lib/order.ts)
  testItems?: TestItem[]; // this session's questions (its form, or both in a pilot), from the server
  testPart?: number; // a pilot's two forms: how many parts are done and locked (0: on the first)
  since?: "no" | "a little" | "a lot"; // delayed test: has the learner looked at the topic since the session?
  result: GradeResult | null;
  feedbackSent?: boolean;
  surveyDone?: boolean; // the questions after the final test (answered or skipped), before the score
};

const KEY = "docendo:session:v1";
const EVENT = "docendo:store";
let cache: { raw: string | null; value: Saved | null } = { raw: null, value: null };

function read(): Saved | null {
  let raw: string | null = null;
  try {
    raw = localStorage.getItem(KEY);
  } catch {
    return null;
  }
  if (raw === cache.raw) return cache.value;
  let value: Saved | null = null;
  try {
    const v = raw ? (JSON.parse(raw) as Saved) : null;
    value = v && v.v === 1 && v.expiresAt > Date.now() ? v : null;
  } catch {
    value = null;
  }
  cache = { raw, value };
  return value;
}

export function save(next: Saved | null) {
  try {
    if (next) localStorage.setItem(KEY, JSON.stringify(next));
    else localStorage.removeItem(KEY);
  } catch {
    // private mode or full storage: the session still works until reload
    cache = { raw: next ? JSON.stringify(next) : null, value: next };
  }
  window.dispatchEvent(new Event(EVENT));
}

function subscribe(cb: () => void) {
  window.addEventListener("storage", cb);
  window.addEventListener(EVENT, cb);
  return () => {
    window.removeEventListener("storage", cb);
    window.removeEventListener(EVENT, cb);
  };
}

/** `undefined` while hydrating, `null` when there is no session. */
export function useSaved(): [Saved | null | undefined, (f: (s: Saved) => Saved) => void] {
  const value = useSyncExternalStore(subscribe, read, () => undefined);
  const update = useCallback((f: (s: Saved) => Saved) => {
    const cur = read();
    if (cur) save(f(cur));
  }, []);
  return [value, update];
}

export function newSession(token: string, expiresAt: number, demo: boolean, team = true, condition: Condition = "direct"): Saved {
  return {
    v: 1,
    token,
    expiresAt,
    demo,
    team,
    condition,
    startedAt: Date.now(),
    step: "pretest",
    watched: [],
    chat: { turns: [], state: null, progress: 0, mind: null, done: false, skipped: false, mood: "neutral", help: null, helpAvailable: false },
    practice: { startedAt: null, items: {} },
    answers: [],
    result: null,
  };
}

export async function post<T>(url: string, body: unknown): Promise<{ ok: true; data: T } | { ok: false; status: number; error: string; expired?: boolean }> {
  try {
    const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const json = (await res.json().catch(() => ({}))) as { error?: string; expired?: boolean };
    if (!res.ok) return { ok: false, status: res.status, error: json.error ?? "Something went wrong.", expired: json.expired };
    return { ok: true, data: json as T };
  } catch {
    return { ok: false, status: 0, error: "No connection. Check your internet and try again." };
  }
}
