"use client";

import { useEffect } from "react";
import { RotateCcw } from "lucide-react";
import { track } from "@/lib/client/log";

/** Something broke on a page: a friendly way back. Progress lives in the browser, so nothing is lost. */
export default function Error({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    track("page_error", { message: error.message.slice(0, 300), digest: error.digest ?? null });
  }, [error]);
  return (
    <main className="center-page">
      <div className="center-box">
        <h1>Something went wrong on this page</h1>
        <p className="lede">Your progress is saved in this browser, so nothing is lost. Try again; if it keeps happening, reload the page.</p>
        <div className="row">
          <button className="btn primary" onClick={reset}>
            <RotateCcw size={16} /> Try again
          </button>
          <button className="btn ghost" onClick={() => location.reload()}>
            Reload the page
          </button>
        </div>
      </div>
    </main>
  );
}
