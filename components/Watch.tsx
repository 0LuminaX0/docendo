"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { ArrowRight, CircleCheck } from "lucide-react";
import { Header, VideoFrame, VideoThumb, mmss } from "./ui";
import { useGuard } from "./useGuard";
import { useSaved } from "@/lib/client/store";

type Video = { id: string; videoId: string; title: string; part: number; durationSec?: number };

export default function Watch({ videos }: { videos: Video[] }) {
  const router = useRouter();
  const [saved, update] = useSaved();
  const allowed = useGuard(saved, "watch");
  const [i, setI] = useState(0);
  if (!allowed || !saved) return <div className="center">Loading…</div>;

  const video = videos[i]!;
  const seen = (id: string) => saved.watched.includes(id);
  const markSeen = (id: string) => !seen(id) && update((s) => ({ ...s, watched: [...s.watched, id] }));
  // titles in topic.yaml are "Channel: Video title"
  const split = (t: string) => {
    const m = /^([^:]{2,30}):\s+(.+)$/.exec(t);
    return m ? { channel: m[1]!, name: m[2]! } : { channel: "", name: t };
  };
  const cleanTitle = (t: string) => split(t).name;
  const channel = split(video.title).channel;

  function next() {
    markSeen(video.id);
    if (i < videos.length - 1) setI(i + 1);
    else {
      update((s) => ({ ...s, watched: [...new Set([...s.watched, video.id])], step: s.step === "watch" ? "teach" : s.step }));
      router.push("/teach");
    }
  }

  return (
    <div className="shell">
      <Header phase={1} demo={saved.demo} />
      <main className="page">
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <span className="eyebrow">Step 1 · Watch the lesson</span>
          <h1 className="title" style={{ fontSize: "clamp(26px, 4vw, 36px)" }}>{cleanTitle(video.title)}</h1>
          {channel && <p className="note">by {channel}{video.durationSec ? ` · ${mmss(video.durationSec)}` : ""}</p>}
        </div>
        <div className="watch">
          <div style={{ display: "flex", flexDirection: "column", gap: 14, minWidth: 0 }}>
            <VideoFrame key={video.videoId} videoId={video.videoId} title={cleanTitle(video.title)} />
          </div>
          <aside className="aside">
            {videos.length > 1 && (
              <nav className="playlist" aria-label="Lesson videos">
                <span className="eyebrow">
                  The lesson · {videos.length} videos{videos.every((v) => v.durationSec) ? ` · ${Math.round(videos.reduce((a, v) => a + (v.durationSec ?? 0), 0) / 60)} min` : ""}
                </span>
                {videos.map((v, k) => (
                  <button key={v.id} className="pl-item" aria-current={k === i} onClick={() => setI(k)}>
                    <VideoThumb videoId={v.videoId} width={116} label={v.durationSec ? mmss(v.durationSec) : undefined} watched={seen(v.id)} />
                    <span style={{ minWidth: 0 }}>
                      <span className="t">{cleanTitle(v.title)}</span>
                      <span className="m">
                        Part {v.part} · {split(v.title).channel}
                        {seen(v.id) && (
                          <span className="done">
                            <CircleCheck size={13} strokeWidth={2.4} /> watched
                          </span>
                        )}
                      </span>
                    </span>
                  </button>
                ))}
              </nav>
            )}
            <h2>While you watch</h2>
            <p>Afterwards you&apos;ll explain this to Kai, a classmate who missed it. Kai only knows what you tell it.</p>
            <p>Pay attention to the restaurant example, how regret is measured, and how ε-greedy and UCB decide when to try something new.</p>
            <p>The video won&apos;t be open while you teach, but Kai&apos;s help button can show you the right moment again once you&apos;ve had a go.</p>
            <button className="btn primary" onClick={next}>
              {i < videos.length - 1 ? `Next: part ${i + 2}` : "I've watched it, teach Kai"} <ArrowRight size={17} />
            </button>
            {i === videos.length - 1 && videos.length > 1 && !videos.slice(0, -1).every((v) => seen(v.id)) && (
              <p className="note">You haven&apos;t marked every part as watched yet.</p>
            )}
          </aside>
        </div>
      </main>
    </div>
  );
}
