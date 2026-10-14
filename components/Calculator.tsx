"use client";

import { useRef, useState } from "react";
import { CornerDownLeft } from "lucide-react";
import { calculate } from "@/lib/calc";
import { track } from "@/lib/client/log";

const KEYS: [string, string][] = [
  ["+", " + "],
  ["−", " - "],
  ["×", " × "],
  ["÷", " ÷ "],
  ["^", "^"],
  ["√", "√("],
  ["%", "%"],
  ["(", "("],
  [")", ")"],
];

/**
 * A small calculator for the arithmetic, so a slip in a sum never hides whether
 * the learner applied the rule right. The result shows as you type; Enter (or =)
 * hands "expression = result" to the parent, which writes it into the working.
 */
export default function Calculator({ where, onResult, label = "Calculator" }: { where: string; onResult: (line: string, value: number) => void; label?: string }) {
  const [expr, setExpr] = useState("");
  const ref = useRef<HTMLInputElement>(null);
  const r = expr.trim() ? calculate(expr) : null;

  function insert(s: string) {
    const el = ref.current;
    const at = el?.selectionStart ?? expr.length;
    const next = expr.slice(0, at) + s + expr.slice(el?.selectionEnd ?? at);
    setExpr(next);
    requestAnimationFrame(() => {
      el?.focus();
      el?.setSelectionRange(at + s.length, at + s.length);
    });
  }

  function commit() {
    if (!r) return;
    track("calc", { where, expr: expr.slice(0, 200), result: r.ok ? r.text : null, error: r.ok ? null : r.error });
    if (!r.ok) return;
    onResult(`${expr.trim()} = ${r.text}`, r.value);
    setExpr("");
  }

  return (
    <div className="calc" role="group" aria-label={label}>
      <div className="calc-line">
        <input
          ref={ref}
          className="calc-in"
          inputMode="decimal"
          autoComplete="off"
          spellCheck={false}
          aria-label={`${label}: type a calculation`}
          placeholder="Calculate, e.g. 0.8 × 1000 + 200 ÷ 3"
          value={expr}
          maxLength={200}
          onChange={(e) => setExpr(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === "=") {
              e.preventDefault();
              commit();
            }
          }}
        />
        <span className={`calc-out${r && !r.ok ? " err" : ""}`} aria-live="polite">
          {r ? (r.ok ? `= ${r.text}` : r.error) : ""}
        </span>
        <button type="button" className="calc-go" onClick={commit} disabled={!r?.ok} title="Add to your working (Enter)" aria-label="Add the result to your working">
          <CornerDownLeft size={15} strokeWidth={2.4} />
        </button>
      </div>
      <div className="calc-keys">
        {KEYS.map(([k, s]) => (
          <button key={k} type="button" onClick={() => insert(s)} aria-label={`Insert ${k}`}>
            {k}
          </button>
        ))}
      </div>
    </div>
  );
}
