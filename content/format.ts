import type { Loc } from "./schema";

export function mmss(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

/** Human-readable place in a source: "04:12–04:41", "p. 27 · 2.2 Action-value Methods", "#regret". */
export function formatLoc(loc: Loc): string {
  switch (loc.kind) {
    case "time":
      return `${mmss(loc.start)}–${mmss(loc.end)}`;
    case "page":
      return `p. ${loc.page}${loc.section ? ` · ${loc.section}` : ""}`;
    case "anchor":
      return `#${loc.anchor} · ${loc.heading}`;
  }
}
