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
