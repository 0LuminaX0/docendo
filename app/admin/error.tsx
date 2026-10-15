"use client";

import Link from "next/link";
import { RotateCcw } from "lucide-react";

/**
 * An admin page failed on the server. Production hides the message from the browser; the reference (digest) is the
 * one in the server's log (Vercel: the project's Logs), where the full error is.
 */
export default function AdminError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <main className="center-page">
      <div className="center-box">
        <h1>This admin page failed to load</h1>
        <p className="lede">
          The server ran into an error. Nothing was changed. Try again; if it keeps failing, look up the reference below in the server&apos;s logs (on Vercel: the project&apos;s Logs).
        </p>
        {error.digest && (
          <p className="note">
            Reference: <code>{error.digest}</code>
          </p>
        )}
        <div className="row">
          <button className="btn primary" onClick={reset}>
            <RotateCcw size={16} /> Try again
          </button>
          <Link className="btn ghost" href="/admin">
            Back to the dashboard
          </Link>
        </div>
      </div>
    </main>
  );
}
