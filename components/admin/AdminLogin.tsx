"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { ArrowRight, Lock } from "lucide-react";

export default function AdminLogin({ enabled }: { enabled: boolean }) {
  const router = useRouter();
  const [pw, setPw] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const res = await fetch("/api/admin/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ password: pw }) });
    setBusy(false);
    if (res.ok) return router.replace("/admin");
    setError(((await res.json().catch(() => ({}))) as { error?: string }).error ?? "Couldn't sign in.");
  }

  return (
    <div className="adm-login">
      <form onSubmit={submit} className="adm-login-box">
        <span className="brand">
          docendo <span className="adm-tag">admin</span>
        </span>
        {enabled ? (
          <>
            <h1>Sign in</h1>
            <p className="note">The research data and access codes of the Docendo study.</p>
            <div className="field">
              <label htmlFor="pw">Password</label>
              <input id="pw" type="password" className="input" value={pw} onChange={(e) => setPw(e.target.value)} autoComplete="current-password" autoFocus required />
            </div>
            <button className="btn primary" disabled={busy || !pw}>
              <Lock size={15} /> {busy ? "Checking…" : "Sign in"} {!busy && <ArrowRight size={15} />}
            </button>
            {error && <p className="error" role="alert">{error}</p>}
          </>
        ) : (
          <>
            <h1>The admin panel is off</h1>
            <p className="note">Set ADMIN_PASSWORD (10 characters or more) in the server&apos;s environment and redeploy.</p>
          </>
        )}
      </form>
    </div>
  );
}
