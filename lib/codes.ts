import { createHmac, randomInt } from "node:crypto";

// Participant codes. Each participant gets their own access code, and the code
// itself decides the study condition: an HMAC of the code's id under a secret
// (CODE_SECRET) gives a check part, so made-up codes fail, and one condition
// bit. The server needs no table and no shared counter, and reading the
// repository reveals nothing. Codes are generated in balanced blocks
// (scripts/codes.ts), so conditions stay even however many people take part.
// Pure: used by the server (lib/server/participants.ts) and by the script.

export const CONDITIONS = ["direct", "recursive"] as const;
export type Condition = (typeof CONDITIONS)[number];

const ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ"; // Crockford base32: no I, L, O, U
const ID_LEN = 5;
const CHECK_LEN = 3;

const mac = (secret: string, what: string) => createHmac("sha256", secret).update(`docendo:${what}`).digest();

function base32(bytes: Buffer, len: number): string {
  let bits = 0;
  let value = 0;
  let out = "";
  for (const b of bytes) {
    value = (value << 8) | b;
    bits += 8;
    while (bits >= 5 && out.length < len) {
      out += ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
    if (out.length >= len) break;
  }
  return out;
}

export const conditionOf = (secret: string, id: string): Condition => CONDITIONS[mac(secret, `cond:${id}`)[0]! & 1]!;
const checkOf = (secret: string, id: string) => base32(mac(secret, `check:${id}`), CHECK_LEN);

/** Typed codes are forgiving: any case, spaces or dashes, O for 0 and I or L for 1. */
export function normalizeCode(raw: string): string {
  return raw.toUpperCase().replace(/[^0-9A-Z]/g, "").replace(/O/g, "0").replace(/[IL]/g, "1");
}

/** The participant id and condition behind a code, or null if it isn't one of ours. */
export function readCode(secret: string, raw: string): { id: string; condition: Condition } | null {
  const c = normalizeCode(raw);
  if (c.length !== ID_LEN + CHECK_LEN) return null;
  const id = c.slice(0, ID_LEN);
  if (!/^[0-9A-HJKMNP-TV-Z]+$/.test(c) || c.slice(ID_LEN) !== checkOf(secret, id)) return null;
  return { id, condition: conditionOf(secret, id) };
}

export const formatCode = (secret: string, id: string) => `${id}-${checkOf(secret, id)}`;

/**
 * `n` codes in blocks of `block` (default 4): each block holds the same number
 * of codes per condition, in random order. Hand them out in order; a code that
 * goes unused is replaced by the next unused one of the same condition.
 */
export function generateCodes(secret: string, n: number, block = 4, taken: Set<string> = new Set()) {
  if (block % CONDITIONS.length) throw new Error(`block size must be a multiple of ${CONDITIONS.length}`);
  const out: { block: number; code: string; id: string; condition: Condition }[] = [];
  for (let b = 0; out.length < n; b++) {
    const want = CONDITIONS.flatMap((c) => Array<Condition>(block / CONDITIONS.length).fill(c));
    for (let i = want.length - 1; i > 0; i--) {
      const j = randomInt(i + 1);
      [want[i], want[j]] = [want[j]!, want[i]!];
    }
    for (const condition of want) {
      if (out.length >= n) break;
      let id: string;
      do id = Array.from({ length: ID_LEN }, () => ALPHABET[randomInt(32)]).join("");
      while (taken.has(id) || conditionOf(secret, id) !== condition);
      taken.add(id);
      out.push({ block: b + 1, code: formatCode(secret, id), id, condition });
    }
  }
  return out;
}
