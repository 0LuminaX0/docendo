"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";
import type { Saved } from "@/lib/client/store";
import { currentStep, nextStep, pathOf, reached, type StepKey } from "@/lib/flow";
import { useStudySettings } from "./SettingsContext";

/** Send the visitor home without a session, or to the furthest step they have reached that the study runs. */
export function useGuard(saved: Saved | null | undefined, here: Saved["step"]) {
  const router = useRouter();
  const { flow } = useStudySettings();
  useEffect(() => {
    if (saved === undefined) return;
    if (saved === null) router.replace("/");
    else if (!fits(saved, here, flow)) router.replace(pathOf(saved.phase === "delayed" ? saved.step : currentStep(flow, saved.step)));
  }, [saved, here, router, flow]);
  return !!saved && fits(saved, here, flow);
}

/** A step is open once reached (and only if the study runs it); a delayed-test session has only the test and its results. */
function fits(saved: Saved, here: Saved["step"], flow: StepKey[]) {
  if (saved.phase === "delayed") return (here === "exercises" || here === "results") && (here === saved.step || here === "exercises");
  return reached(flow, saved.step, here);
}

/** Where a learner goes once a step is done: the next step the study runs. */
export function useNext() {
  const { flow } = useStudySettings();
  return (here: StepKey) => {
    const k = nextStep(flow, here);
    return { step: k, path: pathOf(k) };
  };
}
