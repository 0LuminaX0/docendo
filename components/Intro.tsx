"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { ArrowRight, ListChecks, MessagesSquare, Play, RotateCcw } from "lucide-react";
import { Header, KaiFace } from "./ui";
import { newSession, post, save, useSaved } from "@/lib/client/store";

const STEP_PATH = { watch: "/watch", teach: "/teach", exercises: "/exercises", results: "/results" } as const;

export default function Intro({ topic, accessRequired, demo, parts, videoMinutes }: { topic: string; accessRequired: boolean; demo: boolean; parts: number; videoMinutes: number }) {
  const router = useRouter();
  const [saved] = useSaved();
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function start() {
    setBusy(true);
    setError(null);
    const r = await post<{ token: string; expiresAt: number; demo: boolean }>("/api/session", accessRequired ? { accessCode: code } : {});
    setBusy(false);
    if (!r.ok) return setError(r.error);
    save(newSession(r.data.token, r.data.expiresAt, r.data.demo));
    router.push("/watch");
  }

  return (
    <div className="shell">
      <Header phase={0} demo={demo} />
      <main className="page">
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          <span className="eyebrow">A learning-by-teaching study · CS-411 Digital Education, EPFL</span>
          <h1 className="title">Learn {topic.toLowerCase()} by teaching them</h1>
          <p className="lede">
            You&apos;ll watch a short lesson, then explain it to Kai, a classmate who missed the lecture. Kai only knows what you tell it, so the better you explain, the more it understands.
          </p>
        </div>

        <div className="hero-kai">
          <KaiFace mood="great" size={44} />
          <div className="col" style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            <span className="who">Kai</span>
            <div className="bubble">Hi! I missed the lecture on bandits. Could you teach me once you&apos;ve watched it? I&apos;ll ask a lot of questions.</div>
          </div>
        </div>

        <ol className="steps">
          <li>
            <span className="ico"><Play size={22} fill="currentColor" strokeWidth={0} /></span>
            <span className="eyebrow">Step 1</span>
            <h3>Watch</h3>
            <p>{parts > 1 ? `A lesson in ${parts} short videos` : "A short video lesson"} on multi-armed bandits. About {videoMinutes} minutes.</p>
          </li>
          <li>
            <span className="ico"><MessagesSquare size={22} strokeWidth={2.2} /></span>
            <span className="eyebrow">Step 2</span>
            <h3>Teach Kai</h3>
            <p>Explain the ideas in your own words. Kai asks questions until it feels it understands, at most 30 messages. About 20 minutes.</p>
          </li>
          <li>
            <span className="ico"><ListChecks size={22} strokeWidth={2.2} /></span>
            <span className="eyebrow">Step 3</span>
            <h3>Exercises</h3>
            <p>Ten multiple-choice questions to see what stuck. About 10 minutes.</p>
          </li>
        </ol>

        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          {saved && (
            <div className="row">
              <button className="btn primary" onClick={() => router.push(STEP_PATH[saved.step])}>
                Continue where you left off <ArrowRight size={17} />
              </button>
              <button className="btn ghost" onClick={() => save(null)}>
                <RotateCcw size={15} /> Start over
              </button>
            </div>
          )}
          {saved === null && (
            <form
              className="row"
              style={{ alignItems: "flex-end" }}
              onSubmit={(e) => {
                e.preventDefault();
                void start();
              }}
            >
              {accessRequired && (
                <div className="field">
                  <label htmlFor="code">Access code</label>
                  <input id="code" className="input" value={code} onChange={(e) => setCode(e.target.value)} autoComplete="off" maxLength={64} required />
                </div>
              )}
              <button className="btn primary" type="submit" disabled={busy || (accessRequired && !code.trim())}>
                {busy ? "Starting…" : <>Start <ArrowRight size={17} /></>}
              </button>
            </form>
          )}
          {error && <p className="error" role="alert">{error}</p>}
          <p className="note">
            Your progress is kept in this browser only. What you write to Kai is sent to an AI model to generate its replies, so please don&apos;t include personal details.
          </p>
        </div>
      </main>
    </div>
  );
}
