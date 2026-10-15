"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { ArrowRight, ListChecks, MessagesSquare, PencilLine, Play, RotateCcw } from "lucide-react";
import { Header, KaiFace } from "./ui";
import { newSession, post, save, useSaved } from "@/lib/client/store";

const CONSENT =
  "I understand this is a study: what I write, my answers and how I use the app (clicks, timings, video playback) are recorded under a random session id, without my name. What I write to Kai is sent to an AI model to generate its replies, so I won't include personal details.";

const STEP_PATH = { pretest: "/pretest", watch: "/watch", teach: "/teach", practice: "/practice", exercises: "/exercises", results: "/results" } as const;

type Started = { token: string; expiresAt: number; demo: boolean; team: boolean; condition: "direct" | "recursive"; phase?: "main" | "delayed" };

export default function Intro({
  topic,
  accessRequired,
  demo,
  parts,
  videoMinutes,
  practiceMinutes,
  followUpDays,
}: {
  topic: string;
  accessRequired: boolean;
  demo: boolean;
  parts: number;
  videoMinutes: number;
  practiceMinutes: number;
  followUpDays: number | null; // the delayed test opens this many days after the final test (null: no delayed test)
}) {
  const router = useRouter();
  const [saved] = useSaved();
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null); // not an error: e.g. "your follow-up test opens on …"
  const [agree, setAgree] = useState(false);

  // a participant's link carries their own code (?code=…), so they only press Start
  useEffect(() => {
    const c = new URLSearchParams(window.location.search).get("code");
    if (c) setCode(c.slice(0, 64));
  }, []);

  /** A new session, or (with `followUp`, a finished session's token on this device) the delayed test. */
  async function start(followUp?: string) {
    setBusy(true);
    setError(null);
    setInfo(null);
    // team sessions: ?pid=… in the link joins the session with our other data (a participant's code does this itself)
    const pid = new URLSearchParams(window.location.search).get("pid")?.slice(0, 40) || undefined;
    const r = await post<Started>("/api/session", {
      consent: true,
      ...(followUp ? { followUp } : accessRequired ? { accessCode: code } : {}),
      ...(pid && /^[A-Za-z0-9_-]+$/.test(pid) ? { pid } : {}),
    });
    setBusy(false);
    // 409: the code is known and its tests are done, or the follow-up isn't open yet: a message, not an error
    if (!r.ok) return r.status === 409 ? setInfo(r.error) : setError(r.error);
    const s = newSession(r.data.token, r.data.expiresAt, r.data.demo, r.data.team, r.data.condition);
    if (r.data.phase === "delayed") {
      save({ ...s, phase: "delayed", step: "exercises" });
      router.push("/exercises");
    } else {
      save(s);
      router.push("/pretest");
    }
  }

  // a finished session on this device: the follow-up test, once it is open (participants only)
  const followUp = saved && followUpDays && saved.step === "results" && saved.phase !== "delayed" && !saved.team && saved.finishedAt ? saved.finishedAt + followUpDays * 86_400_000 : null;
  const opensText = followUp ? new Date(followUp).toLocaleDateString(undefined, { weekday: "long", day: "numeric", month: "long" }) : "";

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
            <div className="step-top">
              <span className="ico"><Play size={19} fill="currentColor" strokeWidth={0} /></span>
              <div>
                <span className="eyebrow">Step 1</span>
                <h3>Watch</h3>
              </div>
            </div>
            <p>A short video lesson on multi-armed bandits{parts > 1 ? `, in ${parts} parts that play one after another` : ""}. About {videoMinutes} minutes.</p>
          </li>
          <li>
            <div className="step-top">
              <span className="ico"><MessagesSquare size={19} strokeWidth={2.2} /></span>
              <div>
                <span className="eyebrow">Step 2</span>
                <h3>Teach Kai</h3>
              </div>
            </div>
            <p>Explain the ideas in your own words. Kai asks questions until it feels it understands. About 10 minutes.</p>
          </li>
          <li>
            <div className="step-top">
              <span className="ico"><PencilLine size={19} strokeWidth={2.2} /></span>
              <div>
                <span className="eyebrow">Step 3</span>
                <h3>Practice</h3>
              </div>
            </div>
            <p>Two short rounds of problems, with two tries each. {practiceMinutes} minutes.</p>
          </li>
          <li>
            <div className="step-top">
              <span className="ico"><ListChecks size={19} strokeWidth={2.2} /></span>
              <div>
                <span className="eyebrow">Step 4</span>
                <h3>Final test</h3>
              </div>
            </div>
            <p>Ten questions to see what stuck: some to choose, some to work out. About 10 minutes.</p>
          </li>
        </ol>

        <div className="intro-act">
          {/* consent first: Start stays off until it is ticked (the server checks it too) */}
          {saved && !followUp ? (
            <p className="note consent-note">{CONSENT}</p>
          ) : (
            <label className="consent">
              <input type="checkbox" checked={agree} onChange={(e) => setAgree(e.target.checked)} />
              <span>{CONSENT}</span>
            </label>
          )}
          {/* one height in every state (loading, a code to enter, a session to continue), so nothing jumps */}
          <div className="intro-go">
            {saved ? (
              <div className="row">
                {followUp && (
                  <button className="btn primary" disabled={busy || !agree || Date.now() < followUp} onClick={() => void start(saved.token)} title={Date.now() < followUp ? `Opens on ${opensText}` : agree ? undefined : "Tick the box first"}>
                    {busy ? "Starting…" : <>Take the follow-up test <ArrowRight size={17} /></>}
                  </button>
                )}
                <button className={`btn${followUp ? "" : " primary"}`} onClick={() => router.push(saved.phase === "delayed" && saved.step !== "results" ? "/exercises" : STEP_PATH[saved.step])}>
                  {saved.step === "results" ? "See your results" : "Continue where you left off"} {!followUp && <ArrowRight size={17} />}
                </button>
                <button className="btn ghost" onClick={() => save(null)}>
                  <RotateCcw size={15} /> Start over
                </button>
              </div>
            ) : saved === null ? (
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
                <button className="btn primary" type="submit" disabled={busy || !agree || (accessRequired && !code.trim())} title={agree ? undefined : "Tick the box first"}>
                  {busy ? "Starting…" : <>Start <ArrowRight size={17} /></>}
                </button>
              </form>
            ) : null}
            {followUp && Date.now() < followUp && <p className="note">Your follow-up test opens on {opensText}.</p>}
            {info && <p className="info" role="status">{info}</p>}
            {error && <p className="error" role="alert">{error}</p>}
          </div>
        </div>
        </div>
      </main>
    </div>
  );
}
