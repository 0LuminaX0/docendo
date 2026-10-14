import type { NextRequest } from "next/server";
import { z } from "zod";
import { ConfigError, config } from "@/lib/server/env";
import { clientIp, fail, ok, readBody, sameOrigin } from "@/lib/server/http";
import { limit } from "@/lib/server/limit";
import { codeMatches, issueToken } from "@/lib/server/token";
import { deviceOf, record } from "@/lib/server/events";
import { readCode, type Condition } from "@/lib/codes";
import { conditionFor, findCode, useCode } from "@/lib/server/admindata";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const Body = z.object({
  accessCode: z.string().max(64).optional(),
  pid: z.string().regex(/^[A-Za-z0-9_-]{1,40}$/).optional(), // team sessions: an id from the link (?pid=…), to join with other data
});

/** Start a session: returns a signed token the other endpoints require. */
export async function POST(req: NextRequest) {
  if (!sameOrigin(req)) return fail(403, "Requests from other sites are not allowed.");
  const ip = clientIp(req);
  const r = await limit(`session:ip:${ip}`, config.ipSessionsPerHour, 3600);
  if (!r.ok) return fail(429, "Too many new sessions from your network. Try again later.", {}, { "Retry-After": String(r.retryAfter) });

  const body = Body.safeParse(await readBody(req, 2_000));
  if (!body.success) return fail(400, "Bad request.");
  // a code made in the admin panel, or a participant's own code, decides the condition; the shared code and open
  // access get the direct condition
  const given = body.data.accessCode ?? "";
  const stored = given ? await findCode(given).catch(() => null) : null;
  const participant = !stored && config.codeSecret && given ? readCode(config.codeSecret, given) : null;
  let who: { cond: Condition; entry: "participant" | "team" | "open"; pid: string | null };
  let code: { id: string; label: string; use: number } | null = null;
  if (stored) {
    if (!stored.active) return fail(401, "That access code is no longer active.");
    const use = await useCode(stored);
    if (stored.maxUses && use > stored.maxUses) return fail(401, "That access code has already been used.");
    code = { id: stored.id, label: stored.label, use };
    who = { cond: conditionFor(stored, use), entry: stored.team ? "team" : "participant", pid: stored.id };
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
    const { token, sid, expiresAt } = issueToken(who);
    record({
      t: "session_start",
      sid,
      pid: who.pid,
      condition: who.cond,
      entry: who.entry, // participant (own code), team (shared code) or open
      code, // a code made in the admin panel: its id, label and which use this is (never the code itself)
      demo: config.demo,
      device: deviceOf(req.headers.get("user-agent")),
      config: { practiceTries: config.practiceTries, practiceMinutes: config.practiceMinutes ?? null },
    });
    // the browser needs the condition to show the right practice (never displayed); team sessions may switch views
    return ok({ token, expiresAt, demo: config.demo, team: who.entry !== "participant", condition: who.cond });
  } catch (e) {
    if (e instanceof ConfigError) return fail(500, "The server isn't fully configured yet.");
    throw e;
  }
}
