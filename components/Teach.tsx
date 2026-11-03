"use client";

import { useRouter } from "next/navigation";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { ArrowRight, ArrowUp, BookOpen, Brain, Check, FastForward, Lock, MessageCircle, Play } from "lucide-react";
import { useDictation } from "./Dictation";
import { useStudySettings } from "./SettingsContext";
import { Header, KaiFace, Modal, VideoFrame, VideoThumb, mmss } from "./ui";
import MindView from "./MindView";
import { StepClock, useDeadline } from "./StepClock";
import { Block } from "./lesson/LessonBody";
import type { Passage } from "@/lib/lesson";
import { useGuard, useNext } from "./useGuard";
import { currentStep, pathOf } from "@/lib/flow";
import { post, save, useSaved, type Help, type Mood, type Saved } from "@/lib/client/store";
import { logNotebook, track } from "@/lib/client/log";
import { MESSAGE_MAX as MAX } from "@/engine/tutor/config";
import type { State } from "@/engine/tutor/state";
import type { Mind } from "@/engine/tutor/mind";
import type { GraphView } from "@/lib/server/content";

type Video = { id: string; videoId: string; title: string; part: number; durationSec?: number };
const videoName = (t: string) => t.replace(/^[^:]{2,30}:\s+/, "");
/** When a participant may end teaching early: after this many messages or this long. */
// when a participant may end teaching early (after this many messages or this long) comes from the study settings

type TurnReply = { reply: string; mood: Mood; state: State; progress: number; mind: Mind; done: boolean; help: Help | null; helpAvailable: boolean; demo: boolean };

export default function Teach({ opening, initial, initialMind, videos, graph, questions = 0 }: { opening: string; initial: State; initialMind: Mind; videos: Video[]; graph: GraphView; questions?: number }) {
  const router = useRouter();
  const [saved, update] = useSaved();
  const study = useStudySettings();
  const allowed = useGuard(saved, "teach");
  const nextOf = useNext();
  const { flow } = study;
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<{ msg: string; retry: string | null } | null>(null);
  const [video, setVideo] = useState<{ v: Video; start: number } | null>(null);
  const [passage, setPassage] = useState<Passage | null>(null); // a text lesson's passage, shown again as help
  const [pasteOff, setPasteOff] = useState(false); // a text lesson: pasting into the chat is off (explain it in your own words)
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
  const compose = useRef<{ start: number | null; pasted: number; dictated: number; keys: number; deletes: number }>({ start: null, pasted: 0, dictated: 0, keys: 0, deletes: 0 });
  // voice input: the live transcript shows in the box while the learner speaks; the final one is put in at the caret
  const dict = useDictation({
    where: "teach",
    value: text,
    field: taRef,
    disabled: busy,
    onCommit: (next, caret, n) => {
      if (n && !compose.current.start) compose.current.start = Date.now();
      compose.current.dictated += n;
      setText(next.slice(0, MAX));
      requestAnimationFrame(() => taRef.current?.setSelectionRange(caret, caret));
    },
  });

  // first visit: Kai opens the conversation
  useEffect(() => {
    if (saved && !saved.chat.state)
      update((s) => ({ ...s, chat: { ...s.chat, startedAt: Date.now(), state: initial, mind: initialMind, turns: [{ role: "kai", text: opening, mood: "neutral" }] } }));
  }, [saved, update, initial, initialMind, opening]);

  // once practice has started, the chat (and Kai's mind) stay closed until the results
  const closed = saved?.step === "practice" || saved?.step === "exercises";
  useEffect(() => {
    if (closed && saved) router.replace(pathOf(currentStep(flow, saved.step)));
  }, [closed, saved, router, flow]);

  // the time limit: from Kai's first message. When it runs out (after a reply on its way), Kai wraps up
  const clock = useDeadline(saved?.chat.startedAt, study.limits.teach);
  const timeUpRef = useRef<(() => void) | null>(null);
  // checked after every render: the page may still be loading when the time runs out
  const timedOut = useRef(false);
  useEffect(() => {
    if (!clock.over || busy || timedOut.current || !timeUpRef.current) return;
    timedOut.current = true;
    timeUpRef.current();
  });

  const doneNow = !!saved?.chat.done;
  useEffect(() => {
    if (doneNow) track("teach_ready");
  }, [doneNow]);

  const turns = saved?.chat.turns ?? [];
  useEffect(() => {
    if (view === "chat") endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [turns.length, busy, view]);
  // Kai's mind opens at its top, not at the chat's scroll position
  useLayoutEffect(() => {
    if (view !== "mind") return;
    // instant, and once more a moment later: a smooth scroll to Kai's latest reply may still be running in the chat
    const top = () => window.scrollTo({ top: 0, behavior: "instant" });
    top();
    const t = window.setTimeout(top, 180);
    return () => window.clearTimeout(t);
  }, [view]);

  // the input grows with its text, up to the CSS max height
  useLayoutEffect(() => {
    const ta = taRef.current;
    if (!ta) return;
    ta.style.height = "auto";
    ta.style.height = `${ta.scrollHeight}px`;
  }, [text, view, dict.shown]);

  if (!allowed || !saved || !saved.chat.state || closed) return <div className="center">Loading…</div>;
  const chat = saved.chat;
  const mind = chat.mind ?? initialMind;
  const learnerCount = turns.filter((t) => t.role === "learner" && !t.help).length;
  // participants can stop teaching once they've given it a real go; team sessions (shared code) any time, for testing
  const canStop = saved.team !== false || learnerCount >= study.stopAfterMessages || now - (chat.startedAt ?? saved.startedAt) >= study.stopAfterMinutes * 60_000;
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
    track("message_send", { turn: chat.state.turn + 1, chars: message.length, composeMs, pastedChars: c.pasted, dictatedChars: c.dictated, keys: c.keys, deletes: c.deletes, retry: !!again, elapsedMs });
    compose.current = { start: null, pasted: 0, dictated: 0, keys: 0, deletes: 0 };
    const t0 = Date.now();
    const r = await post<TurnReply>("/api/chat", { token: saved.token, message, history, state: chat.state, elapsedMs, composeMs, pastedChars: c.pasted, dictatedChars: c.dictated });
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
    // ideas this reply finished (Kai has no more questions about them): shown as a small milestone under the reply,
    // with an "aha" face; "proud" when Kai feels ready. The logged mood stays the judge's.
    const doneBefore = new Set((chat.mind?.nodes ?? []).filter((n) => n.status === "explained" || n.status === "checked").map((n) => n.id));
    const learned = d.mind.nodes
      .filter((n) => (n.status === "explained" || n.status === "checked") && !doneBefore.has(n.id) && graph.nodes.find((g) => g.id === n.id)?.inLesson !== false)
      .map((n) => graph.nodes.find((g) => g.id === n.id)?.label ?? n.id);
    if (learned.length) track("idea_done", { ideas: learned });
    const face: Mood = d.done ? "proud" : learned.length ? "aha" : d.mood;
    update((s) => ({
      ...s,
      demo: d.demo,
      chat: {
        ...s.chat,
        turns: [...s.chat.turns, { role: "kai", text: d.reply, mood: face, ...(learned.length ? { learned } : {}) }],
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
    if ("section" in h) {
      // a text lesson: the section about Kai's question, as text that can't be selected
      if (!h.blocks) return;
      setPassage(h);
      track("help_open", { section: h.section, focus: chat.state?.focus ?? null, fromLog: !log });
      if (log) update((s) => ({ ...s, chat: { ...s.chat, turns: [...s.chat.turns, { role: "learner", text: "", help: { section: h.section, title: h.title } }] } }));
      return;
    }
    const v = videos.find((x) => x.id === h.video);
    if (!v) return;
    setVideo({ v, start: h.start });
    track("help_open", { video: h.video, start: h.start, focus: chat.state?.focus ?? null, fromLog: !log });
    if (log) update((s) => ({ ...s, chat: { ...s.chat, turns: [...s.chat.turns, { role: "learner", text: "", help: { part: v.part, start: h.start } }] } }));
  }

  function goPractice() {
    track("teach_continue", { skipped: chat.skipped, done: chat.done, timeUp: !!chat.timeUp, progress: chat.progress });
    logNotebook(chat.done ? "teach_end_ready" : chat.timeUp ? "teach_end_time" : chat.skipped ? "teach_end_stopped" : "teach_end", chat.state);
    const n = nextOf("teach");
    update((s: Saved) => ({ ...s, step: s.step === "teach" ? n.step : s.step }));
    router.push(n.path);
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
        turns: [...s.chat.turns, { role: "kai", text: `Okay, thanks for teaching me! I'll go with what you told me so far. Good luck with the ${flow.includes("practice") ? "practice problems" : "test"}!`, mood: "okay" }],
      },
    }));
  }

  // the time limit ran out: the chat closes with Kai's closing line, whatever was being written
  timeUpRef.current = finished
    ? null
    : () => {
        track("teach_time_up", { progress: chat.progress, turns: learnerCount, question: chat.state?.script ? chat.state.script.at + 1 : null });
        setText("");
        update((s: Saved) => ({
          ...s,
          chat: {
            ...s.chat,
            skipped: true,
            timeUp: true,
            mood: "okay",
            turns: [...s.chat.turns, { role: "kai", text: `That's our time! Thanks for teaching me. I'll go with what I've written down. Good luck with the ${flow.includes("practice") ? "practice problems" : "test"}!`, mood: "okay" }],
          },
        }));
      };

  const pct = Math.round(mind.understanding * 100);
  const tools = study.mind && (
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
        {/* with the fixed questions: which one Kai is on; otherwise the messages left before Kai wraps up */}
        {questions > 0 && chat.state?.script ? (
          <span className="count" title="Kai's questions">
            {finished ? `${Math.min(questions, chat.state.script.at + 1)} of ${questions} questions` : chat.state.script.back ? `Back to question ${chat.state.script.at + 1}` : `Question ${Math.min(questions, chat.state.script.at + 1)} of ${questions}`}
          </span>
        ) : (
          <span className={`count${left <= 5 && !finished ? " low" : ""}`} title="Kai wraps up after this many messages">
            {finished ? `${learnerCount} messages` : `${learnerCount} / ${mind.maxTurns}`}
          </span>
        )}
        <StepClock left={clock.left} over={clock.over || !!chat.timeUp} what="teaching" />
        <button type="button" className="meter" disabled={!study.mind} onClick={() => (setView("mind"), track("view_toggle", { to: "mind", via: "meter" }))} title={study.mind ? `${pct}% of what Kai needs to feel ready. Open Kai's mind to see how it's scored.` : `${pct}% of what Kai needs to feel ready.`} style={{ border: 0, background: "none", cursor: study.mind ? "pointer" : "default", padding: 0, color: "inherit" }}>
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
      <Header step="teach" demo={saved.demo} left={tools} right={status} />
      {view === "mind" && study.mind ? (
        <main className="teach-mind">
          <MindView graph={graph} mind={mind} popout />
        </main>
      ) : (
        <main className="teach">
          <div className="log" aria-live="polite">
            {/* the step's limit, said up front */}
            <p className="note teach-limit">
              You have {study.limits.teach} minutes to teach Kai (the clock is at the top).{" "}
              {questions > 0 ? `Kai has ${questions} questions; teaching ends after the last one, or when the time is up.` : "Teaching ends when Kai feels ready, or when the time is up."}
            </p>
            {turns.map((t, k) =>
              t.help && "section" in t.help ? (
                <p key={k} className="note src-read">
                  <BookOpen size={14} aria-hidden="true" /> You reread “{t.help.title}”.
                </p>
              ) : t.help ? (
                (() => {
                  if (!("part" in t.help!)) return null;
                  const h = t.help;
                  const v = videos.find((x) => x.part === h.part);
                  return (
                    <button key={k} className="src" onClick={() => v && openHelp({ video: v.id, start: h.start, end: h.start }, false)} title="Watch this moment again">
                      {v && <VideoThumb videoId={v.videoId} start={h.start} duration={v.durationSec} width={112} label={mmss(h.start)} />}
                      <span className="meta-t">
                        <small>You opened part {h.part}{v ? `: ${videoName(v.title)}` : ""}</small>
                        <b>
                          <Play size={13} fill="currentColor" strokeWidth={0} /> Rewatch from <em>{mmss(h.start)}</em>
                        </b>
                      </span>
                    </button>
                  );
                })()
              ) : t.role === "kai" ? (
                <div className={`msg${k === turns.length - 1 ? " last" : ""}`} key={k}>
                  <KaiFace mood={t.mood ?? "neutral"} size={36} live={k === turns.length - 1 && !busy} pop={k === turns.length - 1 && k > 0} />
                  <div className="col">
                    <span className="who">Kai</span>
                    <div className="bubble">{t.text}</div>
                    {t.learned && t.learned.length > 0 && (
                      <div className="learned" role="status">
                        {t.learned.map((l) => (
                          <span key={l} className="learned-chip">
                            <span className="spark" aria-hidden="true" />
                            <Check size={13} strokeWidth={3} /> Kai understood: {l}
                          </span>
                        ))}
                      </div>
                    )}
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
                <h2>{chat.done ? "Kai feels ready" : chat.timeUp ? "Time's up" : "Teaching finished"}</h2>
                <p>
                  {chat.done
                    ? `Kai reached ${pct}% understanding. Next, practise on a few problems.`
                    : `You stopped at ${pct}% of what Kai needed. Next, practise on a few problems.`}
                </p>
                <div className="row">
                  <button className="btn primary" onClick={goPractice}>
                    {flow.includes("practice") ? "Go to practice" : "Go to the test"} <ArrowRight size={17} />
                  </button>
                  {study.mind && (
                    <button className="btn ghost" onClick={() => (setView("mind"), track("view_toggle", { to: "mind", via: "ready" }))}>
                      <Brain size={17} /> See Kai&apos;s mind
                    </button>
                  )}
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
                  value={dict.shown}
                  readOnly={dict.active}
                  className={dict.active ? "dictating" : undefined}
                  maxLength={MAX}
                  rows={2}
                  placeholder={learnerCount === 0 ? "Start explaining: what problem are we solving?" : "Explain it to Kai…"}
                  onChange={(e) => {
                    if (dict.active) return;
                    if (!compose.current.start && e.target.value) compose.current.start = Date.now();
                    setText(e.target.value);
                  }}
                  onPaste={(e) => {
                    const n = e.clipboardData.getData("text").length;
                    // with a text lesson, Kai learns from the learner's own words: no pasting (the attempt is logged)
                    if (study.lessonKind === "text") {
                      e.preventDefault();
                      setPasteOff(true);
                      track("paste_blocked", { chars: n });
                      return;
                    }
                    compose.current.pasted += n;
                    track("paste", { chars: n });
                  }}
                  onKeyDown={(e) => {
                    if (e.key === "Backspace" || e.key === "Delete") compose.current.deletes++;
                    else if (e.key.length === 1) compose.current.keys++;
                    if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing && !dict.active) {
                      e.preventDefault();
                      void send();
                    }
                  }}
                  disabled={busy}
                />
                {dict.ghost}
                <div className="actions">
                  {study.help && chat.help && (
                    <button
                      type="button"
                      className="help"
                      disabled={!chat.helpAvailable || busy}
                      onClick={() => chat.help && openHelp(chat.help)}
                      title={chat.helpAvailable ? ("section" in chat.help ? "Read the part of the lesson that covers this" : "Watch the part of the lesson that covers this") : "Opens once you've had a go at answering"}
                    >
                      {!chat.helpAvailable ? <Lock size={13} strokeWidth={2.4} /> : "section" in chat.help ? <BookOpen size={13} strokeWidth={2.4} /> : <Play size={13} fill="currentColor" strokeWidth={0} />}
                      {!chat.helpAvailable ? "Where is this covered?" : "section" in chat.help ? "Reread this part" : `Rewatch ${mmss(chat.help.start)}`}
                    </button>
                  )}
                  <span className="grow" />
                  {pasteOff && <span className="hint">Pasting is off: say it in your own words.</span>}
                  {text.length > MAX - 150 && <span className="hint">{MAX - text.length} left</span>}
                  {dict.button}
                  <button className="send" type="submit" disabled={busy || dict.active || !text.trim()} aria-label="Send" title="Send (Enter)">
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
        <Modal title={`${video.v.title.replace(/^[^:]{2,30}:\s+/, "")} at ${mmss(video.start)}`} onClose={() => setVideo(null)}>
          <VideoFrame videoId={video.v.videoId} title={video.v.title} start={video.start} autoplay />
        </Modal>
      )}
      {passage?.blocks && (
        <Modal title={passage.title} onClose={() => (track("help_close", { section: passage.section }), setPassage(null))}>
          <div className="passage" onCopy={(e) => (e.preventDefault(), track("read_copy_attempt", { kind: "copy", where: "help" }))} onCut={(e) => e.preventDefault()}>
            {passage.blocks.map((b, i) => (
              <Block key={i} b={b} />
            ))}
          </div>
        </Modal>
      )}
    </div>
  );
}
