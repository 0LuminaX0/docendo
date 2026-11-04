"use client";

import { FastForward } from "lucide-react";
import { useSaved } from "@/lib/client/store";
import { track } from "@/lib/client/log";

/**
 * Sessions started with the shared code (ACCESS_CODE) only: a button in the corner that skips to the next stage (the
 * next part of the pretest or test, else the next step) without waiting for a clock or answering everything. For trying
 * the flow; logged as debug_skip, and a skipped pretest or test is graded and marked skipped.
 */
export default function DebugSkip({ onSkip, what = "Skip to the next stage" }: { onSkip: () => void; what?: string }) {
  const [saved] = useSaved();
  if (!saved?.debug) return null;
  return (
    <button
      type="button"
      className="debug-skip"
      onClick={() => {
        track("debug_skip", { step: saved.step, what });
        onSkip();
      }}
      title="Debug (shared code only): skip without waiting"
    >
      <FastForward size={15} strokeWidth={2.4} aria-hidden="true" /> {what}
      <span className="debug-tag">debug</span>
    </button>
  );
}
