import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import type { NextRequest } from "next/server";
import { config, sessionSecret } from "./env";

// The admin panel's login: one password (ADMIN_PASSWORD), checked in constant
// time, then a signed, httpOnly cookie for 12 hours. Admin pages call
// requireAdmin(); admin API routes call adminFromRequest(). Without
// ADMIN_PASSWORD the panel is off.

export const ADMIN_COOKIE = "docendo_admin";
const HOURS = 12;

const sign = (data: string) => createHmac("sha256", `admin:${sessionSecret()}`).update(data).digest("base64url");

export function adminToken(): { value: string; maxAge: number } {
  const data = Buffer.from(JSON.stringify({ exp: Date.now() + HOURS * 3600_000 })).toString("base64url");
  return { value: `${data}.${sign(data)}`, maxAge: HOURS * 3600 };
}

export function validAdmin(value: string | undefined): boolean {
  if (!config.adminPassword || !value || value.length > 300) return false;
  const [data, sig] = value.split(".");
  if (!data || !sig) return false;
  const a = Buffer.from(sign(data));
  const b = Buffer.from(sig);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return false;
  try {
    return (JSON.parse(Buffer.from(data, "base64url").toString("utf8")) as { exp: number }).exp > Date.now();
  } catch {
    return false;
  }
}

export function passwordMatches(given: string): boolean {
  if (!config.adminPassword) return false;
  const a = createHmac("sha256", "docendo-admin").update(given).digest();
  const b = createHmac("sha256", "docendo-admin").update(config.adminPassword).digest();
  return timingSafeEqual(a, b);
}

export const adminEnabled = () => !!config.adminPassword;

/** For admin pages (server components): the login page unless signed in. */
export async function requireAdmin() {
  if (!adminEnabled()) redirect("/admin/login");
  const jar = await cookies();
  if (!validAdmin(jar.get(ADMIN_COOKIE)?.value)) redirect("/admin/login");
}

/** For admin API routes. */
export const adminFromRequest = (req: NextRequest) => validAdmin(req.cookies.get(ADMIN_COOKIE)?.value);
