"use client";

import { useEffect, useRef, useState } from "react";
import { Mic, Square } from "lucide-react";
import { useSaved } from "@/lib/client/store";
import { track } from "@/lib/client/log";

/**
 * Speak instead of typing. The browser records, turns the recording into a
 * small 16 kHz mono WAV, and the server writes it out (app/api/transcribe); the
 * words land in the text box to be read and edited before sending. Hidden in
 * demo mode (no model) and in browsers that can't record.
 */
const MAX_SEC = 120;

export default function VoiceButton({ where, onText, disabled }: { where: "teach" | "fix"; onText: (text: string) => void; disabled?: boolean }) {
  const [saved] = useSaved();
  const [phase, setPhase] = useState<"idle" | "rec" | "work">("idle");
  const [sec, setSec] = useState(0);
  const [msg, setMsg] = useState<string | null>(null);
  const rec = useRef<{ mr: MediaRecorder; stream: MediaStream; chunks: Blob[]; t0: number; timer: number } | null>(null);
  const [can, setCan] = useState(false);
  useEffect(() => setCan(typeof MediaRecorder !== "undefined" && !!navigator.mediaDevices?.getUserMedia), []);
  useEffect(() => () => stopStream(), []);

  function stopStream() {
    const r = rec.current;
    if (!r) return;
    window.clearInterval(r.timer);
    r.stream.getTracks().forEach((t) => t.stop());
  }

  async function start() {
    setMsg(null);
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true } });
    } catch {
      setMsg("The microphone is blocked. Allow it in your browser, or type.");
      track("voice_error", { where, why: "denied" });
      return;
    }
    const mr = new MediaRecorder(stream);
    const r = { mr, stream, chunks: [] as Blob[], t0: Date.now(), timer: 0 };
    mr.ondataavailable = (e) => e.data.size && r.chunks.push(e.data);
    mr.onstop = () => void finish(r.chunks, mr.mimeType, (Date.now() - r.t0) / 1000);
    r.timer = window.setInterval(() => {
      const s = Math.floor((Date.now() - r.t0) / 1000);
      setSec(s);
      if (s >= MAX_SEC) stop();
    }, 250);
    rec.current = r;
    mr.start();
    setSec(0);
    setPhase("rec");
    track("voice_start", { where });
  }

  function stop() {
    const r = rec.current;
    if (!r || r.mr.state === "inactive") return;
    r.mr.stop();
    stopStream();
  }

  async function finish(chunks: Blob[], type: string, seconds: number) {
    rec.current = null;
    if (seconds < 0.6) return setPhase("idle");
    setPhase("work");
    try {
      const wav = await toWav(new Blob(chunks, { type }));
      const res = await fetch("/api/transcribe", {
        method: "POST",
        headers: { "content-type": "audio/wav", "x-docendo-token": saved?.token ?? "", "x-docendo-where": where },
        body: wav,
      });
      const d = (await res.json().catch(() => ({}))) as { text?: string; error?: string };
      if (!res.ok) throw new Error(d.error ?? "Voice input isn't working right now. Type instead.");
      const text = (d.text ?? "").trim();
      track("voice_done", { where, sec: Math.round(seconds), chars: text.length });
      if (text) onText(text);
      else setMsg("Nothing was heard. Try again closer to the microphone.");
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "Voice input isn't working right now. Type instead.");
      track("voice_error", { where, why: "server" });
    }
    setPhase("idle");
  }

  if (!can || !saved || saved.demo) return null;
  const mmss = `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, "0")}`;
  return (
    <span className="voice">
      {msg && phase === "idle" && <span className="voice-msg" role="status">{msg}</span>}
      {phase === "rec" ? (
        <button type="button" className="voice-btn rec" onClick={stop} aria-label="Stop recording" title="Stop and write it out">
          <i className="voice-dot" aria-hidden="true" />
          <span>{mmss}</span>
          <Square size={12} fill="currentColor" strokeWidth={0} />
        </button>
      ) : (
        <button type="button" className="voice-btn" onClick={() => void start()} disabled={disabled || phase === "work"} aria-label="Speak instead of typing" title="Speak instead of typing (up to 2 minutes)">
          <Mic size={17} strokeWidth={2.2} />
          {phase === "work" && <span>Writing it out…</span>}
        </button>
      )}
    </span>
  );
}

/** Any recording the browser made → 16 kHz mono 16-bit WAV (what the model reads, and small). */
async function toWav(blob: Blob): Promise<Blob> {
  const ctx = new AudioContext();
  const decoded = await ctx.decodeAudioData(await blob.arrayBuffer());
  void ctx.close();
  const rate = 16_000;
  const off = new OfflineAudioContext(1, Math.ceil(decoded.duration * rate), rate);
  const src = off.createBufferSource();
  src.buffer = decoded;
  src.connect(off.destination);
  src.start();
  const pcm = (await off.startRendering()).getChannelData(0);
  const buf = new ArrayBuffer(44 + pcm.length * 2);
  const v = new DataView(buf);
  const str = (o: number, s: string) => [...s].forEach((c, i) => v.setUint8(o + i, c.charCodeAt(0)));
  str(0, "RIFF");
  v.setUint32(4, 36 + pcm.length * 2, true);
  str(8, "WAVE");
  str(12, "fmt ");
  v.setUint32(16, 16, true);
  v.setUint16(20, 1, true); // PCM
  v.setUint16(22, 1, true); // mono
  v.setUint32(24, rate, true);
  v.setUint32(28, rate * 2, true);
  v.setUint16(32, 2, true);
  v.setUint16(34, 16, true);
  str(36, "data");
  v.setUint32(40, pcm.length * 2, true);
  for (let i = 0; i < pcm.length; i++) v.setInt16(44 + i * 2, Math.max(-1, Math.min(1, pcm[i]!)) * 0x7fff, true);
  return new Blob([buf], { type: "audio/wav" });
}
