import type { NextRequest } from "next/server";
import { z } from "zod";
import { ConfigError, config } from "@/lib/server/env";
import { clientIp, fail, ok, readBody, sameOrigin } from "@/lib/server/http";
import { limit } from "@/lib/server/limit";
import { codeMatches, issueToken, verifyToken, type Entry } from "@/lib/server/token";
import { deviceOf, record } from "@/lib/server/events";
import { readCode, type Condition } from "@/lib/codes";
import { conditionFor, findCode, useCode } from "@/lib/server/admindata";
import { DEFAULT_TOPIC, otherForm, packFor } from "@/lib/server/content";
import { followUpOpens, getParticipant, nextForm, putParticipant, type Participant } from "@/lib/server/participants";
import { getSettings } from "@/lib/server/settings";
import type { Settings } from "@/lib/settings";
import { flowOf } from "@/lib/flow";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const Body = z.object({
  consent: z.boolean().optional(), // the study consent on the welcome page: required
  accessCode: z.string().max(64).optional(),
  pid: z.string().regex(/^[A-Za-z0-9_-]{1,40}$/).optional(), // team sessions: an id from the link (?pid=…), to join with other data
  followUp: z.string().max(400).optional(), // a finished session's token on the same device: start its delayed test
});
// the wording the learner agreed to is in components/Intro.tsx (CONSENT); change this date when it changes
const CONSENT_VERSION = "2026-10-15";

const day = (ms: number) => new Date(ms).toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long", timeZone: "Europe/Zurich" });

/**
 * A participant who already took the final test comes back (their code again, or the same device): the delayed
 * test, with the other form, once it is open. null: no delayed test applies, so the code works as before.
 */
async function delayedTest(p: Participant, req: NextRequest, st: { settings: Settings; version: string }): Promise<Response | null> {
  const pack = packFor(p.topic ?? DEFAULT_TOPIC);
  if (!st.settings.test.followUp || !p.testAt || pack.forms.length < 2) return null;
  if (p.delayedAt) return fail(409, "You've done both tests. Thank you for taking part!");
  // the schedule (days after the final test), or earlier if the admin panel opened it
  const opens = followUpOpens(p, st.settings.test.followUpDays)!;
  if (Date.now() < opens) return fail(409, `Your follow-up test opens on ${day(opens)}. Come back then with the same code.`, { opensAt: opens });
  const who = { cond: p.cond, entry: p.trial ? ("trial" as const) : ("participant" as const), pid: p.pid, form: otherForm(p.form), phase: "delayed" as const, topic: pack.slug };
  const { token, sid, expiresAt } = issueToken(who, st.settings.sessionDays);
  record({ t: "session_start", sid, pid: p.pid, condition: p.cond, entry: who.entry, phase: "delayed", form: who.form, topic: pack.slug, consent: CONSENT_VERSION, settings: st.version, daysSinceTest: Math.round((Date.now() - Date.parse(p.testAt)) / 864e5 * 10) / 10, openedEarly: !!p.opensAt, demo: config.demo, device: deviceOf(req.headers.get("user-agent")) });
  return ok({ token, expiresAt, demo: config.demo, team: false, condition: p.cond, phase: "delayed" });
}

/** Start a session: returns a signed token the other endpoints require. */
export async function POST(req: NextRequest) {
  if (!sameOrigin(req)) return fail(403, "Requests from other sites are not allowed.");
  const ip = clientIp(req);
  const r = await limit(`session:ip:${ip}`, config.ipSessionsPerHour, 3600);
  if (!r.ok) return fail(429, "Too many new sessions from your network. Try again later.", {}, { "Retry-After": String(r.retryAfter) });

  const body = Body.safeParse(await readBody(req, 2_000));
  if (!body.success) return fail(400, "Bad request.");
  if (body.data.consent !== true) return fail(400, "Tick the box to agree to the study first.");
  const st = await getSettings();

  // the same device, days later: the finished session's token starts the delayed test
  if (body.data.followUp) {
    const prev = verifyToken(body.data.followUp);
    if (!prev) return fail(401, "This session has expired. Enter your access code instead.");
    if ((prev.entry !== "participant" && prev.entry !== "trial") || !prev.pid || prev.phase !== "main") return fail(400, "There is no follow-up test for this session.");
    const p = await getParticipant(prev.pid);
    return (p && (await delayedTest(p, req, st))) ?? fail(409, "There is no follow-up test for this session.");
  }
  // a code made in the admin panel, or a participant's own code, decides the condition; the shared code and open
  // access get the direct condition
  const given = body.data.accessCode ?? "";
  const stored = given ? await findCode(given).catch(() => null) : null;
  const participant = !stored && config.codeSecret && given ? readCode(config.codeSecret, given) : null;
  let who: { cond: Condition; entry: Entry; pid: string | null };
  if (stored && !stored.active) return fail(401, "That access code is no longer active.");
  let code: { id: string; label: string; use: number } | null = null;
  // a code that names one person (a one-use code, or a participant code) keeps a record, for the delayed test
  const person = stored ? (stored.maxUses === 1 && !stored.team ? stored.id : null) : (participant?.id ?? null);
  const known = person ? await getParticipant(person).catch(() => null) : null;
  if (known) {
    const d = await delayedTest(known, req, st);
    if (d) return d; // checked before counting a use: coming back for the delayed test doesn't use the code up
  }
  if (stored) {
    const use = await useCode(stored);
    if (stored.maxUses && use > stored.maxUses) return fail(401, "That access code has already been used.");
    code = { id: stored.id, label: stored.label, use };
    who = { cond: conditionFor(stored, use), entry: stored.team ? "team" : stored.trial ? "trial" : "participant", pid: stored.id };
  } else if (participant) who = { cond: participant.condition, entry: "participant", pid: participant.id };
  else if (config.accessCode && codeMatches(given, config.accessCode)) who = { cond: "direct", entry: "team", pid: body.data.pid ?? null };
  else if (!config.accessCode && !config.codeSecret && !config.adminPassword) who = { cond: "direct", entry: "open", pid: body.data.pid ?? null };
  else {
    // wrong codes: 10 per 15 minutes per network, then a pause (a lab room's typos fit; guessing doesn't)
    const tries = await limit(`session:badcode:${ip}`, 10, 900);
    if (!tries.ok) return fail(429, "Too many wrong codes. Wait a few minutes and try again.", { retryAfter: tries.retryAfter }, { "Retry-After": String(tries.retryAfter) });
    return fail(401, "That access code isn't right.");
  }
  try {
    // the topic: a person who started before keeps theirs, else the study's current one
    const pack = packFor(known?.topic ?? st.settings.topic);
    // the final test's form: kept from an earlier start of the same person, else balanced within the condition
    // (a pack with one form: always that one)
    const form = pack.forms.length < 2 ? pack.forms[0]! : (known?.form ?? (await nextForm(who.entry === "participant" ? who.cond : who.entry === "trial" ? `trial-${who.cond}` : "team")));
    if (person && !known) await putParticipant({ pid: person, cond: who.cond, form, topic: pack.slug, ...(who.entry === "trial" ? { trial: true } : {}), startedAt: new Date().toISOString() });
    const { token, sid, expiresAt } = issueToken({ ...who, form, phase: "main", topic: pack.slug }, st.settings.sessionDays);
    record({
      t: "session_start",
      sid,
      pid: who.pid,
      condition: who.cond,
      phase: "main",
      form, // the final test's form (A or B); the delayed test takes the other
      topic: pack.slug, // the topic pack (Settings); the session keeps it
      consent: CONSENT_VERSION,
      settings: st.version, // the study settings this session started under (admin panel, Settings)
      entry: who.entry, // participant (own code), trial (a dry run's code), team (shared or team code) or open
      code, // a code made in the admin panel: its id, label and which use this is (never the code itself)
      demo: config.demo,
      device: deviceOf(req.headers.get("user-agent")),
      config: { practiceTries: st.settings.practice.tries, practiceMinutes: st.settings.practice.minutes, flow: flowOf(st.settings) },
    });
    // the browser needs the condition to show the right practice (never displayed); team sessions may switch views
    // trial codes get a participant's experience: no shortcuts, no condition switch
    return ok({ token, expiresAt, demo: config.demo, team: who.entry === "team" || who.entry === "open", condition: who.cond });
  } catch (e) {
    if (e instanceof ConfigError) return fail(500, "The server isn't fully configured yet.");
    throw e;
  }
}
