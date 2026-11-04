import { z } from "zod";
import { flowOf, type StepKey } from "./flow";

// The study, as the admin panel's Settings page edits it (lib/server/settings.ts stores it): which topic pack it runs
// (lib/server/topics.ts), and the steps around it as blocks, each switched on or off with its own settings
// (lib/flow.ts lists the blocks and their order). The bandits study is one such setup, not something built in.
// Each saved version gets an id, and every new session logs the version it started under, so the analysis can tell
// sessions run under different settings apart. Defaults come from the environment and the topic pack.
// What defines Kai's behaviour or the test's structure is not here on purpose: it is fixed by design and shown
// read-only (the Settings page computes it from the code and the pack).

export const LessonPart = z
  .object({
    videoId: z.string().regex(/^[A-Za-z0-9_-]{11}$/, "A YouTube video id has 11 characters"),
    start: z.number().int().min(0).max(36_000),
    end: z.number().int().min(1).max(36_000),
    title: z.string().trim().min(2).max(90),
    channel: z.string().trim().max(40).default(""),
  })
  .refine((p) => p.end - p.start >= 10, "A part must be at least 10 seconds long");
export type LessonPart = z.infer<typeof LessonPart>;

/** A question after the final test (a topic pack's survey.json). */
export const SurveyItem = z.object({ id: z.string(), kind: z.enum(["scale", "choice"]), prompt: z.string(), low: z.string().optional(), high: z.string().optional(), options: z.array(z.string()).optional() });
export type SurveyItem = z.infer<typeof SurveyItem>;

/** What a topic pack says to participants in its own words (topics/<slug>/copy.json). */
export const TopicCopy = z.object({
  subject: z.string(), // "multi-armed bandits": the welcome page's step cards, the follow-up test's question
  headline: z.string(), // the welcome page's title
  kaiHello: z.string(), // Kai's first line, on the welcome page
  watchFocus: z.string(), // what to watch for (the watch page)
  correctionExample: z.string(), // the placeholder of the correction to Kai
  description: z.string(), // the page description (search results, link previews)
});
export type TopicCopy = z.infer<typeof TopicCopy>;

export const Settings = z
  .object({
    topic: z.string().min(1).max(40), // a topic pack's slug
    studyLine: z.string().trim().max(120), // the small line above the welcome page's title
    // both: the pilot's pretest, every set of knowledge items one after the other (content/pretest.ts)
    // minutes: every step a session runs has a time, shown as a clock on its page (see timing below); the pretest's and
    // the test's are per part (a set of knowledge items, a test form), each part with a clock of its own
    pretest: z.object({ on: z.boolean(), both: z.boolean().default(false), minutes: z.number().min(1).max(30).default(8) }),
    // the lesson, played back to back as one video
    watch: z.object({ on: z.boolean(), parts: z.array(LessonPart).max(8), minutes: z.number().min(2).max(40).default(10) }),
    // teaching is always on (it is what the platform is about); when participants may end it themselves, whichever first.
    // fixed: Kai asks the pack's fixed questions (script.json), the same for everyone, else it chooses its own from the
    // lesson's ideas. mind: Kai's mind, the graph of what Kai has understood (off for the study runs)
    teach: z.object({ stopAfterMessages: z.number().int().min(0).max(30), stopAfterMinutes: z.number().min(0).max(30), fixed: z.boolean().default(true), mind: z.boolean().default(true), minutes: z.number().min(2).max(40).default(10) }),
    practice: z.object({ on: z.boolean(), minutes: z.number().min(2).max(60), tries: z.number().int().min(1).max(5) }),
    // the final test is always on (the outcome). The follow-up test: on or off, and how many days after the final test
    // it opens on its own (0: right away); the admin panel can also open it early for one person or everyone. both: the
    // pilot's final test, both forms one after the other (each session's own form first), with no follow-up then
    // minutes: per test form (the pilot's two forms get twice as long)
    test: z.object({ followUp: z.boolean(), followUpDays: z.number().min(0).max(60), both: z.boolean().default(false), minutes: z.number().min(2).max(40).default(20) }),
    // soft (the pilot): each step's minutes are a recommended time. The clock counts down, then keeps counting past it
    // ("+2:10"), and nothing ends on its own: the learner takes as long as they need, and the time spent against the
    // recommended time is logged per step and part (step_time; the pretest's and test's also with their answers).
    // Off: a hard limit, and the step ends itself when it runs out (the pretest and the test are handed in, the lesson
    // closes, Kai wraps up, practice goes on to the test)
    timing: z.object({ soft: z.boolean().default(true) }),
    survey: z.object({ on: z.boolean() }),
    sessionDays: z.number().int().min(1).max(30),
    // the same in every condition. help: the part of the lesson about the idea in question, while teaching (Kai's card)
    // and in practice (Rewatch or Reread)
    tools: z.object({ calculator: z.boolean(), voice: z.boolean(), help: z.boolean().default(false) }),
    // the model budget for the whole site, per day (chat turns, Kai's solving, voice)
    dailyTurnLimit: z.number().int().min(50).max(50_000),
  })
  .refine((s) => !s.watch.on || s.watch.parts.length > 0, { message: "The video lesson needs at least one part (or switch it off)", path: ["watch", "parts"] });
export type Settings = z.infer<typeof Settings>;

/**
 * Settings saved before the study was arranged in blocks were flat (practiceMinutes, lesson, calculator, …): read
 * them into the blocks, so a stored version keeps working. Anything else passes through unchanged.
 */
export function migrateSettings(raw: Record<string, unknown>): Record<string, unknown> {
  // a test block saved before the follow-up had its own switch: "0 days" meant off
  const t = raw.test as { followUp?: unknown; followUpDays?: unknown } | undefined;
  if (t && typeof t === "object" && t.followUp === undefined && typeof t.followUpDays === "number") raw = { ...raw, test: { ...t, followUp: t.followUpDays > 0 } };
  // a test block saved with the follow-up on, before the pilot's both-forms switch: it keeps the follow-up (the
  // default, both forms, would leave no form for it)
  const t2 = raw.test as { followUp?: unknown; both?: unknown } | undefined;
  if (t2 && typeof t2 === "object" && t2.followUp === true && t2.both === undefined) raw = { ...raw, test: { ...t2, both: false } };
  if (!("practiceMinutes" in raw) && !("lesson" in raw) && !("calculator" in raw)) return raw;
  const r = raw as Record<string, never>;
  const out: Record<string, unknown> = {};
  if (r.practiceMinutes !== undefined || r.practiceTries !== undefined) out.practice = { on: true, minutes: r.practiceMinutes, tries: r.practiceTries };
  if (r.stopAfterMessages !== undefined || r.stopAfterMinutes !== undefined) out.teach = { stopAfterMessages: r.stopAfterMessages, stopAfterMinutes: r.stopAfterMinutes };
  if (r.lesson !== undefined) out.watch = { on: true, parts: r.lesson };
  if (r.delayedTestDays !== undefined) out.test = { followUp: Number(r.delayedTestDays) > 0, followUpDays: r.delayedTestDays, ...(Number(r.delayedTestDays) > 0 ? { both: false } : {}) };
  if (r.calculator !== undefined || r.voice !== undefined) out.tools = { calculator: r.calculator, voice: r.voice };
  if (r.sessionDays !== undefined) out.sessionDays = r.sessionDays;
  if (r.dailyTurnLimit !== undefined) out.dailyTurnLimit = r.dailyTurnLimit;
  return out;
}

/** What the participant pages need: the steps in order, the timings and tools, the topic's words. No limits, nothing
 * about the study's conditions. */
export type PublicSettings = {
  flow: StepKey[];
  practiceMinutes: number;
  practiceTries: number;
  stopAfterMessages: number;
  stopAfterMinutes: number;
  calculator: boolean;
  voice: boolean;
  help: boolean; // the lesson's passage or video moment as help, while teaching and in practice
  limits: { pretest: number; watch: number; teach: number; test: number; soft: boolean }; // minutes per step (the pretest: per set, the test: per form); soft: recommended, nothing ends at 0
  mind: boolean; // Kai's mind (the graph) while teaching and after the results
  survey: SurveyItem[] | null; // null: no questions after the test
  copy: TopicCopy & { studyLine: string };
  lessonKind: "video" | "text"; // the lesson step: the videos, or the pack's text lesson (lesson.json)
};
export const publicOf = (s: Settings, pack: { copy: TopicCopy; survey: SurveyItem[]; lesson?: unknown }): PublicSettings => ({
  flow: flowOf(s),
  practiceMinutes: s.practice.minutes,
  practiceTries: s.practice.tries,
  stopAfterMessages: s.teach.stopAfterMessages,
  stopAfterMinutes: s.teach.stopAfterMinutes,
  calculator: s.tools.calculator,
  voice: s.tools.voice,
  help: s.tools.help,
  mind: s.teach.mind,
  limits: { pretest: s.pretest.minutes, watch: s.watch.minutes, teach: s.teach.minutes, test: s.test.minutes, soft: s.timing.soft },
  survey: s.survey.on && pack.survey.length ? pack.survey : null,
  copy: { ...pack.copy, studyLine: s.studyLine },
  lessonKind: pack.lesson ? "text" : "video",
});
