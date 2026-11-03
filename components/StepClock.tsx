"use client";

import { useEffect, useState } from "react";
import { Timer } from "lucide-react";

// Every step a session runs has a hard time limit (Study setup), shown as this clock in the header. The start is kept
// with the session, so a reload doesn't restart it; when it runs out the page ends the step itself.

/** Time left on a step that began at `startedAt` with `minutes` to go (the whole limit until it starts). */
export function useDeadline(startedAt: number | null | undefined, minutes: number) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  const total = minutes * 60_000;
  const left = startedAt ? Math.min(total, Math.max(0, total - (now - startedAt))) : total;
  return { left, over: !!startedAt && left === 0, total };
}

const mmss = (ms: number) => {
  const s = Math.ceil(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
};

export function StepClock({ left, over, what }: { left: number; over: boolean; what: string }) {
  return (
    <span className={`clock${left < 60_000 ? " low" : ""}${over ? " over" : ""}`} title={`Time left for ${what}`} role="timer" aria-live="off">
      <Timer size={15} strokeWidth={2.4} />
      {over ? "Time's up" : mmss(left)}
    </span>
  );
}
