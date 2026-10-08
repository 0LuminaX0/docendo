"use client";

import { useRouter } from "next/navigation";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { ArrowRight, ArrowUp, Brain, FastForward, Lock, MessageCircle, Play } from "lucide-react";
import { Header, KaiFace, Modal, VideoFrame, VideoThumb, mmss } from "./ui";
import MindView from "./MindView";
import { useGuard } from "./useGuard";
import { post, save, useSaved, type Help, type Mood, type Saved } from "@/lib/client/store";
import { logNotebook, track } from "@/lib/client/log";
import { MESSAGE_MAX as MAX, type State } from "@/engine/tutor/state";
import type { Mind } from "@/engine/tutor/mind";
import type { GraphView } from "@/lib/server/content";

type Video = { id: string; videoId: string; title: string; part: number; durationSec?: number };
const videoName = (t: string) => t.replace(/^[^:]{2,30}:\s+/, "");
/** When a participant may end teaching early: after this many messages or this long. */
const STOP_AFTER = { messages: 12, ms: 8 * 60_000 };

type TurnReply = { reply: string; mood: Mood; state: State; progress: number; mind: Mind; done: boolean; help: Help | null; helpAvailable: boolean; demo: boolean };

export default function Teach({ opening, initial, initialMind, videos, graph }: { opening: string; initial: State; initialMind: Mind; videos: Video[]; graph: GraphView }) {
  const router = useRouter();
  const [saved, update] = useSaved();
  const allowed = useGuard(saved, "teach");
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<{ msg: string; retry: string | null } | null>(null);
  const [video, setVideo] = useState<{ v: Video; start: number } | null>(null);
  const [confirmSkip, setConfirmSkip] = useState(false);
  const [view, setView] = useState<"chat" | "mind">("chat");
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(t);
  }, []);
  const endRef = useRef<HTMLDivElement>(null);
  const taRef = useRef<HTMLTextAreaElement>(null);
  // for the research log: how each message was written
  const compose = useRef<{ start: number | null; pasted: number; keys: number; deletes: number }>({ start: null, pasted: 0, keys: 0, deletes: 0 });

  // first visit: Kai opens the conversation
  useEffect(() => {
    if (saved && !saved.chat.state)
      update((s) => ({ ...s, chat: { ...s.chat, startedAt: Date.now(), state: initial, mind: initialMind, turns: [{ role: "kai", text: opening, mood: "neutral" }] } }));
  }, [saved, update, initial, initialMind, opening]);

  // once practice has started, the chat (and Kai's mind) stay closed until the results
  const closed = saved?.step === "practice" || saved?.step === "exercises";
  useEffect(() => {
    if (closed) router.replace(saved?.step === "practice" ? "/practice" : "/exercises");
  }, [closed, saved?.step, router]);

  const doneNow = !!saved?.chat.done;
  useEffect(() => {
    if (doneNow) track("teach_ready");
  }, [doneNow]);

  const turns = saved?.chat.turns ?? [];
  useEffect(() => {
    if (view === "chat") endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [turns.length, busy, view]);

  // the input grows with its text, up to the CSS max height
  useLayoutEffect(() => {
    const ta = taRef.current;
    if (!ta) return;
    ta.style.height = "auto";
    ta.style.height = `${ta.scrollHeight}px`;
  }, [text, view]);

  if (!allowed || !saved || !saved.chat.state || closed) return <div className="center">Loading…</div>;
  const chat = saved.chat;
  const mind = chat.mind ?? initialMind;
  const learnerCount = turns.filter((t) => t.role === "learner" && !t.help).length;
  // participants can stop teaching once they've given it a real go; team sessions (shared code) any time, for testing
  const canStop = saved.team !== false || learnerCount >= STOP_AFTER.messages || now - (chat.startedAt ?? saved.startedAt) >= STOP_AFTER.ms;
  const finished = chat.done || chat.skipped;
  const left = mind.maxTurns - learnerCount;

  async function send(again?: string) {
    const message = (again ?? text).trim();
    if (!message || busy || !saved || !chat.state) return;
    setBusy(true);
    setError(null);
    const history = turns.filter((t) => !t.help).map(({ role, text }) => ({ role, text }));
    update((s) => ({ ...s, chat: { ...s.chat, turns: [...s.chat.turns, { role: "learner", text: message }] } }));
    setText("");
    const c = compose.current;
    const composeMs = c.start ? Date.now() - c.start : 0;
    const elapsedMs = Math.max(0, Date.now() - (chat.startedAt ?? saved.startedAt));
    track("message_send", { turn: chat.state.turn + 1, chars: message.length, composeMs, pastedChars: c.pasted, keys: c.keys, deletes: c.deletes, retry: !!again, elapsedMs });
    compose.current = { start: null, pasted: 0, keys: 0, deletes: 0 };
    const t0 = Date.now();
    const r = await post<TurnReply>("/api/chat", { token: saved.token, message, history, state: chat.state, elapsedMs, composeMs, pastedChars: c.pasted });
    track("reply_received", { ok: r.ok, waitMs: Date.now() - t0, status: r.ok ? 200 : r.status });
    setBusy(false);
    if (!r.ok) {
      // take the message back out so nothing is lost or duplicated
      update((s) => ({ ...s, chat: { ...s.chat, turns: s.chat.turns.slice(0, -1) } }));
      if (r.expired) {
        save(null);
        router.replace("/");
        return;
      }
      setText(message);
      setError({ msg: r.error, retry: r.status === 0 || r.status >= 500 || r.status === 429 ? message : null });
      return;
    }
    const d = r.data;
    update((s) => ({
      ...s,
      demo: d.demo,
      chat: {
        ...s.chat,
        turns: [...s.chat.turns, { role: "kai", text: d.reply, mood: d.mood }],
        state: d.state,
        progress: d.progress,
        mind: d.mind,
        done: d.done,
        mood: d.mood,
        help: d.help,
        helpAvailable: d.helpAvailable,
      },
    }));
    setTimeout(() => taRef.current?.focus(), 0);
  }

  function openHelp(h: Help, log = true) {
    const v = videos.find((x) => x.id === h.video);
    if (!v) return;
    setVideo({ v, start: h.start });
    track("help_open", { video: h.video, start: h.start, focus: chat.state?.focus ?? null, fromLog: !log });
    if (log) update((s) => ({ ...s, chat: { ...s.chat, turns: [...s.chat.turns, { role: "learner", text: "", help: { part: v.part, start: h.start } }] } }));
  }

  function goPractice() {
    track("teach_continue", { skipped: chat.skipped, done: chat.done, progress: chat.progress });
    logNotebook(chat.done ? "teach_end_ready" : chat.skipped ? "teach_end_stopped" : "teach_end", chat.state);
    update((s: Saved) => ({ ...s, step: s.step === "teach" ? "practice" : s.step }));
    router.push("/practice");
  }

  // "I've taught all I can": end the chat here with a closing line from Kai; the learner moves on when ready
  function stopTeaching() {
    setConfirmSkip(false);
    track("skip_confirm", { progress: chat.progress, turns: learnerCount });
    update((s: Saved) => ({
      ...s,
      chat: {
        ...s.chat,
        skipped: true,
        mood: "okay",
        turns: [...s.chat.turns, { role: "kai", text: "Okay, thanks for teaching me! I'll go with what you told me so far. Good luck with the practice problems!", mood: "okay" }],
      },
    }));
  }

  const pct = Math.round(mind.understanding * 100);
  const tools = (
    <div className="seg" role="group" aria-label="View">
        <button type="button" aria-pressed={view === "chat"} onClick={() => (setView("chat"), track("view_toggle", { to: "chat" }))} aria-label="Chat">
          <MessageCircle size={16} strokeWidth={2.2} />
          <span className="lbl">Chat</span>
        </button>
        <button type="button" aria-pressed={view === "mind"} onClick={() => (setView("mind"), track("view_toggle", { to: "mind" }))} aria-label="Kai's mind">
          <Brain size={16} strokeWidth={2.2} />
          <span className="lbl">Kai&apos;s mind</span>
        </button>
    </div>
  );
  const status = (
      <div className="row" style={{ gap: 14, flexWrap: "nowrap" }}>
        <span className={`count${left <= 5 && !finished ? " low" : ""}`} title="Kai wraps up after this many messages">
          {finished ? `${learnerCount} messages` : `${learnerCount} / ${mind.maxTurns}`}
        </span>
        <button type="button" className="meter" onClick={() => (setView("mind"), track("view_toggle", { to: "mind", via: "meter" }))} title={`${pct}% of what Kai needs to feel ready. Open Kai's mind to see how it's scored.`} style={{ border: 0, background: "none", cursor: "pointer", padding: 0 }}>
          <span>Kai&apos;s understanding</span>
          <span className="track" role="progressbar" aria-label="Kai's understanding" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct}>
            <span className="fill" style={{ display: "block", width: `${Math.max(4, pct)}%` }} />
          </span>
          <b style={{ fontVariantNumeric: "tabular-nums", color: "var(--ink-2)" }}>{pct}%</b>
        </button>
      </div>
  );

  return (
    <div className="shell">
      <Header phase={2} demo={saved.demo} left={tools} right={status} />
      {view === "mind" ? (
        <main className="teach-mind">
          <MindView graph={graph} mind={mind} popout />
        </main>
      ) : (
        <main className="teach">
          <div className="log" aria-live="polite">
            {turns.map((t, k) =>
              t.help ? (
                (() => {
                  const v = videos.find((x) => x.part === t.help!.part);
                  return (
                    <button key={k} className="src" onClick={() => v && openHelp({ video: v.id, start: t.help!.start, end: t.help!.start }, false)} title="Watch this moment again">
                      {v && <VideoThumb videoId={v.videoId} start={t.help.start} duration={v.durationSec} width={112} label={mmss(t.help.start)} />}
                      <span className="meta-t">
                        <small>You opened part {t.help.part}{v ? `: ${videoName(v.title)}` : ""}</small>
                        <b>
                          <Play size={13} fill="currentColor" strokeWidth={0} /> Rewatch from <em>{mmss(t.help.start)}</em>
                        </b>
                      </span>
                    </button>
                  );
                })()
              ) : t.role === "kai" ? (
                <div className={`msg${k === turns.length - 1 ? " last" : ""}`} key={k}>
                  <KaiFace mood={t.mood ?? "neutral"} size={36} />
                  <div className="col">
                    <span className="who">Kai</span>
                    <div className="bubble">{t.text}</div>
                  </div>
                </div>
              ) : (
                <div className="msg you" key={k}>
                  <div className="bubble">{t.text}</div>
                </div>
              ),
            )}
            {busy && (
              <div className="msg">
                <KaiFace mood="thinking" size={36} />
                <div className="think" style={{ paddingLeft: 0 }}>
                  <span className="levers" aria-hidden="true"><i /><i /><i /></span>Kai is thinking about your answer
                </div>
              </div>
            )}
            {finished && (
              <div className="ready">
                <h2>{chat.done ? "Kai feels ready" : "Teaching finished"}</h2>
                <p>
                  {chat.done
                    ? `Kai reached ${pct}% understanding. Next, practise on a few problems.`
                    : `You stopped at ${pct}% of what Kai needed. Next, practise on a few problems.`}
                </p>
                <div className="row">
                  <button className="btn primary" onClick={goPractice}>
                    Go to practice <ArrowRight size={17} />
                  </button>
                  <button className="btn ghost" onClick={() => (setView("mind"), track("view_toggle", { to: "mind", via: "ready" }))}>
                    <Brain size={17} /> See Kai&apos;s mind
                  </button>
                </div>
              </div>
            )}
            <div ref={endRef} style={{ scrollMarginBottom: finished ? 24 : 190 }} />
          </div>

          {!finished && (
            <div className="composer">
              {error && (
                <div className="error row" role="alert" style={{ marginBottom: 8, justifyContent: "space-between" }}>
                  <span>{error.msg}</span>
                  {error.retry && (
                    <button className="btn small" onClick={() => void send(error.retry!)} disabled={busy}>Send again</button>
                  )}
                </div>
              )}
              <form
                className="box"
                onSubmit={(e) => {
                  e.preventDefault();
                  void send();
                }}
              >
                <label htmlFor="msg" className="sr-only">Your explanation</label>
                <textarea
                  id="msg"
                  ref={taRef}
                  value={text}
                  maxLength={MAX}
                  rows={2}
                  placeholder={learnerCount === 0 ? "Start explaining: what problem are we solving?" : "Explain it to Kai…"}
                  onChange={(e) => {
                    if (!compose.current.start && e.target.value) compose.current.start = Date.now();
                    setText(e.target.value);
                  }}
                  onPaste={(e) => {
                    const n = e.clipboardData.getData("text").length;
                    compose.current.pasted += n;
                    track("paste", { chars: n });
                  }}
                  onKeyDown={(e) => {
                    if (e.key === "Backspace" || e.key === "Delete") compose.current.deletes++;
                    else if (e.key.length === 1) compose.current.keys++;
                    if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                      e.preventDefault();
                      void send();
                    }
                  }}
                  disabled={busy}
                />
                <div className="actions">
                  {chat.help && (
                    <button
                      type="button"
                      className="help"
                      disabled={!chat.helpAvailable || busy}
                      onClick={() => chat.help && openHelp(chat.help)}
                      title={chat.helpAvailable ? "Watch the part of the lesson that covers this" : "Opens once you've had a go at answering"}
                    >
                      {chat.helpAvailable ? <Play size={13} fill="currentColor" strokeWidth={0} /> : <Lock size={13} strokeWidth={2.4} />}
                      {chat.helpAvailable ? `Rewatch ${mmss(chat.help.start)}` : "Where is this covered?"}
                    </button>
                  )}
                  <span className="grow" />
                  {text.length > MAX - 150 && <span className="hint">{MAX - text.length} left</span>}
                  <button className="send" type="submit" disabled={busy || !text.trim()} aria-label="Send" title="Send (Enter)">
                    <ArrowUp size={20} strokeWidth={2.4} />
                  </button>
                </div>
              </form>
              <div className="composer-foot">
                {confirmSkip ? (
                  <div className="row" style={{ justifyContent: "center", gap: 8 }}>
                    <span className="note">Kai is at {pct}%. Stop teaching here?</span>
                    <button className="btn small" onClick={stopTeaching}>
                      Stop here <ArrowRight size={15} />
                    </button>
                    <button className="btn ghost small" onClick={() => (setConfirmSkip(false), track("skip_cancel"))}>Keep teaching</button>
                  </div>
                ) : !canStop ? null : (
                  <button className="btn ghost small skip" onClick={() => (setConfirmSkip(true), track("skip_open", { progress: chat.progress }))} disabled={busy}>
                    <FastForward size={15} /> I&apos;ve taught all I can
                  </button>
                )}
              </div>
            </div>
          )}
        </main>
      )}

      {video && (
        <Modal title={`Part ${video.v.part} at ${mmss(video.start)}`} onClose={() => setVideo(null)}>
          <VideoFrame videoId={video.v.videoId} title={video.v.title} start={video.start} autoplay />
        </Modal>
      )}
    </div>
  );
}
