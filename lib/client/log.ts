"use client";

// Client-side research events, batched to /api/log. Nothing here blocks the
// page: events queue up and go out every few seconds, and on page hide with a
// keepalive request so the last ones aren't lost. No-op without a session.

type Value = string | number | boolean | null | (string | number)[];
type Ev = { type: string; at: number; path: string; seq: number; data?: Record<string, Value> };

const KEY = "docendo:session:v1";
let queue: Ev[] = [];
let timer: ReturnType<typeof setTimeout> | null = null;
let seq = 0;

function token(): string | null {
  try {
    const s = JSON.parse(localStorage.getItem(KEY) || "null") as { token?: string; expiresAt?: number } | null;
    return s?.token && (s.expiresAt ?? 0) > Date.now() ? s.token : null;
  } catch {
    return null;
  }
}

export function track(type: string, data?: Record<string, Value>) {
  if (typeof window === "undefined") return;
  queue.push({ type, at: Date.now(), path: location.pathname.slice(0, 40), seq: seq++, data });
  if (queue.length >= 40 || type === "page_view") flush(); // a new page: send what the last one collected
  else if (!timer) timer = setTimeout(() => flush(), 15_000); // batched: one request per 15 s at most (tab hide/close sends at once)
}

export function flush(keepalive = false) {
  if (timer) clearTimeout(timer);
  timer = null;
  const t = token();
  if (!t || !queue.length) {
    if (!t) queue = queue.slice(-100); // before the session exists: keep a few, send once it does
    return;
  }
  while (queue.length) {
    const events = queue.splice(0, 60);
    void fetch("/api/log", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ token: t, events }), keepalive }).catch(() => {});
  }
}

let installed = false;
/** Page-level listeners, once per tab: visibility (tab switches) and page hide. */
export function installTelemetry() {
  if (installed || typeof window === "undefined") return;
  installed = true;
  let hiddenAt: number | null = null;
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") {
      hiddenAt = Date.now();
      track("tab_hidden");
      flush(true);
    } else {
      track("tab_visible", { awayMs: hiddenAt ? Date.now() - hiddenAt : null });
      hiddenAt = null;
    }
  });
  window.addEventListener("pagehide", () => flush(true));
}
