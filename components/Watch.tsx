"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { ArrowRight, CircleCheck, Play } from "lucide-react";
import { Header, VideoFrame, mmss } from "./ui";
import { useGuard } from "./useGuard";
import { useSaved } from "@/lib/client/store";
import { track } from "@/lib/client/log";

export type Segment = { video: string; videoId: string; start: number; end: number; title: string; channel: string };

// Minimal typing for the YouTube IFrame API we use.
type YTPlayer = {
  loadVideoById(o: { videoId: string; startSeconds: number; endSeconds: number }): void;
  cueVideoById(o: { videoId: string; startSeconds: number; endSeconds: number }): void;
  getCurrentTime(): number;
  getPlaybackRate(): number;
  destroy(): void;
};
type YTNamespace = { Player: new (el: HTMLElement, o: Record<string, unknown>) => YTPlayer };
declare global {
  interface Window {
    YT?: YTNamespace;
    onYouTubeIframeAPIReady?: () => void;
  }
}

let apiPromise: Promise<YTNamespace> | null = null;
function loadYouTubeApi(): Promise<YTNamespace> {
  if (window.YT?.Player) return Promise.resolve(window.YT);
  apiPromise ??= new Promise<YTNamespace>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error("timeout")), 8000);
    window.onYouTubeIframeAPIReady = () => {
      clearTimeout(t);
      resolve(window.YT!);
    };
    const s = document.createElement("script");
    s.src = "https://www.youtube.com/iframe_api";
    s.onerror = () => reject(new Error("blocked"));
    document.head.appendChild(s);
  });
  return apiPromise;
}

const PLAYING = 1;
const ENDED = 0;

/**
 * Step 1: the lesson, played as one video. The lesson is a list of segments
 * (parts of one or more YouTube videos, topic.yaml `lesson.segments`) played back
 * to back in a single player. Watched seconds per segment are kept for the
 * learner's progress and for the research log.
 */
export default function Watch({ segments }: { segments: Segment[] }) {
  const router = useRouter();
  const [saved, update] = useSaved();
  const allowed = useGuard(saved, "watch");
  const [i, setI] = useState(0);
  const [mode, setMode] = useState<"loading" | "api" | "fallback">("loading");
  const [confirm, setConfirm] = useState(false);
  const host = useRef<HTMLDivElement>(null);
  const player = useRef<YTPlayer | null>(null);
  const seg = useRef(0);
  const clock = useRef<{ t: number; at: number; playing: boolean }>({ t: 0, at: 0, playing: false });
  const [watched, setWatched] = useState<number[]>(() => segments.map(() => 0));

  const total = segments.reduce((a, s) => a + (s.end - s.start), 0);
  const len = (k: number) => segments[k]!.end - segments[k]!.start;
  const done = (k: number) => watched[k]! >= len(k) * 0.9;

  // restore watched seconds from earlier visits
  const restored = useRef(false);
  useEffect(() => {
    if (!saved || restored.current) return;
    restored.current = true;
    const w = saved.watchedSec;
    if (w && w.length === segments.length) setWatched(w);
  }, [saved, segments.length]);

  const persist = useCallback((w: number[]) => update((s) => ({ ...s, watchedSec: w })), [update]);

  // count playing time inside the current segment; report jumps as seeks
  const tick = useCallback(() => {
    const p = player.current;
    const c = clock.current;
    if (!p || !c.playing) return;
    const now = Date.now();
    const t = p.getCurrentTime();
    const expected = c.t + ((now - c.at) / 1000) * (p.getPlaybackRate() || 1);
    if (Math.abs(t - expected) > 2.5) track("video_seek", { seg: seg.current, from: Math.round(c.t), to: Math.round(t) });
    else {
      const s = segments[seg.current]!;
      const dt = Math.max(0, Math.min(t, s.end) - Math.max(c.t, s.start));
      if (dt > 0)
        setWatched((w) => {
          const n = [...w];
          n[seg.current] = Math.min(len(seg.current), n[seg.current]! + dt);
          return n;
        });
    }
    clock.current = { t, at: now, playing: true };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [segments]);

  useEffect(() => {
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [tick]);

  // save progress every few seconds of change
  useEffect(() => {
    const id = setTimeout(() => persist(watched), 1500);
    return () => clearTimeout(id);
  }, [watched, persist]);

  const loadSegment = useCallback(
    (k: number, autoplay: boolean) => {
      const s = segments[k]!;
      seg.current = k;
      setI(k);
      clock.current = { t: s.start, at: Date.now(), playing: false };
      const o = { videoId: s.videoId, startSeconds: s.start, endSeconds: s.end };
      if (player.current) (autoplay ? player.current.loadVideoById(o) : player.current.cueVideoById(o));
    },
    [segments],
  );

  // create the player once the page (and the API) is ready
  useEffect(() => {
    if (!allowed || !host.current || player.current) return;
    let cancelled = false;
    loadYouTubeApi()
      .then((YT) => {
        if (cancelled || !host.current) return;
        const s = segments[0]!;
        // YouTube replaces the element it gets with an iframe, so give it one React doesn't own
        const el = document.createElement("div");
        host.current.replaceChildren(el);
        player.current = new YT.Player(el, {
          host: "https://www.youtube-nocookie.com",
          videoId: s.videoId,
          playerVars: { start: Math.floor(s.start), end: Math.ceil(s.end), rel: 0, modestbranding: 1, hl: "en", cc_lang_pref: "en", playsinline: 1 },
          events: {
            onReady: () => {
              setMode("api");
              track("video_ready", { segments: segments.length, totalSec: total });
            },
            onStateChange: (e: { data: number }) => {
              const p = player.current!;
              const k = seg.current;
              if (e.data === PLAYING) {
                clock.current = { t: p.getCurrentTime(), at: Date.now(), playing: true };
                track("video_play", { seg: k, pos: Math.round(p.getCurrentTime()) });
              } else if (clock.current.playing) {
                tick();
                clock.current.playing = false;
                if (e.data === ENDED) {
                  track("video_segment_end", { seg: k });
                  if (k + 1 < segments.length) loadSegment(k + 1, true);
                  else track("video_lesson_end");
                } else track("video_pause", { seg: k, pos: Math.round(p.getCurrentTime()), state: e.data });
              }
            },
            onPlaybackRateChange: (e: { data: number }) => track("video_rate", { seg: seg.current, rate: e.data }),
            onError: (e: { data: number }) => track("video_error", { seg: seg.current, code: e.data }),
          },
        });
      })
      .catch((e: Error) => {
        if (cancelled) return;
        setMode("fallback");
        track("video_fallback", { reason: e.message });
      });
    return () => {
      cancelled = true;
    };
  }, [allowed, segments, loadSegment, tick, total]);

  useEffect(() => () => player.current?.destroy(), []);

  if (!allowed || !saved) return <div className="center">Loading…</div>;

  const watchedTotal = watched.reduce((a, b) => a + b, 0);
  const allDone = segments.every((_, k) => done(k));

  function next() {
    track("watch_continue", { watchedSec: watched.map(Math.round), watchedTotal: Math.round(watchedTotal), totalSec: total, allWatched: allDone, mode });
    persist(watched);
    update((s) => ({ ...s, watched: segments.map((_, k) => `s${k}`).filter((_, k) => done(k)), step: s.step === "watch" ? "teach" : s.step }));
    router.push("/teach");
  }

  const s = segments[i]!;
  return (
    <div className="shell">
      <Header phase={1} demo={saved.demo} />
      <main className="page">
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <span className="eyebrow">Step 1 of 4</span>
          <h1 className="title" style={{ fontSize: "clamp(26px, 4vw, 36px)" }}>{s.title}</h1>
          <p className="note">
            Part {i + 1} of {segments.length}, by {s.channel}. The whole lesson is {mmss(total)}.
          </p>
        </div>
        <div className="watch">
          <div style={{ display: "flex", flexDirection: "column", gap: 12, minWidth: 0 }}>
            {mode === "fallback" ? (
              <VideoFrame key={`${s.videoId}-${s.start}`} videoId={s.videoId} title={s.title} start={s.start} end={s.end} />
            ) : (
              <div className="frame" ref={host} />
            )}
            {/* the lesson's timeline: one bar per part, filled as it is watched */}
            <div className="lessonbar" aria-label={`Watched ${mmss(watchedTotal)} of ${mmss(total)}`}>
              {segments.map((x, k) => (
                <button
                  key={k}
                  className={`lb-part${k === i ? " now" : ""}`}
                  style={{ flexGrow: len(k) }}
                  onClick={() => (track("video_select", { seg: k }), mode === "api" ? loadSegment(k, true) : setI(k))}
                  title={`Part ${k + 1}: ${x.title} (${mmss(len(k))})`}
                >
                  <span style={{ width: `${Math.min(100, (watched[k]! / len(k)) * 100)}%` }} />
                </button>
              ))}
            </div>
            <p className="note">
              {mmss(watchedTotal)} of {mmss(total)} watched.{mode === "api" ? " The parts play one after another." : ""}
            </p>
          </div>
          <aside className="aside">
            <nav className="playlist" aria-label="Lesson parts">
              <span className="eyebrow">
                The lesson: {segments.length} parts, {mmss(total)}
              </span>
              {segments.map((x, k) => (
                <button key={k} className="pl-item chapter" aria-current={k === i} onClick={() => (track("video_select", { seg: k }), mode === "api" ? loadSegment(k, true) : setI(k))}>
                  <span className="ch-n">{done(k) ? <CircleCheck size={18} strokeWidth={2.4} /> : k === i ? <Play size={14} fill="currentColor" strokeWidth={0} /> : k + 1}</span>
                  <span style={{ minWidth: 0 }}>
                    <span className="t">{x.title}</span>
                    <span className="m">
                      {mmss(len(k))}, {x.channel}
                    </span>
                  </span>
                </button>
              ))}
            </nav>
            <h2>While you watch</h2>
            <p>Afterwards you&apos;ll explain this to Kai, a classmate who missed it. Kai only knows what you tell it.</p>
            <p>Pay attention to how greedy, ε-greedy and UCB each decide which option to try next, and why greedy can get stuck.</p>
            <p>The video won&apos;t be open while you teach, but Kai&apos;s help button can show you the right moment again once you&apos;ve had a go.</p>
            {confirm && !allDone ? (
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                <p className="note">You&apos;ve watched {mmss(watchedTotal)} of {mmss(total)}. Continue anyway?</p>
                <div className="row">
                  <button className="btn primary small" onClick={next}>
                    Teach Kai <ArrowRight size={15} />
                  </button>
                  <button className="btn ghost small" onClick={() => setConfirm(false)}>Keep watching</button>
                </div>
              </div>
            ) : (
              <button className="btn primary" onClick={() => (allDone ? next() : (setConfirm(true), track("watch_continue_early", { watchedTotal: Math.round(watchedTotal) })))}>
                I&apos;ve watched it, teach Kai <ArrowRight size={17} />
              </button>
            )}
          </aside>
        </div>
      </main>
    </div>
  );
}
