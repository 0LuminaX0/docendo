"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { ArrowRight, ListChecks, MessagesSquare, PencilLine, Play, RotateCcw } from "lucide-react";
import { Header, KaiFace } from "./ui";
import { newSession, post, save, useSaved } from "@/lib/client/store";
import { useStudySettings } from "./SettingsContext";
import { count } from "@/lib/words";
import { barsOf, blockOf, currentStep, firstStep, pathOf } from "@/lib/flow";

const CARD_ICON = { teach: MessagesSquare, practice: PencilLine, exercises: ListChecks } as const;

const CONSENT =
  "I understand this is a study: what I write, my answers and how I use the app (clicks, timings, video playback) are recorded under a random session id, without my name. What I write to Kai is sent to an AI model to generate its replies, so I won't include personal details.";

type Started = { token: string; expiresAt: number; demo: boolean; team: boolean; condition: "direct" | "recursive"; phase?: "main" | "delayed" };

export default function Intro({
  accessRequired,
  demo,
  cards,
  totalMinutes,
  pretestItems,
  followUpOn,
}: {
  accessRequired: boolean;
  demo: boolean;
  cards: Record<"watch" | "teach" | "practice" | "exercises", string>; // what each step's card says (app/page.tsx)
  totalMinutes: number;
  pretestItems: number; // questions before the first step (0: none)
  followUpOn: boolean; // the study has a follow-up test (Study setup)
}) {
  const router = useRouter();
  const { flow, copy } = useStudySettings();
  const bars = barsOf(flow);
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
      const first = firstStep(flow);
      save({ ...s, step: first });
      router.push(pathOf(first));
    }
  }

  // a finished session on this device with a follow-up test (the server said so when it graded the final test). The
  // server decides whether it is open (the admin panel can open it early), so the button is always there; the date is
  // only shown as a hint
  const followUp = followUpOn && saved && saved.step === "results" && saved.phase !== "delayed" && saved.result?.followUp ? saved.result.followUp.opensAt : null;
  const opensText = followUp ? new Date(followUp).toLocaleDateString(undefined, { weekday: "long", day: "numeric", month: "long" }) : "";

  return (
    <div className="shell">
      <Header demo={demo} />
      <main className="page intro">
        <div className="intro-head">
          {copy.studyLine && <span className="eyebrow">{copy.studyLine}</span>}
          <h1 className="title">{copy.headline}</h1>
          <p className="lede">
            {flow.includes("watch") ? "You'll watch a short lesson, then explain it to Kai, a classmate who missed the lecture." : "You'll explain a topic to Kai, a classmate who missed the lecture."} Kai only knows what you tell it, so the better you explain, the more it understands. About {totalMinutes} minutes in all
            {pretestItems ? `, starting with ${count(pretestItems, "quick question")}` : ""}.
          </p>
        </div>

        <div className="intro-mid">
          <div className="hero-kai">
            <KaiFace mood="great" size={48} />
            <div className="col" style={{ display: "flex", flexDirection: "column", gap: 4 }}>
              <span className="who">Kai</span>
              <div className="bubble">{copy.kaiHello}</div>
            </div>
          </div>
        </div>

        <div className="intro-foot">
        <ol className="steps" style={{ ["--n" as string]: bars.length }}>
          {bars.map((k, i) => {
            const Icon = CARD_ICON[k as keyof typeof CARD_ICON] ?? ListChecks;
            return (
              <li key={k} className={`card-${k}`}>
                <div className="step-top">
                  <span className="ico">{k === "watch" ? <Play size={19} fill="currentColor" strokeWidth={0} /> : <Icon size={19} strokeWidth={2.2} />}</span>
                  <div>
                    <span className="eyebrow">Step {i + 1}</span>
                    <h3>{blockOf(k).name}</h3>
                  </div>
                </div>
                <p>{cards[k as keyof typeof cards]}</p>
              </li>
            );
          })}
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
                  <button className="btn primary" disabled={busy || !agree} onClick={() => void start(saved.token)} title={agree ? undefined : "Tick the box first"}>
                    {busy ? "Starting…" : <>Take the follow-up test <ArrowRight size={17} /></>}
                  </button>
                )}
                <button className={`btn${followUp ? "" : " primary"}`} onClick={() => router.push(saved.phase === "delayed" && saved.step !== "results" ? "/exercises" : pathOf(currentStep(flow, saved.step)))}>
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
            {followUp && Date.now() < followUp && !info && <p className="note">Your follow-up test is scheduled for {opensText}.</p>}
            {info && <p className="info" role="status">{info}</p>}
            {error && <p className="error" role="alert">{error}</p>}
          </div>
        </div>
        </div>
      </main>
    </div>
  );
}
