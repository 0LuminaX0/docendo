"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { ArrowLeft, ArrowRight, Check, Clock } from "lucide-react";
import { Header, mmss } from "./ui";
import { StepClock, stepTime, useDeadline } from "./StepClock";
import DebugSkip from "./DebugSkip";
import { useStudySettings } from "./SettingsContext";
import { useGuard, useNext } from "./useGuard";
import { Block } from "./lesson/LessonBody";
import { useSaved } from "@/lib/client/store";
import { pathOf } from "@/lib/flow";
import { track } from "@/lib/client/log";
import type { Lesson, LessonSection } from "@/lib/lesson";

/** Seconds a chapter stays on screen before "Next" opens: a quick read of its words (about 400 a minute), at least 8. */
export const chapterSeconds = (s: LessonSection) => {
  const words = s.blocks.reduce((a, b) => a + ("p" in b ? b.p.split(/\s+/).length : "figure" in b ? 12 + b.caption.split(/\s+/).length : 10), 0);
  return Math.max(8, Math.round(words * 0.15));
};

const plainTitle = (t: string) => t.replace(/^\d+\.\s*/, "");

/**
 * Step 1 with a text lesson (the pack's lesson.json), instead of the videos: one chapter at a time, like slides, so
 * the learner reads each part instead of scrolling past it. "Next" sits at the end of the chapter and opens after a
 * quick read of it (chapterSeconds); the chapters already read stay open (the bar on top, "Back"), the ones ahead
 * don't. The text arrives from the server with the page, never in the browser's code. It can't be selected or copied
 * (participants explain from memory, not by pasting: copy and drag attempts are logged), the last chapter's
 * "teach Kai" opens after `minSeconds` in all (kept with the session, so a reload doesn't restart it), and the step's
 * time limit (Study setup, the clock in the header) closes the lesson and goes on to Kai. Logged: each chapter's time when the learner leaves it (read_chapter), and on
 * continuing the time read, the chapters reached and the copy attempts.
 */
export default function Read({ lesson }: { lesson: Lesson }) {
  const router = useRouter();
  const [saved, update] = useSaved();
  const allowed = useGuard(saved, "watch");
  const nextOf = useNext();
  const [now, setNow] = useState(() => Date.now());
  const copies = useRef(0);
  const { limits } = useStudySettings();
  const clock = useDeadline(saved?.readStartedAt, limits.watch);
  const nextRef = useRef<((timedOut: boolean) => void) | null>(null);
  const timedOut = useRef(false);
  // checked after every render: the page may still be loading when the time runs out (soft timing: never)
  useEffect(() => {
    if (limits.soft || !clock.over || timedOut.current || !nextRef.current) return;
    timedOut.current = true;
    nextRef.current(true);
  });
  const perChapter = useRef<Record<string, number>>({});
  const n = lesson.sections.length;

  // when reading began, once per session
  useEffect(() => {
    if (saved && !saved.readStartedAt) update((s) => ({ ...s, readStartedAt: Date.now(), readChapterAt: Date.now() }));
  }, [saved, update]);
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  const at = Math.min(saved?.readAt ?? 0, n - 1);
  const max = Math.max(at, Math.min(saved?.readMax ?? 0, n - 1));
  const elapsed = Math.max(0, (now - (saved?.readStartedAt ?? now)) / 1000);
  const left = Math.max(0, lesson.minSeconds - elapsed);
  const since = saved?.readChapterAt ?? saved?.readStartedAt ?? now; // when the chapter on screen opened
  const onChapter = Math.max(0, (now - since) / 1000);
  const section = lesson.sections[at]!;
  // a chapter read before opens at once; a new one after a quick read of it
  const wait = at < max ? 0 : Math.max(0, chapterSeconds(section) - onChapter);

  if (!allowed || !saved) return <div className="center">Loading…</div>;

  // once the learner has moved on, the text stays closed: Kai is taught from memory (team sessions may look again)
  if (saved.step !== "watch" && !saved.team)
    return (
      <div className="shell">
        <Header step="watch" demo={saved.demo} />
        <main className="page narrow">
          <h1 className="title" style={{ fontSize: "clamp(26px, 4vw, 34px)" }}>The lesson is closed now</h1>
          <p>You explain it to Kai from memory, in your own words.</p>
          <div className="row">
            <button className="btn primary" onClick={() => router.push(pathOf(saved.step))}>
              Back to where you were <ArrowRight size={17} />
            </button>
          </div>
        </main>
      </div>
    );

  // the text is for reading, not for pasting into the chat later
  const refuse = (e: React.SyntheticEvent) => {
    e.preventDefault();
    copies.current++;
    track("read_copy_attempt", { kind: e.type });
  };

  /** Leave the chapter on screen for chapter `to` (logged with the time spent on it). */
  function go(to: number, via: string) {
    const sec = Math.round((Date.now() - since) / 1000);
    perChapter.current[section.id] = (perChapter.current[section.id] ?? 0) + sec;
    track("read_chapter", { chapter: section.id, index: at, sec, to: lesson.sections[to]?.id ?? null, via });
    update((s) => ({ ...s, readAt: to, readMax: Math.max(s.readMax ?? 0, to), readChapterAt: Date.now() }));
    window.scrollTo({ top: 0 });
  }

  function next(timedOut = false, skipped = false) {
    const sec = Math.round((Date.now() - since) / 1000);
    perChapter.current[section.id] = (perChapter.current[section.id] ?? 0) + sec;
    track("read_chapter", { chapter: section.id, index: at, sec, to: null, via: timedOut ? "time" : skipped ? "skip" : "continue" });
    track("read_continue", { readSec: Math.round(elapsed), reachedPct: Math.round(((max + 1) / n) * 100), chapters: max + 1, chapterSec: lesson.sections.map((x) => perChapter.current[x.id] ?? 0), copyAttempts: copies.current, timedOut, ...(skipped ? { skipped } : {}) });
    if (saved?.step === "watch") stepTime("watch", null, saved.readStartedAt, limits.watch, { chapters: max + 1, of: n });
    const s = nextOf("watch");
    update((x) => ({ ...x, step: x.step === "watch" ? s.step : x.step }));
    router.push(s.path);
  }

  // the step only times out while it is the session's step (team sessions looking again aren't sent on)
  nextRef.current = saved.step === "watch" ? next : null;
  const last = at === n - 1;
  return (
    <div className="shell">
      <Header step="watch" demo={saved.demo} right={<StepClock left={clock.left} over={clock.over} overMs={clock.overMs} soft={limits.soft} what="the lesson" />} />
      {saved.step === "watch" && <DebugSkip onSkip={() => next(false, true)} what="Skip to teaching Kai" />}
      <main className="page">
        <article className="lesson" onCopy={refuse} onCut={refuse} onDragStart={refuse}>
          <p className="lesson-kicker">{lesson.title}</p>
          <ol className="lesson-steps" aria-label="Chapters">
            {lesson.sections.map((s, i) => (
              <li key={s.id}>
                <button
                  type="button"
                  className={i === at ? "now" : i <= max ? "done" : ""}
                  disabled={i > max || i === at}
                  aria-current={i === at ? "step" : undefined}
                  onClick={() => go(i, "bar")}
                  title={i <= max ? plainTitle(s.title) : "Opens once you get there"}
                >
                  <span className="bar" aria-hidden="true" />
                  <span className="lbl">{plainTitle(s.title).replace(/:.*$/, "")}</span>
                </button>
              </li>
            ))}
          </ol>

          {at === 0 && (
            <p className="lesson-intro">
              <strong>Before you start.</strong> {lesson.intro.replace("{minutes}", String(limits.watch))}
            </p>
          )}
          <section className="lesson-section lesson-slide" key={section.id} data-section={section.id} aria-live="polite">
            <p className="lesson-count">
              Chapter {at + 1} of {n}
            </p>
            <h1 className="title">{plainTitle(section.title)}</h1>
            {section.blocks.map((b, i) => (
              <Block key={i} b={b} />
            ))}
          </section>
          {last && (
            <p className="lesson-end">
              <em>{lesson.end}</em>
            </p>
          )}

          <nav className="lesson-nav" aria-label="Chapters">
            {at > 0 ? (
              <button className="btn ghost" onClick={() => go(at - 1, "back")}>
                <ArrowLeft size={17} /> Back
              </button>
            ) : (
              <span />
            )}
            {!last ? (
              <button className="btn primary" onClick={() => go(at + 1, "next")} disabled={wait > 0}>
                {wait > 0 ? (
                  <>
                    <Clock size={16} aria-hidden="true" /> Next in {Math.ceil(wait)} s
                  </>
                ) : (
                  <>
                    Next: {plainTitle(lesson.sections[at + 1]!.title).replace(/:.*$/, "")} <ArrowRight size={17} />
                  </>
                )}
              </button>
            ) : (
              <button className="btn primary" onClick={() => next()} disabled={left > 0 || wait > 0}>
                {left > 0 || wait > 0 ? (
                  <>
                    <Clock size={16} aria-hidden="true" /> Teach Kai in {mmss(Math.max(left, wait))}
                  </>
                ) : (
                  <>
                    <Check size={17} /> I&apos;ve read it, teach Kai
                  </>
                )}
              </button>
            )}
          </nav>
          <p className="note lesson-foot">
            {last ? "The text closes when you go on: you'll explain it to Kai from memory." : "You can go back to the chapters you've read."} {limits.soft
              ? `Plan on about ${limits.watch} minutes for the lesson. The clock at the top shows it, and keeps counting if you need longer.`
              : `You have ${limits.watch} minutes for the lesson (the clock is at the top); when the time is up, it closes and you go on to Kai.`}
          </p>
        </article>
      </main>
    </div>
  );
}
