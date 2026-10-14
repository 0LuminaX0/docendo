import { NextResponse, type NextRequest } from "next/server";
import { ADMIN_COOKIE } from "@/lib/server/admin";
import { fail, sameOrigin } from "@/lib/server/http";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  if (!sameOrigin(req)) return fail(403, "Requests from other sites are not allowed.");
  const res = NextResponse.json({ ok: true });
  res.cookies.set(ADMIN_COOKIE, "", { httpOnly: true, sameSite: "strict", secure: process.env.NODE_ENV === "production", path: "/", maxAge: 0 });
  return res;
}
