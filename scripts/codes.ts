// Participant codes for the study.
//   pnpm codes 40                       40 codes in balanced blocks of 4 → data/codes-<time>.csv
//   pnpm codes 40 --base https://docendo-jade.vercel.app   also writes a ready link per code
//   pnpm codes check K7Q2M-9XA          which condition a code gives (for the team, never for participants)
// Needs CODE_SECRET (.env or .env.local), the same value as on Vercel. The CSV says which condition
// each code gives: keep it within the team (data/ is not committed).

import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { generateCodes, readCode } from "../lib/codes";

for (const f of [".env", ".env.local"]) {
  try {
    process.loadEnvFile?.(f);
  } catch {
    // file missing: use the environment as is
  }
}

const secret = process.env.CODE_SECRET?.trim();
if (!secret || secret.length < 16) {
  console.error("Set CODE_SECRET (at least 16 characters) in .env, the same value as on Vercel. For example: openssl rand -hex 24");
  process.exit(1);
}

const args = process.argv.slice(2);
if (args[0] === "check") {
  const r = readCode(secret, args[1] ?? "");
  console.log(r ? `${r.id}: ${r.condition}` : "not a valid code for this CODE_SECRET");
  process.exit(r ? 0 : 1);
}

const n = Number(args[0] ?? 40);
if (!Number.isInteger(n) || n < 1 || n > 2000) {
  console.error("usage: pnpm codes <how many> [--base <site url>] [--block 4]");
  process.exit(1);
}
const opt = (name: string) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};
const base = opt("--base")?.replace(/\/+$/, "");
const codes = generateCodes(secret, n, Number(opt("--block") ?? 4));

const rows = [["block", "code", "participant_id", "condition", ...(base ? ["link"] : [])].join(",")];
for (const c of codes) rows.push([c.block, c.code, c.id, c.condition, ...(base ? [`${base}/?code=${c.code}`] : [])].join(","));
mkdirSync("data", { recursive: true });
const file = join("data", `codes-${new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19)}.csv`);
writeFileSync(file, rows.join("\n") + "\n");
const count = (c: string) => codes.filter((x) => x.condition === c).length;
console.log(`${codes.length} codes in ${codes.at(-1)!.block} blocks (direct ${count("direct")}, recursive ${count("recursive")}) → ${file}`);
