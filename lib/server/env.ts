import "server-only";
import { randomBytes } from "node:crypto";
import { z } from "zod";

// All server configuration in one place. Nothing here is ever sent to the browser.

const Env = z.object({
  OPENROUTER_API_KEY: z.string().min(20).optional(),
  SESSION_SECRET: z.string().min(32).optional(),
  ACCESS_CODE: z.string().min(4).max(64).optional(),
  UPSTASH_REDIS_REST_URL: z.url().optional(),
  UPSTASH_REDIS_REST_TOKEN: z.string().min(10).optional(),
  DOCENDO_DEMO: z.enum(["0", "1"]).optional(), // "1" forces the offline Kai even when a key is set
  DAILY_TURN_LIMIT: z.coerce.number().int().positive().default(1500), // whole site, per UTC day
  SESSION_TURN_LIMIT: z.coerce.number().int().positive().default(45), // per learner session (Kai wraps up at 30)
  SESSION_TURNS_PER_MIN: z.coerce.number().int().positive().default(10), // one learner's burst
  IP_TURNS_PER_MIN: z.coerce.number().int().positive().default(120), // a whole network (a lab room shares one IP)
  IP_SESSIONS_PER_HOUR: z.coerce.number().int().positive().default(60),
});

const blank = (v: string | undefined) => (v && v.trim() ? v.trim() : undefined);
const parsed = Env.safeParse(Object.fromEntries(Object.keys(Env.shape).map((k) => [k, blank(process.env[k])])));
if (!parsed.success) throw new Error(`Invalid server environment:\n${z.prettifyError(parsed.error)}`);
const env = parsed.data;

// A missing secret is fatal in production; in development a random one per process is fine.
const devSecret = randomBytes(32).toString("hex");
export function sessionSecret(): string {
  if (env.SESSION_SECRET) return env.SESSION_SECRET;
  if (process.env.VERCEL_ENV === "production" || process.env.VERCEL_ENV === "preview")
    throw new ConfigError("SESSION_SECRET is not set");
  return devSecret;
}

export class ConfigError extends Error {}

export const config = {
  demo: !env.OPENROUTER_API_KEY || env.DOCENDO_DEMO === "1",
  accessCode: env.ACCESS_CODE,
  upstash: env.UPSTASH_REDIS_REST_URL && env.UPSTASH_REDIS_REST_TOKEN ? { url: env.UPSTASH_REDIS_REST_URL, token: env.UPSTASH_REDIS_REST_TOKEN } : null,
  dailyTurnLimit: env.DAILY_TURN_LIMIT,
  sessionTurnLimit: env.SESSION_TURN_LIMIT,
  sessionTurnsPerMin: env.SESSION_TURNS_PER_MIN,
  ipTurnsPerMin: env.IP_TURNS_PER_MIN,
  ipSessionsPerHour: env.IP_SESSIONS_PER_HOUR,
  sessionHours: 6,
};
