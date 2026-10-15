"use client";

import { useEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import { WifiOff } from "lucide-react";
import { track } from "@/lib/client/log";

/**
 * Two safety nets for the participant pages:
 *  - one tab at a time: progress lives in this browser's storage, and two tabs on the same session overwrite each
 *    other's work. A tab that opens while another is in use asks which one to keep; the other one steps aside;
 *  - offline: a quiet bar while the connection is gone (the work stays saved here; sending resumes when it's back).
 */
export default function SessionGuard() {
  const path = usePathname();
  const [other, setOther] = useState(false);
  const [offline, setOffline] = useState(false);
  const id = useRef(Math.random().toString(36).slice(2));
  const ch = useRef<BroadcastChannel | null>(null);

  useEffect(() => {
    // not on the admin panel, the start page, or Kai's mind (opened in its own window on purpose, only to read)
    if (path.startsWith("/admin") || path === "/" || path === "/mind" || typeof BroadcastChannel === "undefined") return;
    const c = new BroadcastChannel("docendo-session");
    ch.current = c;
    c.onmessage = (e: MessageEvent<{ type: string; id: string }>) => {
      if (e.data.id === id.current) return;
      // a newer tab says hello: answer, so it knows this one is open; a tab that takes over: step aside
      if (e.data.type === "hello") c.postMessage({ type: "here", id: id.current });
      if (e.data.type === "here") setOther(true);
      if (e.data.type === "take") setOther(true);
    };
    c.postMessage({ type: "hello", id: id.current });
    return () => c.close();
  }, [path]);

  useEffect(() => {
    const on = () => setOffline(false);
    const off = () => (setOffline(true), track("offline"));
    setOffline(typeof navigator !== "undefined" && navigator.onLine === false);
    window.addEventListener("online", on);
    window.addEventListener("offline", off);
    return () => (window.removeEventListener("online", on), window.removeEventListener("offline", off));
  }, []);

  useEffect(() => {
    if (other) track("second_tab", { path });
  }, [other, path]);

  return (
    <>
      {other && (
        <div className="guard" role="alertdialog" aria-labelledby="guard-h">
          <div className="guard-box">
            <h2 id="guard-h">Docendo is open in another tab</h2>
            <p>Use one tab at a time, so your progress isn&apos;t overwritten. Close the other tab, or keep working here.</p>
            <button
              className="btn primary"
              onClick={() => {
                ch.current?.postMessage({ type: "take", id: id.current });
                track("second_tab_take", { path });
                location.reload(); // pick up the latest saved progress
              }}
            >
              Use this tab
            </button>
          </div>
        </div>
      )}
      {offline && (
        <div className="offline" role="status">
          <WifiOff size={15} /> You&apos;re offline. Your work is saved on this device; carry on once you&apos;re back online.
        </div>
      )}
    </>
  );
}
