import { describe, expect, it } from "vitest";
import { conditionOf, generateCodes, normalizeCode, readCode } from "../lib/codes";

const SECRET = "test-secret-0123456789";

describe("participant codes", () => {
  const codes = generateCodes(SECRET, 40);

  it("come in blocks of 4 with two codes per condition", () => {
    expect(codes).toHaveLength(40);
    for (let b = 1; b <= 10; b++) {
      const block = codes.filter((c) => c.block === b);
      expect(block.filter((c) => c.condition === "direct")).toHaveLength(2);
      expect(block.filter((c) => c.condition === "recursive")).toHaveLength(2);
    }
    expect(new Set(codes.map((c) => c.id)).size).toBe(40);
  });

  it("carry their condition: the server reads it back from the code alone", () => {
    for (const c of codes) expect(readCode(SECRET, c.code)).toEqual({ id: c.id, condition: c.condition });
  });

  it("are forgiving about how they're typed", () => {
    const c = codes[0]!;
    expect(readCode(SECRET, c.code.toLowerCase())?.id).toBe(c.id);
    expect(readCode(SECRET, ` ${c.code.replace("-", " ")} `)?.id).toBe(c.id);
    expect(normalizeCode("o1-il")).toBe("0111");
  });

  it("reject made-up codes, and codes made with another secret", () => {
    const c = codes[0]!;
    const wrongCheck = c.code.slice(0, -1) + (c.code.endsWith("0") ? "1" : "0");
    expect(readCode(SECRET, wrongCheck)).toBeNull();
    expect(readCode("another-secret-0123456789", c.code)).toBeNull();
    expect(readCode(SECRET, "bandits2026")).toBeNull();
    expect(readCode(SECRET, "")).toBeNull();
  });

  it("split ids about evenly between the conditions", () => {
    let recursive = 0;
    for (let i = 0; i < 2000; i++) if (conditionOf(SECRET, `ID${i}`) === "recursive") recursive++;
    expect(recursive).toBeGreaterThan(900);
    expect(recursive).toBeLessThan(1100);
  });
});

import { balancedDraws, conditionFor } from "../lib/codes";

describe("codes made in the admin panel", () => {
  it("draw random conditions in balanced blocks of 4", () => {
    const d = balancedDraws(40);
    for (let b = 0; b < 40; b += 4) expect(d.slice(b, b + 4).filter((x) => x === "direct")).toHaveLength(2);
  });
  it("use the drawn condition first, then alternate; fixed codes never change", () => {
    const r = { id: "cABC", condition: "random" as const, draw: "recursive" as const };
    expect([1, 2, 3, 4].map((u) => conditionFor(r, u))).toEqual(["recursive", "direct", "recursive", "direct"]);
    expect([1, 2, 3].map((u) => conditionFor({ id: "x", condition: "direct" }, u))).toEqual(["direct", "direct", "direct"]);
  });
});

import { blockCondition, formatNumber, isShared, newNumber, readNumber } from "../lib/codes";

describe("a participant code for everyone (2026-11-17)", () => {
  it("is any participant or trial code with more than one use", () => {
    expect(isShared({ team: false, maxUses: null })).toBe(true);
    expect(isShared({ team: false, maxUses: 200 })).toBe(true);
    expect(isShared({ team: false, maxUses: 1 })).toBe(false);
    expect(isShared({ team: true, maxUses: null })).toBe(false);
  });

  it("assigns its uses in permuted blocks of 4: two per condition in every block", () => {
    const seq = Array.from({ length: 400 }, (_, i) => blockCondition(SECRET, "cK7QMX2RP", i + 1));
    for (let b = 0; b < 400; b += 4) expect(seq.slice(b, b + 4).filter((x) => x === "direct")).toHaveLength(2);
    // at any moment the conditions differ by at most 2
    let d = 0;
    for (const c of seq) {
      d += c === "direct" ? 1 : -1;
      expect(Math.abs(d)).toBeLessThanOrEqual(2);
    }
    // the blocks vary: every one of the six orders turns up, and each about equally often
    const orders = new Map<string, number>();
    for (let b = 0; b < 400; b += 4) orders.set(seq.slice(b, b + 4).join(), (orders.get(seq.slice(b, b + 4).join()) ?? 0) + 1);
    expect(orders.size).toBe(6);
    for (const n of orders.values()) expect(n).toBeGreaterThan(5);
  });

  it("is the same for the same use (no state needed) and can't be foreseen without the secret", () => {
    const a = Array.from({ length: 40 }, (_, i) => blockCondition(SECRET, "cK7QMX2RP", i + 1));
    expect(Array.from({ length: 40 }, (_, i) => blockCondition(SECRET, "cK7QMX2RP", i + 1))).toEqual(a);
    expect(Array.from({ length: 40 }, (_, i) => blockCondition("another-secret-0123456789", "cK7QMX2RP", i + 1))).not.toEqual(a);
  });

  it("conditionFor: blocks for a code with more uses, the batch's draw for a one-use code, fixed codes fixed", () => {
    const shared = { id: "cK7QMX2RP", condition: "random" as const, draw: "direct" as const, maxUses: null };
    expect([1, 2, 3, 4, 5, 6, 7, 8].map((u) => conditionFor(shared, u, SECRET))).toEqual([1, 2, 3, 4, 5, 6, 7, 8].map((u) => blockCondition(SECRET, shared.id, u)));
    expect(conditionFor({ ...shared, maxUses: 1, draw: "recursive" }, 1, SECRET)).toBe("recursive");
    expect(conditionFor({ ...shared, condition: "direct" }, 3, SECRET)).toBe("direct");
  });

  it("gives participant numbers of eight digits, read back however they are typed", () => {
    for (let i = 0; i < 200; i++) expect(newNumber()).toMatch(/^[1-9]\d{7}$/);
    const n = newNumber();
    expect(formatNumber("48217730")).toBe("4821 7730");
    expect(readNumber(formatNumber(n))).toBe(n);
    expect(readNumber(" 4821-7730 ")).toBe("48217730");
    expect(readNumber("0821 7730")).toBeNull();
    expect(readNumber("4821 773")).toBeNull();
    expect(readNumber("K7QM-X2RP")).toBeNull();
  });
});

import { tables } from "../lib/analytics";

describe("second starts from one browser (the participant number cookie)", () => {
  const at = (m: number) => new Date(Date.UTC(2026, 10, 17, 10, m)).toISOString();
  const start = (sid: string, pid: string, prior: string | null, m: number, phase = "main") => ({ t: "session_start", sid, at: at(m), pid, phase, entry: "participant", priorNumber: prior, priorFrom: prior ? "cookie" : null });
  const { sessions } = tables([
    start("a", "11111111", null, 0),
    start("b", "22222222", "11111111", 5),
    start("c", "33333333", "22222222", 9),
    start("d", "44444444", null, 1),
    start("e", "55555555", "99999999", 2), // its earlier start isn't in the log
    start("f", "11111111", null, 40, "delayed"), // a's follow-up test: not a start of the study
  ]);
  const by = (sid: string) => sessions.find((s) => s.sid === sid)!;

  it("chains each browser's starts to its first number, every start in the chain flagged", () => {
    expect([by("a"), by("b"), by("c")].map((s) => [s.firstNumber, s.startNo, s.browserStarts])).toEqual([
      ["11111111", 1, 3],
      ["11111111", 2, 3],
      ["11111111", 3, 3],
    ]);
    expect([by("d").startNo, by("d").browserStarts]).toEqual([1, 1]);
    expect([by("e").firstNumber, by("e").startNo, by("e").browserStarts]).toEqual(["99999999", 2, 2]);
    expect(by("f").startNo).toBeNull();
    expect(by("b").priorFrom).toBe("cookie");
  });
});
