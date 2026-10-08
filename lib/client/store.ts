"use client";

import { useCallback, useSyncExternalStore } from "react";
import type { State } from "@/engine/tutor/state";
import type { Mind } from "@/engine/tutor/mind";

// Progress lives in this browser only (localStorage), so a reload or a closed
// tab doesn't lose the session. Nothing here is secret: the token is useless
// without the server's secret, and answers are graded on the server.

export type Turn = { role: "kai" | "learner"; text: string; mood?: Mood; help?: { part: number; start: number } };
export type Mood = "neutral" | "great" | "okay" | "confused" | "thinking";
export type Help = { video: string; start: number; end: number };
export type GradeResult = {
  score: number;
  of: number;
  items: { id: string; chosen: number | null; answer: number; correct: boolean; explain: string }[];
  // the practice problems' worked solutions, shown only after the test (absent in older sessions)
  practice?: { id: string; round: number; title: string; prompt: string; options: string[] | null; answer: string; answerIndex: number | null; steps: string[] }[];
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
export type KaiAttempt = { steps: KaiStep[]; answer: string; correct: boolean; notes: string[] };
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
  pretest?: (number | null)[]; // answers before the video (sessions started before the pretest have none)
  practice?: PracticeState; // absent in sessions started before the practice chapter existed
  watched: string[]; // lesson parts watched (≥ 90%), as "s0", "s1", …
  watchedSec?: number[]; // seconds watched per lesson part
  chat: {
    startedAt?: number; // when the teach page first opened (for Kai's 8-minute rule and the log)
    turns: Turn[];
    state: State | null;
    progress: number;
    mind: Mind | null;
    done: boolean;
    skipped: boolean;
    mood: Mood;
    help: Help | null;
    helpAvailable: boolean;
  };
  answers: (number | null)[];
  result: GradeResult | null;
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
