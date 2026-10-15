"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { RefreshCw } from "lucide-react";

/** Re-render the server page every `seconds` while the tab is visible (the Live page), with the time of the last update. */
export default function AutoRefresh({ seconds = 20 }: { seconds?: number }) {
  const router = useRouter();
  const [at, setAt] = useState<string | null>(null);
  const [on, setOn] = useState(true);
  useEffect(() => {
    const stamp = () => setAt(new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" }));
    stamp();
    if (!on) return;
    const t = setInterval(() => {
      if (document.visibilityState !== "visible") return;
      router.refresh();
      stamp();
    }, seconds * 1000);
    return () => clearInterval(t);
  }, [router, seconds, on]);
  return (
    <span className="adm-refresh">
      <button type="button" className="btn ghost small" onClick={() => setOn((x) => !x)} aria-pressed={on}>
        <RefreshCw size={14} className={on ? "spin-slow" : ""} /> {on ? `Every ${seconds} s` : "Paused"}
      </button>
      {at && <span className="note">updated {at}</span>}
    </span>
  );
}
