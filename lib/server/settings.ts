import "server-only";
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { Redis } from "@upstash/redis";
import { config } from "./env";
import { bundle, practiceFile } from "./content";
import { record } from "./events";
import { Settings, type LessonPart } from "../settings";

// The study's settings (lib/settings.ts): defaults from the environment and the content files, overridden by what
// the admin saved on the Settings page. Upstash when configured, else .data/settings.json. Read with a short cache,
// so a change reaches every server instance within seconds. Each version has an id (a hash of its content); every
// save is logged (settings_change: who, which version, what changed).

const redis = config.upstash ? new Redis({ ...config.upstash, automaticDeserialization: false }) : null;
const KEY = "docendo:settings:v1";
const FILE = join(process.cwd(), ".data", "settings.json");

const channelOf = (title: string) => /^([^:]{2,30}):\s+/.exec(title)?.[1] ?? "";

/** The lesson as the content files define it. */
export function defaultLesson(): LessonPart[] {
  const parts = bundle.segments.length ? bundle.segments : bundle.videos.map((v) => ({ video: v.id, videoId: v.videoId, start: 0, end: v.durationSec ?? 600, title: v.title.replace(/^[^:]{2,30}:\s+/, "") }));
  return parts.map((s) => ({ videoId: s.videoId, start: Math.round(s.start), end: Math.round(s.end), title: s.title, channel: channelOf(bundle.videos.find((v) => v.videoId === s.videoId)?.title ?? "") }));
}

export function defaults(): Settings {
  return {
    practiceMinutes: config.practiceMinutes ?? practiceFile.minutes,
    practiceTries: config.practiceTries,
    stopAfterMessages: 12,
    stopAfterMinutes: 8,
    sessionDays: Math.round(config.sessionHours / 24),
    delayedTestDays: config.delayedTestDays ?? 0,
    calculator: true,
    voice: true,
    dailyTurnLimit: config.dailyTurnLimit,
    lesson: defaultLesson(),
  };
}

export const versionOf = (s: Settings) => createHash("sha1").update(JSON.stringify(s)).digest("hex").slice(0, 8);

let cache: { at: number; value: Settings } | null = null;

async function readStored(): Promise<Partial<Settings> | null> {
  try {
    const raw = redis ? ((await redis.get(KEY)) as string | null) : await readFile(FILE, "utf8");
    if (!raw) return null;
    return (typeof raw === "string" ? JSON.parse(raw) : raw) as Partial<Settings>;
  } catch {
    return null;
  }
}

/** The settings in force: saved values over the defaults (a saved value that no longer validates is ignored). */
export async function getSettings(): Promise<{ settings: Settings; version: string }> {
  if (!cache || Date.now() - cache.at > 10_000) {
    const merged = { ...defaults(), ...((await readStored()) ?? {}) };
    const parsed = Settings.safeParse(merged);
    cache = { at: Date.now(), value: parsed.success ? parsed.data : defaults() };
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
