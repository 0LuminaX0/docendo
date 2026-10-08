import "server-only";
import { appendFile, mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { after } from "next/server";
import { Redis } from "@upstash/redis";
import { config } from "./env";

// The research log. Every server-side step (session start, each chat turn,
// practice checks, the test) and every client event (/api/log) becomes one
// JSON event, written to:
//   - Upstash Redis list `docendo:events:v1` when configured (durable: use this for the study),
//   - otherwise .data/events.jsonl on a developer machine,
//   - and always the function log (short retention on Vercel; a backup only).
// Events carry the session id, never an IP address or the access code.
// `pnpm events export` turns them into JSONL and CSV tables.

export const EVENTS_KEY = "docendo:events:v1";
export type Event = { t: string; sid: string; [k: string]: unknown };

const redis = config.upstash ? new Redis({ ...config.upstash, automaticDeserialization: false }) : null;
const localFile = !process.env.VERCEL ? join(process.cwd(), ".data", "events.jsonl") : null;
export const eventStore: "upstash" | "file" | "console" = redis ? "upstash" : localFile ? "file" : "console";
if (eventStore === "console" && process.env.VERCEL_ENV === "production")
  console.warn("Docendo: no durable event store. Set UPSTASH_REDIS_REST_URL/TOKEN or the study data will be lost.");

async function write(lines: string[]) {
  try {
    if (redis) await redis.rpush(EVENTS_KEY, ...lines);
    else if (localFile) {
      await mkdir(dirname(localFile), { recursive: true });
      await appendFile(localFile, lines.join("\n") + "\n");
    }
  } catch (e) {
    console.error(JSON.stringify({ t: "event-store-error", error: String(e).slice(0, 300) }));
  }
}

/** Record events after the response is sent, so logging never slows a learner down. */
export function record(events: Event | Event[]) {
  const at = new Date().toISOString();
  const lines = (Array.isArray(events) ? events : [events]).map((e) => JSON.stringify({ v: 1, at, ...e }));
  for (const l of lines) console.log(l);
  after(() => write(lines));
}

/** Coarse device info from the user agent: enough to group sessions, not to identify anyone. */
export function deviceOf(ua: string | null) {
  const s = ua ?? "";
  const browser = /Edg\//.test(s) ? "Edge" : /Firefox\//.test(s) ? "Firefox" : /Chrome\//.test(s) ? "Chrome" : /Safari\//.test(s) ? "Safari" : "other";
  const os = /Windows/.test(s) ? "Windows" : /Android/.test(s) ? "Android" : /iPhone|iPad/.test(s) ? "iOS" : /Mac OS X/.test(s) ? "macOS" : /Linux/.test(s) ? "Linux" : "other";
  return { browser, os, mobile: /Mobi|Android|iPhone/.test(s) };
}
