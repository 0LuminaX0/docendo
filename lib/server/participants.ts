import "server-only";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { Redis } from "@upstash/redis";
import { config } from "./env";
import type { Condition } from "../codes";
import type { Form } from "./content";
import { hashOf } from "./admindata";

// What the server keeps per participant, for the delayed test: the condition, which test form they took first, and
// when each test was taken. Only for codes that name one person (a one-use code from the admin panel, or a participant
// code): a shared code names nobody. Upstash when configured (the study), else .data/participants.json. No names,
// no codes: the key is the code's id, as in the research log.

export type Participant = {
  pid: string;
  cond: Condition;
  form: Form; // the final test's form; the delayed test takes the other one
  trial?: boolean; // a dry run's code: the delayed test works the same, counted with the tests
  topic?: string; // the topic pack of the first session (older records: the default topic); the delayed test keeps it
  startedAt: string;
  testAt?: string; // the final test was graded (the delayed test opens some days later)
  opensAt?: string; // set in the admin panel: the follow-up is open from this moment (earlier than the schedule)
  delayedAt?: string; // the delayed test was graded
};

const redis = config.upstash ? new Redis({ ...config.upstash, automaticDeserialization: false }) : null;
const KEY = "docendo:participants:v1";
const FORMS = "docendo:forms:v1";
const FILE = join(process.cwd(), ".data", "participants.json");

type FileData = { participants: Record<string, Participant>; forms: Record<string, number> };
async function readData(): Promise<FileData> {
  try {
    return JSON.parse(await readFile(FILE, "utf8")) as FileData;
  } catch {
    return { participants: {}, forms: {} };
  }
}
async function writeData(d: FileData) {
  await mkdir(join(process.cwd(), ".data"), { recursive: true });
  await writeFile(FILE, JSON.stringify(d, null, 2));
}

export async function getParticipant(pid: string): Promise<Participant | null> {
  if (redis) {
    const v = (await redis.hget(KEY, pid)) as string | null;
    return v ? (typeof v === "string" ? (JSON.parse(v) as Participant) : (v as Participant)) : null;
  }
  return (await readData()).participants[pid] ?? null;
}

/** Everyone the server keeps a record for, newest first. */
export async function listParticipants(): Promise<Participant[]> {
  let all: Participant[];
  if (redis) all = Object.values(hashOf(await redis.hgetall(KEY))).flatMap((v) => {
    try {
      return [JSON.parse(v) as Participant];
    } catch {
      return [];
    }
  });
  else all = Object.values((await readData()).participants);
  return all.sort((a, b) => b.startedAt.localeCompare(a.startedAt));
}

/** When a person's follow-up opens: the admin panel's early opening, else the schedule (null: no final test yet). */
export function followUpOpens(p: Participant, days: number): number | null {
  if (!p.testAt) return null;
  const scheduled = Date.parse(p.testAt) + days * 86_400_000;
  return p.opensAt ? Math.min(scheduled, Date.parse(p.opensAt)) : scheduled;
}

/** Open the follow-up now for these people, or (open: false) put them back on the schedule. */
export async function setFollowUpOpen(pids: string[], open: boolean): Promise<number> {
  let n = 0;
  for (const pid of pids) {
    const p = await getParticipant(pid);
    if (!p || !p.testAt || p.delayedAt) continue;
    const { opensAt: _o, ...rest } = p;
    await putParticipant(open ? { ...rest, opensAt: new Date().toISOString() } : rest);
    n++;
  }
  return n;
}

export async function putParticipant(p: Participant) {
  if (redis) await redis.hset(KEY, { [p.pid]: JSON.stringify(p) });
  else {
    const d = await readData();
    d.participants[p.pid] = p;
    await writeData(d);
  }
}

/** Mark a test as taken (the first time only). */
export async function markTest(pid: string, phase: "main" | "delayed") {
  const p = await getParticipant(pid);
  if (!p) return;
  const field = phase === "main" ? "testAt" : "delayedAt";
  if (p[field]) return;
  await putParticipant({ ...p, [field]: new Date().toISOString() });
}

/**
 * The final test's form for a new session: A and B alternate within each group (a condition, or "team"), so each
 * condition gets both orders equally often and a form that turns out harder can't favour one condition.
 */
export async function nextForm(group: string): Promise<Form> {
  let n: number;
  if (redis) n = Number(await redis.hincrby(FORMS, group, 1));
  else {
    const d = await readData();
    n = d.forms[group] = (d.forms[group] ?? 0) + 1;
    await writeData(d);
  }
  return n % 2 === 1 ? "A" : "B";
}
