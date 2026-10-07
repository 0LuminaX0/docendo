import "server-only";
import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import { config, sessionSecret } from "./env";

// A session token is `<payload>.<signature>`: base64url JSON signed with
// HMAC-SHA256. It proves the browser started a session here (and passed the
// access code, if one is set); it carries no secrets.

type Payload = { sid: string; exp: number };

const b64 = (s: string | Buffer) => Buffer.from(s).toString("base64url");
const sign = (data: string) => createHmac("sha256", sessionSecret()).update(data).digest("base64url");

export function issueToken(): { token: string; sid: string; expiresAt: number } {
  const payload: Payload = { sid: randomUUID(), exp: Date.now() + config.sessionHours * 3600_000 };
  const data = b64(JSON.stringify(payload));
  return { token: `${data}.${sign(data)}`, sid: payload.sid, expiresAt: payload.exp };
}

export function verifyToken(token: string | undefined): Payload | null {
  if (!token || token.length > 400) return null;
  const [data, sig] = token.split(".");
  if (!data || !sig) return null;
  const expected = Buffer.from(sign(data));
  const got = Buffer.from(sig);
  if (expected.length !== got.length || !timingSafeEqual(expected, got)) return null;
  try {
    const p = JSON.parse(Buffer.from(data, "base64url").toString("utf8")) as Payload;
    if (typeof p.sid !== "string" || typeof p.exp !== "number" || p.exp < Date.now()) return null;
    return p;
  } catch {
    return null;
  }
}

/** Constant-time comparison for the optional access code. */
export function codeMatches(given: string | undefined, expected: string): boolean {
  const a = createHmac("sha256", "docendo-code").update(given ?? "").digest();
  const b = createHmac("sha256", "docendo-code").update(expected).digest();
  return timingSafeEqual(a, b);
}
