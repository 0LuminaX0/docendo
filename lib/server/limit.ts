import "server-only";
import { Ratelimit } from "@upstash/ratelimit";
import { Redis } from "@upstash/redis";
import { config } from "./env";

// Rate limits. With Upstash Redis configured (free tier via the Vercel
// Marketplace) the counters are shared by every server instance. Without it,
// each instance counts on its own, which still stops a single client from
// hammering one instance but is weaker; the OpenRouter key's own credit limit
// is the final backstop either way.

export type LimitResult = { ok: boolean; retryAfter: number };

const redis = config.upstash ? new Redis(config.upstash) : null;
const limiters = new Map<string, Ratelimit>();

function upstash(limit: number, windowSec: number) {
  const key = `${limit}/${windowSec}`;
  let l = limiters.get(key);
  if (!l) {
    l = new Ratelimit({
      redis: redis!,
      limiter: windowSec >= 86_400 ? Ratelimit.fixedWindow(limit, `${windowSec} s`) : Ratelimit.slidingWindow(limit, `${windowSec} s`),
      prefix: "docendo",
      analytics: false,
    });
    limiters.set(key, l);
  }
  return l;
}

const memory = new Map<string, number[]>();

function memoryLimit(key: string, limit: number, windowSec: number): LimitResult {
  const now = Date.now();
  const from = now - windowSec * 1000;
  const hits = (memory.get(key) ?? []).filter((t) => t > from);
  if (hits.length >= limit) {
    memory.set(key, hits);
    return { ok: false, retryAfter: Math.ceil((hits[0]! + windowSec * 1000 - now) / 1000) };
  }
  hits.push(now);
  memory.set(key, hits);
  if (memory.size > 20_000) memory.clear(); // keep a long-lived instance bounded
  return { ok: true, retryAfter: 0 };
}

export async function limit(key: string, max: number, windowSec: number): Promise<LimitResult> {
  if (!redis) return memoryLimit(key, max, windowSec);
  try {
    const r = await upstash(max, windowSec).limit(key);
    return { ok: r.success, retryAfter: Math.max(0, Math.ceil((r.reset - Date.now()) / 1000)) };
  } catch {
    return memoryLimit(key, max, windowSec); // Redis hiccup: degrade, don't fail open completely
  }
}

/**
 * Run several limits; the first one that refuses wins. A check marked "local"
 * is counted in this server instance's memory only. Use that for bursts and for
 * endpoints that cost nothing: each shared (Upstash) check costs about five Redis
 * commands, and those add up against the free tier much faster than the research log.
 */
export async function limitAll(checks: [key: string, max: number, windowSec: number, where?: "local"][]): Promise<LimitResult> {
  for (const [key, max, win, where] of checks) {
    const r = where === "local" ? memoryLimit(key, max, win) : await limit(key, max, win);
    if (!r.ok) return r;
  }
  return { ok: true, retryAfter: 0 };
}
