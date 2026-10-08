import type { NextRequest } from "next/server";
import { z } from "zod";
import { fail, ok, readBody, sameOrigin } from "@/lib/server/http";
import { limitAll } from "@/lib/server/limit";
import { verifyToken } from "@/lib/server/token";
import { record } from "@/lib/server/events";
import { Belief, Entry } from "@/engine/tutor/state";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Client-side research events (page views, video playback, typing, clicks), sent
// in small batches by lib/client/log.ts. Free-form `data`, but small and flat.
const Value = z.union([z.string().max(2000), z.number(), z.boolean(), z.null(), z.array(z.union([z.string().max(200), z.number()])).max(50)]);
const Body = z.object({
  token: z.string().max(400),
  events: z
    .array(
      z.object({
        type: z.string().regex(/^[a-z][a-z0-9_]{1,39}$/),
        at: z.number().int().positive(), // client clock, ms
        path: z.string().max(40),
        seq: z.number().int().min(0),
        data: z.record(z.string().max(40), Value).optional(),
      }),
    )
    .max(60),
  // Kai's notebook when the learner leaves the teaching chapter (lib/client/log.ts logNotebook)
  notebook: z
    .object({ reason: z.string().regex(/^[a-z_]{1,30}$/), turn: z.number().int().min(0).max(1000), notebook: z.array(Entry).max(300), misconceptions: z.array(Belief).max(100) })
    .optional(),
});

export async function POST(req: NextRequest) {
  if (!sameOrigin(req)) return fail(403, "Requests from other sites are not allowed.");
  const body = Body.safeParse(await readBody(req, 300_000));
  if (!body.success || (!body.data.events.length && !body.data.notebook)) return fail(400, "Bad request.");
  const session = verifyToken(body.data.token);
  if (!session) return fail(401, "Your session has expired.", { expired: true });
  const r = await limitAll([
    // per instance: logging costs no model calls, and every request still needs a signed session
    [`log:sidmin:${session.sid}`, 60, 60, "local"],
    [`log:sid:${session.sid}`, 1500, 6 * 3600, "local"],
  ]);
  if (!r.ok) return fail(429, "Too many events.");
  // the event's own fields come last, so client data can never overwrite them
  if (body.data.events.length) record(body.data.events.map((e) => ({ ...(e.data ?? {}), t: `client_${e.type}`, sid: session.sid, clientAt: e.at, path: e.path, seq: e.seq })));
  if (body.data.notebook) record({ t: "notebook_snapshot", sid: session.sid, source: "client", ...body.data.notebook });
  return ok({ ok: true });
}
