"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState, type RefObject } from "react";
import { Check, Mic, X } from "lucide-react";
import { Dictation, joinText } from "@/lib/client/dictation";
import { useSaved } from "@/lib/client/store";
import { track } from "@/lib/client/log";
import { useStudySettings } from "./SettingsContext";

/**
 * Voice input for a text box, in the manner of a live caption: press the mic and speak; the words appear in the box
 * in grey italics as they are understood (a piece every couple of seconds, cut at pauses), with a waveform and a
 * timer in the recording pill. Press ✓ and the whole recording is written out once more, more accurately, and
 * replaces the grey text; ✕ or Esc discards it. The learner can edit everything before sending. Hidden in demo mode
 * (no model) and in browsers that can't record.
 */

const BARS = 26;
type Phase = "idle" | "rec" | "finishing";

export function useDictation({
  where,
  value,
  field,
  disabled,
  onCommit,
}: {
  where: "teach" | "fix";
  value: string;
  field: RefObject<HTMLTextAreaElement | null>;
  disabled?: boolean;
  onCommit: (next: string, caret: number, dictatedChars: number) => void; // the text with the dictation in it
}) {
  const [saved] = useSaved();
  const { voice } = useStudySettings(); // voice input can be switched off on the admin panel
  const [phase, setPhase] = useState<Phase>("idle");
  const [parts, setParts] = useState({ before: "", after: "" });
  const [preview, setPreview] = useState("");
  const [pending, setPending] = useState(false);
  const [levels, setLevels] = useState<number[]>(() => Array(BARS).fill(0));
  const [sec, setSec] = useState(0);
  const [msg, setMsg] = useState<string | null>(null);
  const [can, setCan] = useState(false);
  const d = useRef<Dictation | null>(null);
  const peak = useRef(0);
  useEffect(() => setCan(typeof AudioWorkletNode !== "undefined" && !!navigator.mediaDevices?.getUserMedia), []);
  useEffect(() => () => d.current?.cancel(), []);

  // the waveform and the timer: about 20 frames a second while recording
  useEffect(() => {
    if (phase !== "rec") return;
    const id = window.setInterval(() => {
      setLevels((l) => [...l.slice(1), peak.current]);
      peak.current *= 0.35;
      setSec(Math.floor(d.current?.seconds ?? 0));
    }, 50);
    return () => window.clearInterval(id);
  }, [phase]);

  const finish = useCallback(async () => {
    const x = d.current;
    if (!x || phase !== "rec") return;
    setPhase("finishing");
    setPending(false);
    const seconds = Math.round(x.seconds);
    const previewChars = x.preview.length;
    try {
      const { text: said, final } = await x.finish();
      // a new sentence starts with a capital: at the start of the box, or after a full stop
      const text = !parts.before.trim() || /[.!?]\s*$/.test(parts.before) ? said.charAt(0).toUpperCase() + said.slice(1) : said;
      const head = joinText(parts.before, text);
      onCommit(joinText(head, parts.after), head.length, text.length);
      track("voice_done", { where, sec: seconds, chars: text.length, previewChars, final });
      if (!text) flash("Nothing was heard. Try again closer to the microphone.");
    } catch (e) {
      onCommit(joinText(parts.before, parts.after), parts.before.length, 0);
      flash(e instanceof Error ? e.message : "Voice input isn't working right now. Type instead.");
      track("voice_error", { where, why: "final" });
    }
    d.current = null;
    setPreview("");
    setPhase("idle");
    window.setTimeout(() => field.current?.focus(), 0);
  }, [phase, parts, onCommit, where, field]);

  const cancel = useCallback(() => {
    d.current?.cancel();
    d.current = null;
    setPreview("");
    setPending(false);
    setPhase("idle");
    track("voice_cancel", { where });
    window.setTimeout(() => field.current?.focus(), 0);
  }, [where, field]);

  // Esc discards while recording
  useEffect(() => {
    if (phase !== "rec") return;
    const key = (e: KeyboardEvent) => e.key === "Escape" && (e.preventDefault(), cancel());
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, [phase, cancel]);

  function flash(m: string) {
    setMsg(m);
    window.setTimeout(() => setMsg(null), 6000);
  }

  async function start() {
    if (!saved) return;
    setMsg(null);
    const ta = field.current;
    const at = ta ? ta.selectionStart : value.length;
    setParts({ before: value.slice(0, at), after: value.slice(at) });
    setPreview("");
    setLevels(Array(BARS).fill(0));
    setSec(0);
    const x = new Dictation(saved.token, where, {
      onLevel: (l) => (peak.current = Math.max(peak.current, l)),
      onPreview: (t, p) => (setPreview(t), setPending(p)),
      onLimit: () => void finishRef.current(),
    });
    d.current = x;
    try {
      await x.start();
      setPhase("rec");
      track("voice_start", { where });
    } catch {
      d.current = null;
      flash("The microphone is blocked. Allow it in your browser, or type.");
      track("voice_error", { where, why: "denied" });
    }
  }
  const finishRef = useRef(finish);
  finishRef.current = finish;

  const active = phase !== "idle";
  const shown = active ? joinText(joinText(parts.before, preview), parts.after) : value;

  const button =
    !can || !voice || !saved || saved.demo ? null : (
      <span className="voice">
        {msg && phase === "idle" && <span className="voice-msg" role="status">{msg}</span>}
        {phase === "idle" ? (
          <button type="button" className="voice-btn" onClick={() => void start()} disabled={disabled} aria-label="Speak instead of typing" title="Speak instead of typing (up to 2 minutes)">
            <Mic size={17} strokeWidth={2.2} />
          </button>
        ) : (
          <span className={`rec-pill${phase === "finishing" ? " finishing" : ""}`} role="group" aria-label="Recording">
            <button type="button" className="rec-x" onClick={cancel} disabled={phase !== "rec"} aria-label="Discard the recording" title="Discard (Esc)">
              <X size={15} strokeWidth={2.4} />
            </button>
            <span className="wave" aria-hidden="true">
              {levels.map((l, i) => (
                <i key={i} style={{ height: `${3 + Math.round(l * 17)}px` }} />
              ))}
            </span>
            <span className="rec-time" aria-live="off">
              {Math.floor(sec / 60)}:{String(sec % 60).padStart(2, "0")}
            </span>
            <button type="button" className="rec-ok" onClick={() => void finish()} disabled={phase !== "rec"} aria-label="Done: write it out" title="Done">
              {phase === "finishing" ? <span className="rec-spin" /> : <Check size={16} strokeWidth={2.8} />}
            </button>
          </span>
        )}
      </span>
    );

  const ghost = active ? <Ghost field={field} before={parts.before} text={preview} after={parts.after} pending={pending} finishing={phase === "finishing"} /> : null;

  return { button, active, shown, ghost };
}

/**
 * The text box's words drawn over it while dictating: what was typed in ink, the live transcript in grey italics,
 * a dot while more is on its way. It copies the box's font, padding and size, so the words sit where they will be.
 */
function Ghost({ field, before, text, after, pending, finishing }: { field: RefObject<HTMLTextAreaElement | null>; before: string; text: string; after: string; pending: boolean; finishing: boolean }) {
  const el = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const ta = field.current;
    const g = el.current;
    if (!ta || !g) return;
    const cs = getComputedStyle(ta);
    Object.assign(g.style, {
      top: `${ta.offsetTop}px`,
      left: `${ta.offsetLeft}px`,
      width: `${ta.offsetWidth}px`,
      height: `${ta.offsetHeight}px`,
      font: cs.font,
      letterSpacing: cs.letterSpacing,
      padding: cs.padding,
      borderStyle: "solid",
      borderColor: "transparent",
      borderWidth: cs.borderWidth,
      boxSizing: cs.boxSizing,
    });
    ta.scrollTop = ta.scrollHeight; // follow the newest words
    g.scrollTop = ta.scrollTop;
  });
  const sep1 = before && text && !/\s$/.test(before) ? " " : "";
  const sep2 = text && after && !/^\s/.test(after) ? " " : "";
  return (
    <div ref={el} className={`dict-ghost${finishing ? " finishing" : ""}`} aria-hidden="true">
      {before}
      {sep1}
      <span className="dict-live">{text || (!finishing ? "Listening…" : "")}</span>
      {pending && !finishing && <span className="dict-dot" />}
      {sep2}
      {after}
    </div>
  );
}
