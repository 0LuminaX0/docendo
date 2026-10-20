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
    pretest: z.object({ on: z.boolean() }),
    // the lesson, played back to back as one video
    watch: z.object({ on: z.boolean(), parts: z.array(LessonPart).max(8) }),
    // teaching is always on (it is what the platform is about); when participants may end it themselves, whichever first
    teach: z.object({ stopAfterMessages: z.number().int().min(0).max(30), stopAfterMinutes: z.number().min(0).max(30) }),
    practice: z.object({ on: z.boolean(), minutes: z.number().min(2).max(60), tries: z.number().int().min(1).max(5) }),
    // the final test is always on (the outcome). The follow-up test: on or off, and how many days after the final test
    // it opens on its own (0: right away); the admin panel can also open it early for one person or everyone
    test: z.object({ followUp: z.boolean(), followUpDays: z.number().min(0).max(60) }),
    survey: z.object({ on: z.boolean() }),
    sessionDays: z.number().int().min(1).max(30),
    // the same in every condition
    tools: z.object({ calculator: z.boolean(), voice: z.boolean() }),
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
  if (!("practiceMinutes" in raw) && !("lesson" in raw) && !("calculator" in raw)) return raw;
  const r = raw as Record<string, never>;
  const out: Record<string, unknown> = {};
  if (r.practiceMinutes !== undefined || r.practiceTries !== undefined) out.practice = { on: true, minutes: r.practiceMinutes, tries: r.practiceTries };
  if (r.stopAfterMessages !== undefined || r.stopAfterMinutes !== undefined) out.teach = { stopAfterMessages: r.stopAfterMessages, stopAfterMinutes: r.stopAfterMinutes };
  if (r.lesson !== undefined) out.watch = { on: true, parts: r.lesson };
  if (r.delayedTestDays !== undefined) out.test = { followUp: Number(r.delayedTestDays) > 0, followUpDays: r.delayedTestDays };
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
  survey: SurveyItem[] | null; // null: no questions after the test
  copy: TopicCopy & { studyLine: string };
};
export const publicOf = (s: Settings, pack: { copy: TopicCopy; survey: SurveyItem[] }): PublicSettings => ({
  flow: flowOf(s),
  practiceMinutes: s.practice.minutes,
  practiceTries: s.practice.tries,
  stopAfterMessages: s.teach.stopAfterMessages,
  stopAfterMinutes: s.teach.stopAfterMinutes,
  calculator: s.tools.calculator,
  voice: s.tools.voice,
  survey: s.survey.on && pack.survey.length ? pack.survey : null,
  copy: { ...pack.copy, studyLine: s.studyLine },
});
