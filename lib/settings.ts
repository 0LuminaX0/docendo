import { z } from "zod";

// The study's adjustable settings, edited on the admin panel's Settings page (lib/server/settings.ts stores them).
// Each saved version gets an id, and every new session logs the version it started under, so the analysis can
// tell sessions run under different settings apart. Defaults come from the environment and the content files.
// What defines Kai's behaviour or the test's structure is not here on purpose (see FIXED below).

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

export const Settings = z.object({
  // practice (both conditions)
  practiceMinutes: z.number().min(2).max(60),
  practiceTries: z.number().int().min(1).max(5),
  // teaching: when participants may end it themselves ("I've taught all I can"), whichever comes first
  stopAfterMessages: z.number().int().min(0).max(30),
  stopAfterMinutes: z.number().min(0).max(30),
  // sessions and the delayed test (0 days: no delayed test)
  sessionDays: z.number().int().min(1).max(30),
  delayedTestDays: z.number().min(0).max(60),
  // tools, the same in both conditions
  calculator: z.boolean(),
  voice: z.boolean(),
  // the model budget for the whole site, per day (chat turns, Kai's solving, voice)
  dailyTurnLimit: z.number().int().min(50).max(50_000),
  // the lesson, played back to back as one video
  lesson: z.array(LessonPart).min(1).max(8),
});
export type Settings = z.infer<typeof Settings>;

/** What the participant pages need (no limits, nothing about the study's other condition). */
export type PublicSettings = Pick<Settings, "practiceMinutes" | "practiceTries" | "stopAfterMessages" | "stopAfterMinutes" | "calculator" | "voice">;
export const publicOf = (s: Settings): PublicSettings => ({
  practiceMinutes: s.practiceMinutes,
  practiceTries: s.practiceTries,
  stopAfterMessages: s.stopAfterMessages,
  stopAfterMinutes: s.stopAfterMinutes,
  calculator: s.calculator,
  voice: s.voice,
});

/** Shown read-only on the Settings page: part of the study design, changed in code with a reason, not mid-study. */
export const FIXED = [
  ["Kai feels ready", "at 80% of the facts it waits for, or 50% after 8 minutes of teaching (engine/tutor/policy.ts)"],
  ["Kai wraps up", "after 30 learner messages (engine/tutor/policy.ts)"],
  ["Practice problems", "6, in two rounds of three, the same in both conditions (topics/bandits/practice.json)"],
  ["Final test", "10 questions per form, two parallel forms A and B (topics/bandits/exercises.json)"],
  ["Conditions", "from the access code, balanced in blocks of 4; test forms alternate within each condition"],
] as const;
