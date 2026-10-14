import { describe, expect, it } from "vitest";
import { calculate } from "../lib/calc";

const v = (s: string) => {
  const r = calculate(s);
  if (!r.ok) throw new Error(`${s}: ${r.error}`);
  return r.text;
};

describe("the learners' calculator", () => {
  it("does the arithmetic the problems need", () => {
    expect(v("0.8 * 1000 + 200 / 3")).toBe("866.666667");
    expect(v("0.9 + 0.1/5")).toBe("0.92");
    expect(v("4.8 + 1.9")).toBe("6.7");
    expect(v("(7 + 5) / 2")).toBe("6");
    expect(v("0.1 + 0.2")).toBe("0.3");
  });
  it("reads the way people type", () => {
    expect(v("20% of 1000")).toBe("200");
    expect(v("1,000 × 0,8")).toBe("800");
    expect(v("200 ÷ 3")).toBe("66.666667");
    expect(v("2(3 + 4)")).toBe("14");
    expect(v("-3^2")).toBe("-9");
    expect(v("2^3^2")).toBe("512");
  });
  it("has the functions UCB's bonus needs", () => {
    expect(v("√(2 ln 1000 / 200)")).toBe("0.262826");
    expect(v("sqrt 16")).toBe("4");
    expect(v("log(1000)")).toBe("3");
  });
  it("explains what it can't do", () => {
    expect(calculate("1/0")).toMatchObject({ ok: false, error: "Can't divide by zero" });
    expect(calculate("(1+2")).toMatchObject({ ok: false });
    expect(calculate("alert(1)")).toMatchObject({ ok: false, error: 'Unknown word "alert"' });
    expect(calculate("")).toMatchObject({ ok: false });
  });
});
