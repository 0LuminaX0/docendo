"use client";

import Link from "next/link";
import { useEffect, useRef } from "react";
import { FlaskConical, Play, X } from "lucide-react";
import type { Mood } from "@/lib/client/store";

const PHASES = ["Watch", "Teach Kai", "Practice", "Test"] as const;

/** One header row: brand, optional page tools (left), the step indicator (centre), status and demo badge (right). */
export function Header({ phase, right, demo, label, left }: { phase: 0 | 1 | 2 | 3 | 4; right?: React.ReactNode; demo?: boolean; label?: string; left?: React.ReactNode }) {
  return (
    <div className="topwrap">
    <header className={`top${left ? " has-tools" : ""}`}>
      <div className="top-start">
        <Link href="/" className="brand">docendo</Link>
        {left}
      </div>
      {phase > 0 && (
        <div className="phase" aria-label={`Step ${phase} of ${PHASES.length}: ${PHASES[phase - 1]}`}>
          <div className="arms" aria-hidden="true">
            {PHASES.map((_, i) => (
              <i key={i} className={i < phase ? `on${i + 1}` : ""} />
            ))}
          </div>
          <span className="phase-name">
            {label ?? PHASES[phase - 1]}{!label && <span className="of">Step {phase} of {PHASES.length}</span>}
          </span>
        </div>
      )}
      <div className="top-right">
        {right}
        {demo && <span className="demo" title="No AI model is connected, so Kai uses simple scripted replies."><FlaskConical size={13} strokeWidth={2.2} />Demo<span className="long"> mode</span></span>}
      </div>
    </header>
    </div>
  );
}

const INK = "#1B1F27";
export const MOOD_LABEL: Record<Mood, string> = {
  neutral: "Kai is listening",
  great: "Kai loved that answer",
  okay: "Kai partly gets it",
  confused: "Kai is confused",
  thinking: "Kai is thinking",
};

/**
 * Kai's face, one flat style for every mood. great: 2+ new facts or a whole idea explained; okay: one new,
 * partly explained or already-known fact; confused: no lesson fact, a wrong one or "not sure";
 * neutral: listening; thinking: waiting for a reply.
 */
export function KaiFace({ mood = "neutral", size = 32 }: { mood?: Mood | string; size?: number }) {
  const m = (mood in MOOD_LABEL ? mood : "neutral") as Mood;
  const stroke = { stroke: INK, strokeWidth: 2.2, fill: "none", strokeLinecap: "round" as const, strokeLinejoin: "round" as const };
  return (
    <svg className={`face face-${m}`} width={size} height={size} viewBox="0 0 40 40" role="img" aria-label={MOOD_LABEL[m]}>
      <title>{MOOD_LABEL[m]}</title>
      <circle cx="20" cy="20" r="20" fill="#F7B32B" />
      {m === "great" && (
        <>
          <path d="M10.5 18 Q14 13.5 17.5 18" {...stroke} />
          <path d="M22.5 18 Q26 13.5 29.5 18" {...stroke} />
          <path d="M12.5 24 Q20 32.5 27.5 24" {...stroke} />
        </>
      )}
      {m === "okay" && (
        <>
          <circle cx="14" cy="17" r="2.4" fill={INK} />
          <circle cx="26" cy="17" r="2.4" fill={INK} />
          <path d="M23 11.5 L29 12.5" {...stroke} strokeWidth={1.8} />
          <path d="M15 26 Q20.5 28.5 25.5 25" {...stroke} />
        </>
      )}
      {m === "confused" && (
        <>
          <circle cx="14" cy="18" r="2.4" fill={INK} />
          <circle cx="26" cy="17" r="3" fill="none" stroke={INK} strokeWidth="2" />
          <circle cx="26" cy="17" r="1.1" fill={INK} />
          <path d="M10.5 12.5 L17 13.5" {...stroke} strokeWidth={1.8} />
          <path d="M22.5 11.5 Q26 8.5 29.5 11" {...stroke} strokeWidth={1.8} />
          <path d="M13 28 Q15.5 25.5 18 28 T23 28 T27.5 27" {...stroke} strokeWidth={2} />
        </>
      )}
      {m === "thinking" && (
        <>
          <circle cx="16" cy="15.5" r="2.4" fill={INK} />
          <circle cx="28" cy="15.5" r="2.4" fill={INK} />
          <circle cx="21" cy="27" r="2.2" fill="none" stroke={INK} strokeWidth="2" />
        </>
      )}
      {m === "neutral" && (
        <>
          <circle cx="14" cy="17" r="2.4" fill={INK} />
          <circle cx="26" cy="17" r="2.4" fill={INK} />
          <path d="M14 25.5 Q20 29.5 26 25.5" {...stroke} />
        </>
      )}
    </svg>
  );
}

/** YouTube's privacy-enhanced player; `start` in seconds. */
export function VideoFrame({ videoId, title, start = 0, end, autoplay = false }: { videoId: string; title: string; start?: number; end?: number; autoplay?: boolean }) {
  const src = `https://www.youtube-nocookie.com/embed/${encodeURIComponent(videoId)}?rel=0&modestbranding=1&hl=en&cc_lang_pref=en&start=${Math.floor(start)}${end ? `&end=${Math.ceil(end)}` : ""}${autoplay ? "&autoplay=1" : ""}`;
  return (
    <div className="frame">
      <iframe src={src} title={title} allow="accelerometer; autoplay; encrypted-media; gyroscope; picture-in-picture" allowFullScreen referrerPolicy="strict-origin-when-cross-origin" />
    </div>
  );
}

export function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  const ref = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    ref.current?.focus();
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  return (
    <div className="scrim" role="dialog" aria-modal="true" aria-label={title} onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal">
        <header>
          <h2>{title}</h2>
          <button ref={ref} className="iconbtn" onClick={onClose} aria-label="Close" title="Close (Esc)">
            <X size={18} />
          </button>
        </header>
        {children}
      </div>
    </div>
  );
}

export const mmss = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;

/**
 * A YouTube thumbnail with the moment marked: the red bar shows how far into
 * the video `start` is, like YouTube's own progress bar.
 */
export function VideoThumb({ videoId, start, duration, width = 120, label, watched }: { videoId: string; start?: number; duration?: number; width?: number; label?: string; watched?: boolean }) {
  const pct = duration && start !== undefined ? Math.min(100, Math.max(2, (start / duration) * 100)) : watched ? 100 : 0;
  return (
    <span className="vthumb" style={{ width }}>
      <img src={`https://i.ytimg.com/vi/${encodeURIComponent(videoId)}/mqdefault.jpg`} alt="" loading="lazy" width={320} height={180} />
      <span className="vplay" aria-hidden="true">
        <Play size={Math.round(width / 9)} fill="currentColor" strokeWidth={0} />
      </span>
      {label && <span className="vtime">{label}</span>}
      {pct > 0 && (
        <span className="vbar" aria-hidden="true">
          <span style={{ width: `${pct}%` }} />
        </span>
      )}
    </span>
  );
}
