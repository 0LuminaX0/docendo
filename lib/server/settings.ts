import "server-only";
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { Redis } from "@upstash/redis";
import { config } from "./env";
import { DEFAULT_TOPIC, hasTopic, packFor, type Pack } from "./content";
import { record } from "./events";
import { Settings, migrateSettings, type LessonPart } from "../settings";

// The study's settings (lib/settings.ts): defaults from the environment and the topic pack, overridden by what the
// admin saved on the Settings page (block by block, so a block the save didn't touch keeps its defaults). Upstash when configured, else .data/settings.json. Read with a short cache,
// so a change reaches every server instance within seconds. Each version has an id (a hash of its content); every
// save is logged (settings_change: who, which version, what changed).

const redis = config.upstash ? new Redis({ ...config.upstash, automaticDeserialization: false }) : null;
const KEY = "docendo:settings:v1";
const FILE = join(process.cwd(), ".data", "settings.json");

const channelOf = (title: string) => /^([^:]{2,30}):\s+/.exec(title)?.[1] ?? "";

/** A topic pack's lesson as its content files define it (topic.yaml's lesson, else the whole videos). */
export function defaultLesson(pack: Pack): LessonPart[] {
  const { bundle } = pack;
  const parts = bundle.segments.length ? bundle.segments : bundle.videos.map((v) => ({ video: v.id, videoId: v.videoId, start: 0, end: v.durationSec ?? 600, title: v.title.replace(/^[^:]{2,30}:\s+/, "") }));
  return parts.map((s) => ({ videoId: s.videoId, start: Math.round(s.start), end: Math.round(s.end), title: s.title, channel: channelOf(bundle.videos.find((v) => v.videoId === s.videoId)?.title ?? "") }));
}

/** The defaults: the environment, and the topic pack's own lesson and practice timing. */
export function defaults(topic = config.topic ?? DEFAULT_TOPIC): Settings {
  const pack = packFor(topic);
  return {
    topic: pack.slug,
    studyLine: "A learning-by-teaching study for CS-411 Digital Education, EPFL",
    pretest: { on: true },
    watch: { on: true, parts: defaultLesson(pack) },
    teach: { stopAfterMessages: 12, stopAfterMinutes: 8 },
    practice: { on: true, minutes: config.practiceMinutes ?? pack.practiceFile.minutes, tries: config.practiceTries },
    test: { followUpDays: config.delayedTestDays ?? 0 },
    survey: { on: true },
    sessionDays: Math.round(config.sessionHours / 24),
    tools: { calculator: true, voice: true },
    dailyTurnLimit: config.dailyTurnLimit,
  };
}

/** Saved values over the defaults, block by block. A topic other than the default's brings its own lesson. */
export function merge(stored: Record<string, unknown> | null): Settings {
  const saved = migrateSettings(stored ?? {}) as Partial<Record<keyof Settings, unknown>>;
  const topic = typeof saved.topic === "string" && hasTopic(saved.topic) ? saved.topic : undefined;
  const base = defaults(topic);
  const out: Record<string, unknown> = { ...base };
  for (const k of Object.keys(base) as (keyof Settings)[]) {
    if (k === "topic") continue; // resolved above: a pack this server has
    const v = saved[k];
    if (v === undefined || v === null) continue;
    const b = base[k];
    out[k] = typeof b === "object" && !Array.isArray(b) && typeof v === "object" && !Array.isArray(v) ? { ...b, ...Object.fromEntries(Object.entries(v).filter(([, x]) => x !== undefined)) } : v;
  }
  const parsed = Settings.safeParse(out);
  return parsed.success ? parsed.data : base;
}

export const versionOf = (s: Settings) => createHash("sha1").update(JSON.stringify(s)).digest("hex").slice(0, 8);

let cache: { at: number; value: Settings } | null = null;

async function readStored(): Promise<Record<string, unknown> | null> {
  try {
    const raw = redis ? ((await redis.get(KEY)) as string | null) : await readFile(FILE, "utf8");
    if (!raw) return null;
    return (typeof raw === "string" ? JSON.parse(raw) : raw) as Record<string, unknown>;
  } catch {
    return null;
  }
}

/** The settings in force: saved values over the defaults (a saved version that no longer validates gives the defaults). */
export async function getSettings(opts: { fresh?: boolean } = {}): Promise<{ settings: Settings; version: string }> {
  // fresh: the admin pages read the store every time (another route may have saved a moment ago)
  if (!cache || opts.fresh || Date.now() - cache.at > 10_000) {
    cache = { at: Date.now(), value: merge(await readStored()) };
  }
  return { settings: cache.value, version: versionOf(cache.value) };
}

/** Save new settings (validated by the caller); returns the new version. */
export async function saveSettings(next: Settings): Promise<string> {
  const before = (await getSettings()).settings;
  const json = JSON.stringify(next);
  if (redis) await redis.set(KEY, json);
  else {
    await mkdir(join(process.cwd(), ".data"), { recursive: true });
    await writeFile(FILE, json);
  }
  cache = { at: Date.now(), value: next };
  const changed = (Object.keys(next) as (keyof Settings)[]).filter((k) => JSON.stringify(next[k]) !== JSON.stringify(before[k]));
  record({ t: "settings_change", sid: "admin", version: versionOf(next), from: versionOf(before), changed, values: Object.fromEntries(changed.map((k) => [k, next[k]])) });
  return versionOf(next);
}

/** Back to the defaults (the stored settings are removed). */
export async function resetSettings(): Promise<string> {
  if (redis) await redis.del(KEY);
  else await writeFile(FILE, "{}").catch(() => {});
  cache = null;
  const { version } = await getSettings();
  record({ t: "settings_change", sid: "admin", version, reset: true });
  return version;
}
