// The calculator learners get in practice and in the final test: the study measures whether they can apply
// the rules, not their arithmetic. A small recursive-descent evaluator (no eval):
//   + - * / × ÷ ^, brackets, a postfix % ("20%" is 0.2, "20% of 1000" is 200), √ or sqrt, ln, log (base 10),
//   exp, abs, round, pi, e, decimal commas ("0,85") and thousands separators ("1,000").

export type CalcResult = { ok: true; value: number; text: string } | { ok: false; error: string };

const FUNCS: Record<string, (x: number) => number> = {
  sqrt: Math.sqrt,
  ln: Math.log,
  log: Math.log10,
  exp: Math.exp,
  abs: Math.abs,
  round: Math.round,
};

export function calculate(input: string): CalcResult {
  const src = input
    .toLowerCase()
    .replace(/×/g, "*")
    .replace(/÷/g, "/")
    .replace(/−/g, "-")
    .replace(/√/g, "sqrt")
    .replace(/π/g, "pi")
    .replace(/\bof\b/g, "*")
    .replace(/(\d),(\d{3})(?!\d)/g, "$1$2") // 1,000
    .replace(/(\d),(\d)/g, "$1.$2") // 0,85
    .trim();
  if (!src) return { ok: false, error: "Type a calculation, for example 0.8 * 1000 + 200 / 3" };
  let i = 0;
  const peek = () => {
    while (src[i] === " ") i++;
    return src[i];
  };
  const fail = (msg: string): never => {
    throw new Error(msg);
  };

  function expr(): number {
    let v = term();
    for (;;) {
      const c = peek();
      if (c === "+") (i++, (v += term()));
      else if (c === "-") (i++, (v -= term()));
      else return v;
    }
  }
  function term(): number {
    let v = unary();
    for (;;) {
      const c = peek();
      if (c === "*") (i++, (v *= unary()));
      else if (c === "/") {
        i++;
        const d = unary();
        if (d === 0) fail("Can't divide by zero");
        v /= d;
      } else if (c === "(" || (c && /[a-z]/.test(c))) v *= unary(); // 2(3+4), 2pi
      else return v;
    }
  }
  function unary(): number {
    const c = peek();
    if (c === "-") return (i++, -unary());
    if (c === "+") return (i++, unary());
    return power();
  }
  function power(): number {
    const base = postfix();
    if (peek() === "^") {
      i++;
      return base ** unary(); // right-associative: 2^3^2 = 2^9
    }
    return base;
  }
  function postfix(): number {
    let v = primary();
    while (peek() === "%") (i++, (v /= 100));
    return v;
  }
  function primary(): number {
    const c = peek();
    if (c === "(") {
      i++;
      const v = expr();
      if (peek() !== ")") fail("A bracket isn't closed");
      i++;
      return v;
    }
    const num = /^\d*\.?\d+(?:e[+-]?\d+)?/.exec(src.slice(i));
    if (num) {
      i += num[0].length;
      return Number(num[0]);
    }
    const word = /^[a-z]+/.exec(src.slice(i));
    if (word) {
      i += word[0].length;
      if (word[0] === "pi") return Math.PI;
      if (word[0] === "e") return Math.E;
      const f = FUNCS[word[0]];
      if (!f) fail(`Unknown word "${word[0]}"`);
      const arg = peek() === "(" ? primary() : unary();
      return f!(arg);
    }
    return fail(c ? `Unexpected "${c}"` : "The calculation ends too early");
  }

  try {
    const value = expr();
    if (peek() !== undefined) fail(`Unexpected "${peek()}"`);
    if (!Number.isFinite(value)) fail("The result isn't a number");
    return { ok: true, value, text: format(value) };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Can't calculate that" };
  }
}

/** Up to 6 decimals, no trailing zeros, no float noise (0.1 + 0.2 shows 0.3). */
export function format(v: number): string {
  const r = Math.round(v * 1e6) / 1e6;
  return Object.is(r, -0) ? "0" : String(r);
}

/** The sum at the end of a line ("A: 6.1 + 0.5" → "6.1 + 0.5"), if there is one: words alone are not a sum. */
export function sumAtEnd(line: string): { expr: string; value: number } | null {
  const text = line.replace(/=\s*$/, "").trimEnd();
  // try from the earliest start that still parses, so "A: 6.1 + 0.5" finds "6.1 + 0.5"
  const starts = [0, ...[...text.matchAll(/[\s:;,(]/g)].map((m) => (m.index ?? 0) + 1)];
  for (const s of starts) {
    const expr = text.slice(s).trim();
    if (!expr || !/[+\-*/×÷^%√]|\b(sqrt|ln|log|exp)\b|\bof\b/i.test(expr) || !/\d/.test(expr)) continue;
    const r = calculate(expr);
    if (r.ok) return { expr, value: r.value };
  }
  return null;
}
