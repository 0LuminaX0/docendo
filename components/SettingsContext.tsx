"use client";

import { createContext, useContext, useMemo } from "react";
import type { PublicSettings } from "@/lib/settings";
import { useSaved } from "@/lib/client/store";

// The study settings a participant's pages need (lib/settings.ts, publicOf), read on the server for every page load
// (app/layout.tsx) and handed down here. A session started with a shared code has its clocks fixed by the code
// (`soft` in its token and saved session: the pilot's code soft, the other hard), whatever Study setup says.
const Ctx = createContext<PublicSettings | null>(null);

export function SettingsProvider({ value, children }: { value: PublicSettings; children: React.ReactNode }) {
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useStudySettings(): PublicSettings {
  const s = useContext(Ctx);
  const [saved] = useSaved();
  const soft = saved?.soft;
  const value = useMemo(() => (s && typeof soft === "boolean" && soft !== s.limits.soft ? { ...s, limits: { ...s.limits, soft } } : s), [s, soft]);
  if (!value) throw new Error("useStudySettings outside SettingsProvider");
  return value;
}
