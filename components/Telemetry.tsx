"use client";

import { usePathname } from "next/navigation";
import { useEffect } from "react";
import { installTelemetry, track } from "@/lib/client/log";

/** Logs every page view (and the screen once per tab) for the research log. Renders nothing. */
export default function Telemetry() {
  const path = usePathname();
  useEffect(() => {
    installTelemetry();
    track("env", {
      w: window.innerWidth,
      h: window.innerHeight,
      dpr: window.devicePixelRatio,
      lang: navigator.language,
      tzOffsetMin: new Date().getTimezoneOffset(),
      touch: "ontouchstart" in window,
    });
  }, []);
  useEffect(() => {
    track("page_view", { path });
  }, [path]);
  return null;
}
