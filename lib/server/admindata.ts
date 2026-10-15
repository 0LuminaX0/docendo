import "server-only";
import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { randomInt } from "node:crypto";
import { Redis } from "@upstash/redis";
import { config } from "./env";
import { EVENTS_KEY } from "./events";
import { tables, type Ev } from "../analytics";
import { balancedDraws } from "../codes";
export { conditionFor } from "../codes";

// Data for the admin panel: the research log (read back from where
// lib/server/events.ts writes it) and the access codes made in the panel.
// Upstash when configured (the study), else files in .data/ (a developer machine).

const redis = config.upstash ? new Redis({ ...config.upstash, automaticDeserialization: false }) : null;
const DATA = join(process.cwd(), ".data");

// ---------- the research log ----------

let cache: { at: number; events: Ev[] } | null = null;

/** Every event, oldest first; cached for 15 s so a few page views don't each read the whole list. */
export async function loadEvents(): Promise<Ev[]> {
  if (cache && Date.now() - cache.at < 15_000) return cache.events;
  const lines: string[] = [];
  if (redis) {
    const n = await redis.llen(EVENTS_KEY);
    for (let i = 0; i < n; i += 1000) lines.push(...((await redis.lrange(EVENTS_KEY, i, Math.min(n, i + 1000) - 1)) as string[]));
  } else if (existsSync(join(DATA, "events.jsonl"))) lines.push(...(await readFile(join(DATA, "events.jsonl"), "utf8")).split("\n"));
  const events: Ev[] = [];
  for (const l of lines) {
    if (!l.trim()) continue;
    try {
      const e = JSON.parse(l) as Ev;
      if (typeof e.t === "string" && typeof e.sid === "string" && typeof e.at === "string") events.push(e);
    } catch {
      // a broken line: skip it
    }
  }
  cache = { at: Date.now(), events };
  return events;
}

export async function loadTables() {
  const events = await loadEvents();
  return { events, ...tables(events.map((e) => ({ ...e }))) };
}

// ---------- access codes made in the admin panel ----------
// A code has a condition (direct, recursive, or random: alternating per use, so uses stay balanced), may turn
// on the team's test shortcuts, and may be limited to a number of uses. Sessions log the code's id, not the code.

export type CodeCondition = "direct" | "recursive" | "random";
export type StoredCode = {
  id: string;
  code: string;
  label: string;
  condition: CodeCondition;
  draw?: "direct" | "recursive"; // random codes: the condition of the first use, drawn at creation in balanced blocks of 4
  team: boolean;
  trial?: boolean; // a dry run: the participant's experience (no shortcuts, its own condition), counted with the tests
  maxUses: number | null;
  active: boolean;
  createdAt: string;
};

const CODES = "docendo:codes:v1";
const USES = "docendo:codeuses:v1";
const ALPHABET = "23456789ABCDEFGHJKMNPQRSTUVWXYZ"; // no 0/O, 1/I/L

export const keyOf = (code: string) => code.toUpperCase().replace(/[^0-9A-Z]/g, "");

type FileData = { codes: Record<string, StoredCode>; uses: Record<string, number> };
async function readFileData(): Promise<FileData> {
  try {
    return JSON.parse(await readFile(join(DATA, "codes.json"), "utf8")) as FileData;
  } catch {
    return { codes: {}, uses: {} };
  }
}
async function writeFileData(d: FileData) {
  await mkdir(dirname(join(DATA, "codes.json")), { recursive: true });
  await writeFile(join(DATA, "codes.json"), JSON.stringify(d, null, 2));
}

/**
 * A hash as Upstash returns it: with automatic deserialization off (as here), HGETALL gives the raw reply, a flat
 * [field, value, field, value, …] array, not an object. Read either shape into an object of strings.
 */
export function hashOf(raw: unknown): Record<string, string> {
  if (Array.isArray(raw)) {
    const out: Record<string, string> = {};
    for (let i = 0; i + 1 < raw.length; i += 2) out[String(raw[i])] = typeof raw[i + 1] === "string" ? (raw[i + 1] as string) : JSON.stringify(raw[i + 1]);
    return out;
  }
  if (raw && typeof raw === "object") return Object.fromEntries(Object.entries(raw).map(([k, v]) => [k, typeof v === "string" ? v : JSON.stringify(v)]));
  return {};
}

/** One stored code; null for a value that doesn't read as one (it is skipped, not allowed to break the page). */
function codeOf(v: string): StoredCode | null {
  try {
    const c = JSON.parse(v) as StoredCode;
    return c && typeof c.code === "string" && typeof c.id === "string" ? { ...c, createdAt: typeof c.createdAt === "string" ? c.createdAt : "" } : null;
  } catch {
    return null;
  }
}

export async function listCodes(): Promise<(StoredCode & { uses: number })[]> {
  let codes: StoredCode[];
  let uses: Record<string, number>;
  if (redis) {
    codes = Object.values(hashOf(await redis.hgetall(CODES))).map(codeOf).filter((c): c is StoredCode => c !== null);
    uses = Object.fromEntries(Object.entries(hashOf(await redis.hgetall(USES))).map(([k, v]) => [k, Number(v) || 0]));
  } else {
    const d = await readFileData();
    codes = Object.values(d.codes);
    uses = d.uses;
  }
  return codes.map((c) => ({ ...c, uses: uses[c.id] ?? 0 })).sort((a, b) => b.createdAt.localeCompare(a.createdAt) || a.code.localeCompare(b.code));
}

export async function findCode(raw: string): Promise<StoredCode | null> {
  const key = keyOf(raw);
  if (key.length < 4) return null;
  if (redis) {
    const v = (await redis.hget(CODES, key)) as string | null;
    return v ? (typeof v === "string" ? (JSON.parse(v) as StoredCode) : (v as StoredCode)) : null;
  }
  return (await readFileData()).codes[key] ?? null;
}

/** Count one use; returns the number of uses including this one. */
export async function useCode(c: StoredCode): Promise<number> {
  if (redis) return Number(await redis.hincrby(USES, c.id, 1));
  const d = await readFileData();
  d.uses[c.id] = (d.uses[c.id] ?? 0) + 1;
  await writeFileData(d);
  return d.uses[c.id]!;
}

export async function createCodes(opts: { count: number; prefix: string; label: string; condition: CodeCondition; team: boolean; trial?: boolean; maxUses: number | null }): Promise<StoredCode[]> {
  const prefix = keyOf(opts.prefix).slice(0, 10);
  const existing = new Set((await listCodes()).map((c) => keyOf(c.code)));
  const made: StoredCode[] = [];
  const draws = balancedDraws(opts.count);
  while (made.length < opts.count) {
    const tail = Array.from({ length: 6 }, () => ALPHABET[randomInt(ALPHABET.length)]).join("");
    const code = prefix ? `${prefix}-${tail}` : `${tail.slice(0, 3)}-${tail.slice(3)}`;
    if (existing.has(keyOf(code))) continue;
    existing.add(keyOf(code));
    made.push({ id: `c${tail}`, code, label: opts.label.slice(0, 60), condition: opts.condition, ...(opts.condition === "random" ? { draw: draws[made.length] } : {}), team: opts.team, ...(opts.trial && !opts.team ? { trial: true } : {}), maxUses: opts.maxUses, active: true, createdAt: new Date().toISOString() });
  }
  if (redis) await redis.hset(CODES, Object.fromEntries(made.map((c) => [keyOf(c.code), JSON.stringify(c)])));
  else {
    const d = await readFileData();
    for (const c of made) d.codes[keyOf(c.code)] = c;
    await writeFileData(d);
  }
  return made;
}

export async function updateCode(code: string, patch: Partial<Pick<StoredCode, "active" | "label" | "maxUses" | "condition" | "team" | "trial">>): Promise<StoredCode | null> {
  const c = await findCode(code);
  if (!c) return null;
  const next = { ...c, ...patch };
  if (redis) await redis.hset(CODES, { [keyOf(c.code)]: JSON.stringify(next) });
  else {
    const d = await readFileData();
    d.codes[keyOf(c.code)] = next;
    await writeFileData(d);
  }
  return next;
}

export async function deleteCode(code: string): Promise<boolean> {
  const c = await findCode(code);
  if (!c) return false;
  if (redis) await redis.hdel(CODES, keyOf(c.code));
  else {
    const d = await readFileData();
    delete d.codes[keyOf(c.code)];
    await writeFileData(d);
  }
  return true;
}
