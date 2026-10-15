"use client";

import { useEffect, useRef, useState } from "react";
import { Calculator as CalcIcon } from "lucide-react";
import { format, sumAtEnd } from "@/lib/calc";
import { track } from "@/lib/client/log";
import { useDictation } from "./Dictation";
import { useStudySettings } from "./SettingsContext";

/**
 * One field for working and sums, the same everywhere (practice, the correction
 * to Kai, the final test). Type a sum and "=" and its result is written after
 * it, like a calculator in a notes app; the line being typed shows its value
 * underneath. A row of keys (× ÷ √ …) can be shown for typing symbols; it is
 * closed by default and stays as the learner left it.
 */

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
  ["=", " ="],
];
const KEYS_OPEN = "docendo:calc-keys";

export default function Scratchpad({
  id,
  where,
  value,
  onChange,
  placeholder,
  rows = 3,
  maxLength = 4000,
  disabled,
  onUse,
  label,
  voice,
}: {
  id: string;
  where: string; // for the log
  value: string;
  onChange: (v: string) => void;
  placeholder: string;
  rows?: number;
  maxLength?: number;
  disabled?: boolean;
  onUse?: (value: number) => void; // number problems: put the last result in the answer box
  label: string;
  voice?: "fix"; // a mic for speaking instead of typing (the correction to Kai)
}) {
  const ref = useRef<HTMLTextAreaElement>(null);
  const { calculator } = useStudySettings(); // the calculator can be switched off (admin panel), in both conditions
  // voice input (the correction to Kai): the live transcript shows in the field while the learner speaks
  const dict = useDictation({
    where: voice ?? "fix",
    value,
    field: ref,
    disabled,
    onCommit: (next, caret, n) => {
      if (n) track("practice_fix_dictated", { where, chars: n });
      onChange(next.slice(0, maxLength));
      requestAnimationFrame(() => (ref.current?.setSelectionRange(caret, caret), setCaret(caret)));
    },
  });
  const [caret, setCaret] = useState(0);
  const [keys, setKeys] = useState(false);
  useEffect(() => {
    try {
      setKeys(localStorage.getItem(KEYS_OPEN) === "1");
    } catch {
      // private mode: closed
    }
  }, []);

  // the line the caret is on, for the live preview
  const lineStart = value.lastIndexOf("\n", caret - 1) + 1;
  const lineEnd = value.indexOf("\n", caret) === -1 ? value.length : value.indexOf("\n", caret);
  const line = value.slice(lineStart, lineEnd);
  const done = /=\s*-?[\d.]+\s*$/.test(line);
  const sum = calculator && !done ? sumAtEnd(line) : null;
  const lastResult = calculator ? [...value.matchAll(/=\s*(-?\d+(?:\.\d+)?)\s*$/gm)].pop()?.[1] : undefined;

  /** "=" right after a sum: write its result after it. */
  function edit(next: string, at: number) {
    if (calculator && next[at - 1] === "=" && next.length > value.length) {
      const start = next.lastIndexOf("\n", at - 1) + 1;
      const s = sumAtEnd(next.slice(start, at));
      if (s) {
        const result = ` ${format(s.value)}`;
        next = next.slice(0, at) + result + next.slice(at);
        at += result.length;
        track("calc", { where, expr: s.expr.slice(0, 200), result: format(s.value) });
      }
    }
    onChange(next.slice(0, maxLength));
    requestAnimationFrame(() => {
      ref.current?.setSelectionRange(at, at);
      setCaret(at);
    });
  }

  function insert(text: string) {
    const el = ref.current;
    if (!el) return;
    const a = el.selectionStart;
    const b = el.selectionEnd;
    el.focus();
    edit(value.slice(0, a) + text + value.slice(b), a + text.length);
  }

  function toggleKeys() {
    const next = !keys;
    setKeys(next);
    track("calc_keys", { where, open: next });
    try {
      localStorage.setItem(KEYS_OPEN, next ? "1" : "0");
    } catch {
      // not remembered
    }
  }

  return (
    <div className={`scratch${disabled ? " off" : ""}`}>
      <label className="sr-only" htmlFor={id}>{label}</label>
      <textarea
        ref={ref}
        id={id}
        className={`work${dict.active ? " dictating" : ""}`}
        rows={rows}
        maxLength={maxLength}
        placeholder={placeholder}
        value={dict.shown}
        readOnly={dict.active}
        disabled={disabled}
        spellCheck={false}
        onChange={(e) => !dict.active && edit(e.target.value, e.target.selectionStart)}
        onSelect={(e) => setCaret(e.currentTarget.selectionStart)}
        onBlur={(e) => e.target.value && track("practice_work", { where, chars: e.target.value.length, text: e.target.value.slice(0, 2000) })}
      />
      {dict.ghost}
      <div className="scratch-bar">
        {calculator && (
          <span className="scratch-hint" aria-live="polite">
            {sum ? (
              <>
                Result: <b>{format(sum.value)}</b>. Type = to add it.
              </>
            ) : (
              "To calculate, type it and end with =, like 12 × 0.9 + 3 ="
            )}
          </span>
        )}
        <span className="grow" />
        {voice && dict.button}
        {onUse && lastResult && !disabled && (
          <button type="button" className="linkish" onClick={() => (onUse(Number(lastResult)), track("calc_use", { where, value: lastResult }))}>
            Use {lastResult} as the answer
          </button>
        )}
        {calculator && (
          <button type="button" className={`scratch-toggle${keys ? " on" : ""}`} aria-pressed={keys} onClick={toggleKeys} disabled={disabled} title="Buttons for the maths symbols that are hard to type">
            <CalcIcon size={14} /> {keys ? "Hide" : "Show"} × ÷ √
          </button>
        )}
      </div>
      {calculator && keys && !disabled && (
        <div className="calc-keys" role="group" aria-label="Maths symbols">
          {KEYS.map(([k, s]) => (
            <button key={k} type="button" onMouseDown={(e) => e.preventDefault()} onClick={() => insert(s)} aria-label={`Insert ${k}`}>
              {k}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
