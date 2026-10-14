import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { ADMIN_COOKIE, adminEnabled, adminToken, passwordMatches } from "@/lib/server/admin";
import { clientIp, fail, readBody, sameOrigin } from "@/lib/server/http";
import { limitAll } from "@/lib/server/limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const Body = z.object({ password: z.string().min(1).max(200) });

/** Admin login: the password, then a signed httpOnly cookie. Slow to guess: 5 tries per 15 minutes per network. */
export async function POST(req: NextRequest) {
  if (!sameOrigin(req)) return fail(403, "Requests from other sites are not allowed.");
  if (!adminEnabled()) return fail(404, "Not found.");
  const r = await limitAll([[`admin:login:${clientIp(req)}`, 5, 900]]);
  if (!r.ok) return fail(429, "Too many tries. Wait a few minutes.", { retryAfter: r.retryAfter });
  const body = Body.safeParse(await readBody(req, 1_000));
  if (!body.success || !passwordMatches(body.data.password)) return fail(401, "That password isn't right.");
  const t = adminToken();
  const res = NextResponse.json({ ok: true }, { headers: { "Cache-Control": "no-store" } });
  res.cookies.set(ADMIN_COOKIE, t.value, { httpOnly: true, sameSite: "strict", secure: process.env.NODE_ENV === "production", path: "/", maxAge: t.maxAge });
  return res;
}
