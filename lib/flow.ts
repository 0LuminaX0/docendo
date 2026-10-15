// The blocks a study is built from, in the order a session runs through them. The study's settings
// (lib/settings.ts) switch the optional ones on or off; teaching Kai, the final test and the results are always there.
// Shared by the server (which steps a study has) and the browser (the header's step bars, where each step leads,
// which pages are open). Each block's page lives at its path; the step keys are what a saved session records.

export type StepKey = "pretest" | "watch" | "teach" | "practice" | "exercises" | "results";

export type Block = {
  key: StepKey;
  name: string; // as the header and the admin panel name it
  path: string;
  optional: boolean;
  bar: boolean; // one of the coloured step bars in the header (red, yellow, green, blue by key)
  about: string; // for the admin panel
};

export const BLOCKS: Block[] = [
  { key: "pretest", name: "Before you start", path: "/pretest", optional: true, bar: false, about: "Background questions and a few on neighbouring ideas, each with \"I don't know\". Graded and logged, nothing shown back." },
  { key: "watch", name: "Watch", path: "/watch", optional: true, bar: true, about: "The video lesson: parts of YouTube videos played back to back in one player." },
  { key: "teach", name: "Teach Kai", path: "/teach", optional: false, bar: true, about: "A chat in which the learner explains the lesson to Kai until Kai feels ready. The heart of the platform." },
  { key: "practice", name: "Practice", path: "/practice", optional: true, bar: true, about: "The pack's practice problems: the learner solves them (direct feedback) or Kai does, from its notebook (recursive feedback)." },
  { key: "exercises", name: "Final test", path: "/exercises", optional: false, bar: true, about: "One of the pack's test forms, graded on the server. The outcome the study compares." },
  { key: "results", name: "Results", path: "/results", optional: false, bar: false, about: "The score, every answer explained and the practice's worked solutions; the questions after the test come first if switched on." },
];
const ORDER = BLOCKS.map((b) => b.key);

export const blockOf = (key: StepKey) => BLOCKS.find((b) => b.key === key)!;
export const pathOf = (key: StepKey) => blockOf(key).path;

/** The steps a study runs, in order. */
export function flowOf(s: { pretest: { on: boolean }; watch: { on: boolean; parts: unknown[] }; practice: { on: boolean } }): StepKey[] {
  return ORDER.filter((k) => (k === "pretest" ? s.pretest.on : k === "watch" ? s.watch.on && s.watch.parts.length > 0 : k === "practice" ? s.practice.on : true));
}

/** Where a learner goes after `here`: the next step the study runs (the results at the end). */
export function nextStep(flow: StepKey[], here: StepKey): StepKey {
  const i = ORDER.indexOf(here);
  return flow.find((k) => ORDER.indexOf(k) > i) ?? "results";
}
/** The first step of a new session. */
export const firstStep = (flow: StepKey[]): StepKey => flow[0] ?? "teach";

/** Where a saved session stands, as a step the study still runs (a step switched off since sends it on). */
export function currentStep(flow: StepKey[], step: StepKey): StepKey {
  return flow.includes(step) ? step : nextStep(flow, step);
}

/** A step's page is open once the session has reached it, and only if the study runs it. */
export const reached = (flow: StepKey[], step: StepKey, here: StepKey) => flow.includes(here) && ORDER.indexOf(here) <= ORDER.indexOf(currentStep(flow, step));

/** The coloured bars in the header: the main steps the study runs. */
export const barsOf = (flow: StepKey[]) => flow.filter((k) => blockOf(k).bar);

/** Rough minutes per step, for the welcome page and the admin panel (teaching: Kai feels ready after 8 to 12 minutes
 * for most learners). */
export function minutesOf(key: StepKey, s: { practice: { minutes: number }; watch: { parts: { start: number; end: number }[] } }, n: { pretest: number; test: number }): number {
  switch (key) {
    case "pretest":
      return Math.max(1, Math.round(n.pretest * 0.4));
    case "watch":
      return Math.round(s.watch.parts.reduce((a, p) => a + Math.max(0, p.end - p.start), 0) / 60);
    case "teach":
      return 10;
    case "practice":
      return s.practice.minutes;
    case "exercises":
      return n.test;
    case "results":
      return 3;
  }
}
