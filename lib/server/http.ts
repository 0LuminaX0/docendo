import "server-only";
import { NextResponse, type NextRequest } from "next/server";

export function fail(status: number, message: string, extra: Record<string, unknown> = {}, headers: Record<string, string> = {}) {
  return NextResponse.json({ error: message, ...extra }, { status, headers: { "Cache-Control": "no-store", ...headers } });
}

export function ok(body: unknown) {
  return NextResponse.json(body, { headers: { "Cache-Control": "no-store" } });
}

export function clientIp(req: NextRequest): string {
  const fwd = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  return fwd || req.headers.get("x-real-ip") || "unknown";
}

/**
 * Browsers always send Origin on cross-site POSTs. Refuse other sites' pages
 * calling our API with a visitor's browser. (Scripts can fake headers; the
 * token and rate limits cover those.)
 */
export function sameOrigin(req: NextRequest): boolean {
  const origin = req.headers.get("origin");
  if (!origin) return true;
  try {
    return new URL(origin).host === (req.headers.get("x-forwarded-host") ?? req.headers.get("host"));
  } catch {
    return false;
  }
}

/** Read a JSON body with a hard size cap (bytes). */
export async function readBody(req: NextRequest, maxBytes: number): Promise<unknown | undefined> {
  const len = Number(req.headers.get("content-length") ?? "0");
  if (len > maxBytes) return undefined;
  const text = await req.text();
  if (text.length > maxBytes) return undefined;
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}
