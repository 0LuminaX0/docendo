"use client";

import { createContext, useContext } from "react";
import type { PublicSettings } from "@/lib/settings";

// The study settings a participant's pages need (lib/settings.ts, publicOf), read on the server for every page load
// (app/layout.tsx) and handed down here.
const Ctx = createContext<PublicSettings | null>(null);

export function SettingsProvider({ value, children }: { value: PublicSettings; children: React.ReactNode }) {
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useStudySettings(): PublicSettings {
  const s = useContext(Ctx);
  if (!s) throw new Error("useStudySettings outside SettingsProvider");
  return s;
}
