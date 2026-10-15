import "server-only";
import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import { sessionSecret } from "./env";
import { CONDITIONS, type Condition } from "../codes";
import { DEFAULT_TOPIC } from "./topics";

// A session token is `<payload>.<signature>`: base64url JSON signed with
// HMAC-SHA256. It proves the browser started a session here (and passed the
// access code, if one is set) and fixes the study condition for the session;
// it carries no secrets.

/** participant: own code; trial: a code for a dry run (a participant's experience, counted with the tests); team: the
 * shared ACCESS_CODE or a team code (test shortcuts); open: no code needed (local development). */
export type Entry = "participant" | "trial" | "team" | "open";
// form: the test form this session takes (A or B); phase: the main session, or the delayed test on its own;
// topic: the topic pack the session started with (it keeps it if the study switches topics meanwhile)
type Payload = { sid: string; exp: number; cond: Condition; entry: Entry; pid: string | null; form: "A" | "B"; phase: "main" | "delayed"; topic: string };
export type Who = Omit<Payload, "sid" | "exp">;

const b64 = (s: string | Buffer) => Buffer.from(s).toString("base64url");
const sign = (data: string) => createHmac("sha256", sessionSecret()).update(data).digest("base64url");

export function issueToken(who: Who, days: number): { token: string; sid: string; expiresAt: number } {
  const payload: Payload = { sid: randomUUID(), exp: Date.now() + days * 86_400_000, ...who };
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
    // tokens issued before conditions existed are team sessions in the direct condition
    // older tokens: form A, main session, the default topic
    return { sid: p.sid, exp: p.exp, cond: CONDITIONS.includes(p.cond) ? p.cond : "direct", entry: p.entry ?? "team", pid: p.pid ?? null, form: p.form === "B" ? "B" : "A", phase: p.phase === "delayed" ? "delayed" : "main", topic: typeof p.topic === "string" ? p.topic : DEFAULT_TOPIC };
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
