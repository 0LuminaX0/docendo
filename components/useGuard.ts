"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";
import type { Saved } from "@/lib/client/store";

const ORDER: Saved["step"][] = ["watch", "teach", "exercises", "results"];
const PATH: Record<Saved["step"], string> = { watch: "/watch", teach: "/teach", exercises: "/exercises", results: "/results" };

/** Send the visitor home without a session, or back to the furthest step they have unlocked. */
export function useGuard(saved: Saved | null | undefined, here: Saved["step"]) {
  const router = useRouter();
  useEffect(() => {
    if (saved === undefined) return;
    if (saved === null) router.replace("/");
    else if (ORDER.indexOf(here) > ORDER.indexOf(saved.step)) router.replace(PATH[saved.step]);
  }, [saved, here, router]);
  return !!saved && ORDER.indexOf(here) <= ORDER.indexOf(saved.step);
}

export { PATH as STEP_PATH, ORDER as STEP_ORDER };
