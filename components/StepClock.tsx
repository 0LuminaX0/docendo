"use client";

import { useEffect, useState } from "react";
import { Timer } from "lucide-react";
import { track } from "@/lib/client/log";
import type { StepTime } from "@/lib/client/store";

// Every step a session runs has a time (Study setup), shown as this clock in the header; the pretest's and the test's
// per part. The start is kept with the session, so a reload doesn't restart it. Hard limits (timing.soft off): when it
// runs out the page ends the step itself. Soft (the pilot): the time is a recommendation, the clock counts on past it
// ("+1:20") and nothing ends; how long each step and part took against its time is logged (stepTime).

/** Time left on a step that began at `startedAt` with `minutes` to go (the whole time until it starts), and how far past
 * it the step has run (`overMs`, 0 until then). */
export function useDeadline(startedAt: number | null | undefined, minutes: number) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  const total = minutes * 60_000;
  const spent = startedAt ? Math.max(0, now - startedAt) : 0;
  const left = Math.max(0, total - spent);
  return { left, over: !!startedAt && left === 0, overMs: Math.max(0, spent - total), total };
}

const mmss = (ms: number) => {
  const s = Math.ceil(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
};

/** The header's clock. Soft: after the recommended time it shows the time past it, and says so in its title. */
export function StepClock({ left, over, overMs = 0, soft = false, what }: { left: number; over: boolean; overMs?: number; soft?: boolean; what: string }) {
  const past = soft && over;
  return (
    <span
      className={`clock${past ? " past" : `${left < 60_000 ? " low" : ""}${over ? " over" : ""}`}`}
      title={past ? `Past the suggested time for ${what}: take the time you need` : soft ? `Suggested time left for ${what}` : `Time left for ${what}`}
      role="timer"
      aria-live="off"
    >
      <Timer size={15} strokeWidth={2.4} />
      {past ? `+${mmss(overMs)}` : over ? "Time's up" : mmss(left)}
    </span>
  );
}

/** How long a step (or a part of it) took against its time: logged as step_time, and returned for the server's record
 * (the pretest and the test send theirs with the answers). diffMs: spent minus the time (negative: under it). */
export function stepTime(step: string, part: number | null, startedAt: number | null | undefined, minutes: number, extra: Record<string, unknown> = {}): StepTime {
  const ms = startedAt ? Math.max(0, Date.now() - startedAt) : 0;
  const limitMs = Math.round(minutes * 60_000);
  const t = { step, part, ms, limitMs, diffMs: ms - limitMs, over: ms > limitMs };
  track("step_time", { ...t, ...extra });
  return t;
}
