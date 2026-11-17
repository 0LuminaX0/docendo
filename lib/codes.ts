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

// ---------- codes made in the admin panel (lib/server/admindata.ts stores them) ----------

type PanelCode = { id: string; condition: "direct" | "recursive" | "random"; draw?: "direct" | "recursive"; maxUses?: number | null };

/** A code more than one person uses (no limit, or more than one use; not a team code): one code for everyone, each
 * person a participant number of their own (2026-11-17). */
export const isShared = (c: { team: boolean; maxUses: number | null }) => !c.team && c.maxUses !== 1;

/**
 * The condition for this use: fixed, or for "random" on a one-use code the condition drawn when the batch was made
 * (balanced blocks of 4 within the batch, like the HMAC codes), and on a code with more uses permuted blocks of 4
 * over its uses (`blockCondition`). `secret` is the server's (SESSION_SECRET); without it (older callers) a code
 * with more uses alternates from its draw.
 */
export function conditionFor(c: PanelCode, use: number, secret?: string): Condition {
  if (c.condition !== "random") return c.condition;
  const first = c.draw ?? (c.id.charCodeAt(c.id.length - 1) % 2 ? "recursive" : "direct");
  if (c.maxUses === 1) return first;
  if (secret) return blockCondition(secret, c.id, use);
  return use % 2 === 1 ? first : first === "direct" ? "recursive" : "direct";
}

// the six orders of two direct and two recursive
const ORDERS: Condition[][] = [
  ["direct", "direct", "recursive", "recursive"],
  ["direct", "recursive", "direct", "recursive"],
  ["direct", "recursive", "recursive", "direct"],
  ["recursive", "direct", "direct", "recursive"],
  ["recursive", "direct", "recursive", "direct"],
  ["recursive", "recursive", "direct", "direct"],
];

/**
 * Permuted-block randomisation for a shared code: its uses go in blocks of 4, each block one of the six orders of
 * two direct and two recursive, chosen by an HMAC of the code's id and the block's number under the server's secret.
 * So every 4 starts split 2 and 2 (at any moment the two conditions differ by at most 2), the next condition can't be
 * foreseen without the secret, and nothing needs storing beyond the code's use count (an atomic counter).
 */
export function blockCondition(secret: string, id: string, use: number): Condition {
  const k = Math.floor((use - 1) / 4);
  return ORDERS[mac(secret, `block:${id}:${k}`).readUInt32BE(0) % ORDERS.length]![(use - 1) % 4]!;
}

// ---------- participant numbers (sessions started with a shared code) ----------
// Eight digits, no leading zero: easy to note down, and unlike the access code (letters and digits). The server keeps
// the person's record under it (lib/server/participants.ts), the log uses it as the session's pid, and the person
// sees it at the end of the session: to find their data if they ask for it to be deleted, and to come back for a
// follow-up test (typed in the code field).

export const newNumber = () => String(randomInt(10_000_000, 100_000_000));

/** A typed participant number (spaces and dashes allowed), or null if it doesn't read as one. */
export function readNumber(raw: string): string | null {
  const d = raw.replace(/[\s-]/g, "");
  return /^[1-9]\d{7}$/.test(d) ? d : null;
}

/** As shown to the person: "4821 7730". */
export const formatNumber = (n: string) => `${n.slice(0, 4)} ${n.slice(4)}`;

/** Balanced, shuffled blocks of 4 (2 direct, 2 recursive), as long as needed. */
export function balancedDraws(n: number): ("direct" | "recursive")[] {
  const out: ("direct" | "recursive")[] = [];
  while (out.length < n) {
    const block: ("direct" | "recursive")[] = ["direct", "direct", "recursive", "recursive"];
    for (let i = block.length - 1; i > 0; i--) {
      const j = randomInt(i + 1);
      [block[i], block[j]] = [block[j]!, block[i]!];
    }
    out.push(...block);
  }
  return out.slice(0, n);
}

