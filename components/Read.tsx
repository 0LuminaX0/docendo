"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { ArrowRight, Clock } from "lucide-react";
import { Header, mmss } from "./ui";
import { useGuard, useNext } from "./useGuard";
import { Section } from "./lesson/LessonBody";
import { useSaved } from "@/lib/client/store";
import { pathOf } from "@/lib/flow";
import { track } from "@/lib/client/log";
import type { Lesson } from "@/lib/lesson";

/**
 * Step 1 with a text lesson (the pack's lesson.json), instead of the videos. The text arrives from the server with the
 * page, never in the browser's code. It can't be selected or copied (participants explain from memory, not by pasting:
 * copy and drag attempts are logged), "Continue" opens after `minSeconds` (kept with the session, so a reload doesn't
 * restart it) and a reminder to move on shows after `remindSeconds`. The time read, how far down the page the learner
 * got and the copy attempts are logged when they continue.
 */
export default function Read({ lesson }: { lesson: Lesson }) {
  const router = useRouter();
  const [saved, update] = useSaved();
  const allowed = useGuard(saved, "watch");
  const nextOf = useNext();
  const [now, setNow] = useState(() => Date.now());
  const copies = useRef(0);
  const reach = useRef(0);
  const reminded = useRef(false);

  // when reading began, once per session
  useEffect(() => {
    if (saved && !saved.readStartedAt) update((s) => ({ ...s, readStartedAt: Date.now() }));
  }, [saved, update]);
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  // how far down the text the learner got (share of the page height)
  useEffect(() => {
    const onScroll = () => {
      const h = document.documentElement.scrollHeight;
      reach.current = Math.max(reach.current, h ? Math.min(1, (window.scrollY + window.innerHeight) / h) : 1);
    };
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  const elapsed = Math.max(0, (now - (saved?.readStartedAt ?? now)) / 1000);
  const left = Math.max(0, lesson.minSeconds - elapsed);
  const remind = lesson.remindSeconds > 0 && elapsed >= lesson.remindSeconds;
  useEffect(() => {
    if (remind && !reminded.current) (reminded.current = true), track("read_reminder", { readSec: Math.round(elapsed) });
  }, [remind, elapsed]);

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

  function next() {
    track("read_continue", { readSec: Math.round(elapsed), reachedPct: Math.round(reach.current * 100), copyAttempts: copies.current, reminded: reminded.current });
    const n = nextOf("watch");
    update((s) => ({ ...s, step: s.step === "watch" ? n.step : s.step }));
    router.push(n.path);
  }

  return (
    <div className="shell">
      <Header step="watch" demo={saved.demo} />
      <main className="page">
        <article className="lesson" onCopy={refuse} onCut={refuse} onDragStart={refuse}>
          <h1 className="title">{lesson.title}</h1>
          <p className="lesson-intro">
            <strong>Before you start.</strong> {lesson.intro}
          </p>
          {lesson.sections.map((s) => (
            <Section key={s.id} s={s} />
          ))}
          <p className="lesson-end">
            <em>{lesson.end}</em>
          </p>
        </article>
      </main>
      <div className="lesson-bar">
        <span className="note">
          {left > 0 ? (
            <>
              <Clock size={15} aria-hidden="true" /> Take your time: you can continue in {mmss(left)}.
            </>
          ) : remind ? (
            "You've been reading for a while. Continue to Kai when you're ready."
          ) : (
            "When you're ready, explain it to Kai. The text won't be available then."
          )}
        </span>
        <button className="btn primary" onClick={next} disabled={left > 0}>
          I&apos;ve read it, teach Kai <ArrowRight size={17} />
        </button>
      </div>
    </div>
  );
}
