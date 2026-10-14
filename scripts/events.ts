// Research data export.
//   pnpm events export              all events → data/export-<time>/ (JSONL + CSV tables)
//   pnpm events export --from f.jsonl   use a local events file instead of Upstash
//   pnpm events summary             a quick overview in the terminal
// Reads Upstash Redis when UPSTASH_REDIS_REST_URL/TOKEN are set (.env), otherwise .data/events.jsonl.
// The output contains what learners wrote: keep it out of git (data/ is ignored) and share it carefully.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { Redis } from "@upstash/redis";

import { mean, tables, toCsv, type Ev } from "../lib/analytics";

const EVENTS_KEY = "docendo:events:v1";

// .env, and .env.local (what `vercel env pull .env.local` writes)
for (const f of [".env", ".env.local"]) {
  try {
    process.loadEnvFile?.(f);
  } catch {
    // file missing: use the environment as is
  }
}

async function load(from?: string): Promise<Ev[]> {
  const parse = (lines: string[]) => {
    const all = lines.filter((l) => l.trim()).map((l) => JSON.parse(l) as Ev);
    const ok = all.filter((e) => typeof e.t === "string" && typeof e.sid === "string" && typeof e.at === "string");
    if (ok.length < all.length) console.warn(`skipped ${all.length - ok.length} malformed events`);
    return ok;
  };
  if (from) return parse(readFileSync(from, "utf8").split("\n"));
  const url = process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN;
  if (url && token) {
    const redis = new Redis({ url, token, automaticDeserialization: false });
    const n = await redis.llen(EVENTS_KEY);
    const out: string[] = [];
    for (let i = 0; i < n; i += 1000) out.push(...((await redis.lrange(EVENTS_KEY, i, Math.min(n, i + 1000) - 1)) as string[]));
    console.log(`read ${out.length} events from Upstash`);
    return parse(out);
  }
  const local = join(".data", "events.jsonl");
  if (!existsSync(local)) throw new Error("No events: set UPSTASH_REDIS_REST_URL/TOKEN in .env, or run the app locally first.");
  console.log(`read events from ${local}`);
  return parse(readFileSync(local, "utf8").split("\n"));
}

// ---------- commands ----------

const [cmd = "summary", ...rest] = process.argv.slice(2);
const from = rest.includes("--from") ? rest[rest.indexOf("--from") + 1] : undefined;
const events = await load(from);
const t = tables(events);

if (cmd === "export") {
  const dir = join("data", `export-${new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19)}`);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "events.jsonl"), events.map((e) => JSON.stringify(e)).join("\n") + "\n");
  for (const [name, rows] of Object.entries(t)) writeFileSync(join(dir, `${name}.csv`), toCsv(rows));
  console.log(`wrote ${dir}: events.jsonl (${events.length}), ${Object.entries(t).map(([n, r]) => `${n}.csv (${r.length})`).join(", ")}`);
} else {
  const done = t.sessions.filter((s) => s.testScore !== null);
  console.log(`${events.length} events, ${t.sessions.length} sessions, ${done.length} finished the test`);
  console.log(`mean turns ${mean(t.sessions.map((s) => Number(s.turns)))}, mean test score ${mean(done.map((s) => Number(s.testScore)))}, Kai unhappy in ${mean(t.sessions.filter((s) => Number(s.turns) > 0).map((s) => Number(s.kaiUnhappyShare) * 100))}% of turns`);
  console.log(`mean minutes: watch ${mean(t.sessions.filter((s) => s.minWatch !== null).map((s) => Number(s.minWatch)))}, teach ${mean(t.sessions.filter((s) => s.minTeach !== null).map((s) => Number(s.minTeach)))}, practice ${mean(t.sessions.filter((s) => s.minPractice !== null).map((s) => Number(s.minPractice)))}, test ${mean(t.sessions.filter((s) => s.minTest !== null).map((s) => Number(s.minTest)))}`);
}
