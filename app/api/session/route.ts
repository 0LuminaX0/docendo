import type { NextRequest } from "next/server";
import { z } from "zod";
import { ConfigError, config } from "@/lib/server/env";
import { clientIp, fail, ok, readBody, sameOrigin } from "@/lib/server/http";
import { limit } from "@/lib/server/limit";
import { codeMatches, issueToken } from "@/lib/server/token";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const Body = z.object({ accessCode: z.string().max(64).optional() });

/** Start a session: returns a signed token the other endpoints require. */
export async function POST(req: NextRequest) {
  if (!sameOrigin(req)) return fail(403, "Requests from other sites are not allowed.");
  const ip = clientIp(req);
  const r = await limit(`session:ip:${ip}`, config.ipSessionsPerHour, 3600);
  if (!r.ok) return fail(429, "Too many new sessions from your network. Try again later.", {}, { "Retry-After": String(r.retryAfter) });

  const body = Body.safeParse(await readBody(req, 2_000));
  if (!body.success) return fail(400, "Bad request.");
  if (config.accessCode && !codeMatches(body.data.accessCode, config.accessCode)) {
    await limit(`session:badcode:${ip}`, 1, 2); // slow down guessing
    return fail(401, "That access code isn't right.");
  }
  try {
    const { token, expiresAt } = issueToken();
    return ok({ token, expiresAt, demo: config.demo });
  } catch (e) {
    if (e instanceof ConfigError) return fail(500, "The server isn't fully configured yet.");
    throw e;
  }
}
