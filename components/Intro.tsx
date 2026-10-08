"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { ArrowRight, ListChecks, MessagesSquare, PencilLine, Play, RotateCcw } from "lucide-react";
import { Header, KaiFace } from "./ui";
import { newSession, post, save, useSaved } from "@/lib/client/store";

const STEP_PATH = { pretest: "/pretest", watch: "/watch", teach: "/teach", practice: "/practice", exercises: "/exercises", results: "/results" } as const;

export default function Intro({ topic, accessRequired, demo, parts, videoMinutes, practiceMinutes }: { topic: string; accessRequired: boolean; demo: boolean; parts: number; videoMinutes: number; practiceMinutes: number }) {
  const router = useRouter();
  const [saved] = useSaved();
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // a participant's link carries their own code (?code=…), so they only press Start
  useEffect(() => {
    const c = new URLSearchParams(window.location.search).get("code");
    if (c) setCode(c.slice(0, 64));
  }, []);

  async function start() {
    setBusy(true);
    setError(null);
    // team sessions: ?pid=… in the link joins the session with our other data (a participant's code does this itself)
    const pid = new URLSearchParams(window.location.search).get("pid")?.slice(0, 40) || undefined;
    const r = await post<{ token: string; expiresAt: number; demo: boolean; team: boolean; condition: "direct" | "recursive" }>("/api/session", { ...(accessRequired ? { accessCode: code } : {}), ...(pid && /^[A-Za-z0-9_-]+$/.test(pid) ? { pid } : {}) });
    setBusy(false);
    if (!r.ok) return setError(r.error);
    save(newSession(r.data.token, r.data.expiresAt, r.data.demo, r.data.team, r.data.condition));
    router.push("/pretest");
  }

  return (
    <div className="shell">
      <Header phase={0} demo={demo} />
      <main className="page intro">
        <div className="intro-head">
          <span className="eyebrow">A learning-by-teaching study for CS-411 Digital Education, EPFL</span>
          <h1 className="title">Learn {topic.toLowerCase()} by teaching them</h1>
          <p className="lede">
            You&apos;ll watch a short lesson, then explain it to Kai, a classmate who missed the lecture. Kai only knows what you tell it, so the better you explain, the more it understands. About 40 minutes in all, starting with five quick questions.
          </p>
        </div>

        <div className="intro-mid">
          <div className="hero-kai">
            <KaiFace mood="great" size={48} />
            <div className="col" style={{ display: "flex", flexDirection: "column", gap: 4 }}>
              <span className="who">Kai</span>
              <div className="bubble">Hi! I missed the lecture on bandits. Could you teach me once you&apos;ve watched it? I&apos;ll ask a lot of questions.</div>
            </div>
          </div>
        </div>

        <div className="intro-foot">
        <ol className="steps">
          <li>
            <span className="ico"><Play size={22} fill="currentColor" strokeWidth={0} /></span>
            <span className="eyebrow">Step 1</span>
            <h3>Watch</h3>
            <p>A short video lesson on multi-armed bandits{parts > 1 ? `, in ${parts} parts that play one after another` : ""}. About {videoMinutes} minutes.</p>
          </li>
          <li>
            <span className="ico"><MessagesSquare size={22} strokeWidth={2.2} /></span>
            <span className="eyebrow">Step 2</span>
            <h3>Teach Kai</h3>
            <p>Explain the ideas in your own words. Kai asks questions until it feels it understands. About 10 minutes.</p>
          </li>
          <li>
            <span className="ico"><PencilLine size={22} strokeWidth={2.2} /></span>
            <span className="eyebrow">Step 3</span>
            <h3>Practice</h3>
            <p>Two short rounds of problems, with two tries each. {practiceMinutes} minutes.</p>
          </li>
          <li>
            <span className="ico"><ListChecks size={22} strokeWidth={2.2} /></span>
            <span className="eyebrow">Step 4</span>
            <h3>Final test</h3>
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
                  <label htmlFor="code">Your access code</label>
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
            This is a study: what you write, your answers and how you use the app (clicks, timings, video playback) are recorded under a random session id, without your name. What you write to Kai is also sent to an AI model to generate its replies, so please don&apos;t include personal details.
          </p>
        </div>
        </div>
      </main>
    </div>
  );
}
