import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { barsOf, currentStep, firstStep, flowOf, minutesOf, nextStep, reached } from "../lib/flow";
import { Settings, migrateSettings, publicOf } from "../lib/settings";
import { defaults, merge } from "../lib/server/settings";
import { hasTopic, packFor, topicSlugs } from "../lib/server/content";
import { packSummary } from "../lib/server/study";

// The study as blocks around a topic pack: which steps run, where each leads, what a stored version becomes.

const on = { pretest: { on: true }, watch: { on: true, parts: [{}] }, practice: { on: true } };

describe("the flow", () => {
  it("runs every step when all are on, and always teaching, the test and the results", () => {
    expect(flowOf(on)).toEqual(["pretest", "watch", "teach", "practice", "exercises", "results"]);
    expect(flowOf({ pretest: { on: false }, watch: { on: false, parts: [] }, practice: { on: false } })).toEqual(["teach", "exercises", "results"]);
  });
  it("skips a video step with no parts", () => {
    expect(flowOf({ ...on, watch: { on: true, parts: [] } })).not.toContain("watch");
  });
  it("leads from each step to the next one the study runs", () => {
    const flow = flowOf({ pretest: { on: false }, watch: { on: true, parts: [{}] }, practice: { on: false } });
    expect(firstStep(flow)).toBe("watch");
    expect(nextStep(flow, "watch")).toBe("teach");
    expect(nextStep(flow, "teach")).toBe("exercises"); // no practice
    expect(nextStep(flow, "exercises")).toBe("results");
  });
  it("moves a saved session past a step switched off since", () => {
    const flow = flowOf({ ...on, practice: { on: false } });
    expect(currentStep(flow, "practice")).toBe("exercises");
    expect(reached(flow, "practice", "teach")).toBe(true);
    expect(reached(flow, "practice", "practice")).toBe(false); // the page of a step that is off stays closed
    expect(reached(flow, "teach", "exercises")).toBe(false); // not reached yet
  });
  it("draws one header bar per main step", () => {
    expect(barsOf(flowOf(on))).toEqual(["watch", "teach", "practice", "exercises"]);
    expect(barsOf(flowOf({ ...on, watch: { on: false, parts: [] } }))).toEqual(["teach", "practice", "exercises"]);
  });
  it("estimates minutes from the settings and the pack", () => {
    const s = { practice: { minutes: 12 }, watch: { parts: [{ start: 0, end: 300 }, { start: 60, end: 120 }] } };
    expect(minutesOf("watch", s, { pretest: 5, test: 10 })).toBe(6);
    expect(minutesOf("practice", s, { pretest: 5, test: 10 })).toBe(12);
    expect(minutesOf("exercises", s, { pretest: 5, test: 10 })).toBe(10);
  });
});

describe("settings", () => {
  it("reads a version saved before the blocks into them", () => {
    const old = { practiceMinutes: 12, practiceTries: 3, stopAfterMessages: 6, stopAfterMinutes: 5, sessionDays: 7, delayedTestDays: 9, calculator: false, voice: true, dailyTurnLimit: 900, lesson: [{ videoId: "e3L4VocZnnQ", start: 0, end: 111, title: "Part one", channel: "x" }] };
    const m = merge(old);
    expect(m.practice).toEqual({ on: true, minutes: 12, tries: 3 });
    expect(m.teach).toEqual({ stopAfterMessages: 6, stopAfterMinutes: 5 });
    expect(m.test.followUpDays).toBe(9);
    expect(m.tools).toEqual({ calculator: false, voice: true });
    expect(m.watch.parts).toHaveLength(1);
    expect(m.sessionDays).toBe(7);
    expect(migrateSettings({ topic: "bandits" })).toEqual({ topic: "bandits" }); // new shape: unchanged
  });
  it("keeps a block's defaults for what a save didn't touch", () => {
    const m = merge({ practice: { minutes: 15 } });
    expect(m.practice.minutes).toBe(15);
    expect(m.practice.tries).toBe(defaults().practice.tries);
    expect(m.practice.on).toBe(true);
  });
  it("falls back to the defaults when a stored version no longer validates, and to the default topic for an unknown one", () => {
    expect(merge({ practice: { minutes: 999 } })).toEqual(defaults());
    expect(merge({ topic: "nope" }).topic).toBe("bandits");
  });
  it("refuses a video step without parts", () => {
    const d = defaults();
    expect(Settings.safeParse({ ...d, watch: { on: true, parts: [] } }).success).toBe(false);
    expect(Settings.safeParse({ ...d, watch: { on: false, parts: [] } }).success).toBe(true);
  });
  it("gives the browser the flow, the pack's words and the survey only when it is on", () => {
    const d = defaults();
    const pack = packFor(d.topic);
    const p = publicOf(d, pack);
    expect(p.flow).toEqual(flowOf(d));
    expect(p.copy.subject).toBe(pack.copy.subject);
    expect(p.survey?.length).toBe(pack.survey.length);
    expect(publicOf({ ...d, survey: { on: false } }, pack).survey).toBeNull();
    // nothing from the pack that the browser mustn't see
    const json = JSON.stringify(p);
    for (const q of pack.exercises) expect(json).not.toContain(q.explain);
  });
});

describe("topic packs", () => {
  it("lists the bandits pack, with two test forms of the same length", () => {
    expect(topicSlugs()).toContain("bandits");
    expect(hasTopic("bandits")).toBe(true);
    const pack = packFor("bandits");
    expect(pack.forms).toEqual(["A", "B"]);
    expect(pack.formItems("A").length).toBe(pack.formItems("B").length);
    expect(packFor("unknown").slug).toBe("bandits"); // an old token or a stale setting
  });
  it("counts the study from the pack, not from text written down", () => {
    const d = defaults();
    const pack = packFor(d.topic);
    const sum = packSummary(pack, d);
    expect(sum.practice.problems).toBe(pack.practice.length);
    expect(sum.forms[0]!.items).toBe(pack.formItems("A").length);
    expect(sum.blocks.watch).toContain(`${d.watch.parts.length} parts`);
    expect(sum.total).toBeGreaterThan(20);
    // switching a step off takes its minutes out of the session
    const without = packSummary(pack, { ...d, practice: { ...d.practice, on: false } });
    expect(sum.total - without.total).toBe(d.practice.minutes);
  });
});

describe("Upstash replies", () => {
  it("reads a hash from the raw HGETALL reply (a flat array) or an object", async () => {
    const { hashOf } = await import("../lib/server/admindata");
    const code = JSON.stringify({ id: "cABC", code: "X-ABC", createdAt: "2026-10-15" });
    expect(hashOf(["XABC", code, "XDEF", code])).toEqual({ XABC: code, XDEF: code });
    expect(hashOf(["cABC", "3"])).toEqual({ cABC: "3" });
    expect(hashOf({ cABC: 3 })).toEqual({ cABC: "3" });
    expect(hashOf(null)).toEqual({});
    expect(hashOf([])).toEqual({});
  });
});

describe("checking a topic pack before it ships", () => {
  it("passes the bandits pack and catches a broken one", async () => {
    const { checkPack } = await import("../content/pack");
    const { mkdtempSync, mkdirSync, writeFileSync, cpSync } = await import("node:fs");
    const { join } = await import("node:path");
    const { tmpdir } = await import("node:os");
    expect(checkPack("bandits").filter((i) => i.level === "error")).toEqual([]);
    // a copy of the pack with a broken copy.json, uneven test forms and a practice problem needing an unknown fact
    const root = mkdtempSync(join(tmpdir(), "docendo-pack-"));
    const dir = join(root, "topics", "broken");
    mkdirSync(dir, { recursive: true });
    for (const f of ["bundle.json", "pretest.json", "survey.json"]) cpSync(join("topics/bandits", f), join(dir, f));
    writeFileSync(join(dir, "copy.json"), JSON.stringify({ subject: "x" }));
    const practice = JSON.parse(readFileSync("topics/bandits/practice.json", "utf8"));
    practice.items[0].needs = ["n99.f9"];
    writeFileSync(join(dir, "practice.json"), JSON.stringify(practice));
    const tests = JSON.parse(readFileSync("topics/bandits/exercises.json", "utf8"));
    tests.items = tests.items.filter((q: { id: string }) => q.id !== "r10");
    writeFileSync(join(dir, "exercises.json"), JSON.stringify(tests));
    const errors = checkPack("broken", root).filter((i) => i.level === "error").map((i) => `${i.where}: ${i.msg}`);
    expect(errors.some((e) => e.startsWith("copy.json"))).toBe(true);
    expect(errors.some((e) => e.includes("n99.f9"))).toBe(true);
    expect(errors.some((e) => e.includes("parallel forms must match"))).toBe(true);
  });
});

describe("the dashboard's score charts", () => {
  it("follow the test's length, not a fixed 10", async () => {
    const { charts } = await import("../lib/analytics");
    const row = (sid: string, condition: string, testScore: number) => ({ sid, condition, entry: "participant", demo: false, phase: "main", startedAt: "2026-10-18T10:00:00Z", reachedStep: "results", testScore, testOf: 6 });
    const c = charts({ sessions: [row("a", "direct", 4), row("b", "recursive", 6), row("c", "recursive", 5)] }, { all: true });
    expect(c.testMax).toBe(6);
    expect(c.hist.direct).toHaveLength(7);
    expect(c.hist.recursive[6]).toBe(1);
  });
});
