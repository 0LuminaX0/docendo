"use client";

// Voice input, written out as the learner speaks, in one pass:
//  - the audio since the last settled point (a rolling window, up to about 8 s) is written out again about every 2.5 s
//    (/api/transcribe, kind "preview"), so the model hears whole phrases and the live text improves as a sentence
//    goes on; once the window is long enough and the learner pauses, that part settles and the next window starts
//    after it. One request at a time, so they never pile up;
//  - when they stop, only the open window is read once more (kind "final"): the settled parts stand.
// Each clip is trimmed: quiet at both ends is cut and long pauses are shortened. That halves what is paid for, and a
// model that never hears silence has nothing to make words up from. Audio is never kept; only the text comes back.

const RATE = 16_000;
const MAX_SEC = 120;
const BATCH = 640; // samples per batch from the worklet (40 ms at 16 kHz)
const EVERY = 2.5; // s of new audio before the window is read again
const SETTLE_MIN = 4; // s: a window this long settles at the next pause
const SETTLE_MAX = 8; // s: a window settles here even without a pause
const EDGE = 0.24; // s of quiet kept before and after speech
const GAP = 0.4; // s: a longer pause inside a clip is shortened to this
const PAUSE = 0.32; // s of quiet that counts as a pause
const NOISE_CAP = 0.012; // the background noise estimate never goes above this (an RMS level well under speech)

export type DictationEvents = {
  onLevel: (level: number) => void; // 0..1, about 25 times a second
  onPreview: (text: string, pending: boolean) => void; // the live transcript so far; pending: more is on its way
  onLimit: () => void; // the recording reached its maximum length
};

export class Dictation {
  private ctx: AudioContext | null = null;
  private stream: MediaStream | null = null;
  private node: AudioWorkletNode | null = null;
  private samples: Float32Array[] = [];
  private rmsOf: number[] = []; // each batch's loudness
  private spoke: boolean[] = []; // each batch: did it sound like speech?
  private total = 0; // samples recorded
  private quiet = 0; // samples of quiet so far
  private floor = 0.004; // background noise level, learned as we go
  private rate = RATE;
  private voiced = 0; // samples that sounded like speech, over the whole recording
  private settled: string[] = []; // the parts that won't change any more
  private from = 0; // where the open window starts (samples)
  private sentTo = 0; // where the last reading of the window ended
  private tail = ""; // the latest reading of the open window
  private busy = false; // a reading is on its way
  private stopped = false;

  constructor(private token: string, private where: string, private ev: DictationEvents) {}

  async start() {
    // no echo cancelling (nothing plays while recording); noise suppression for a busy room; automatic gain so a
    // quiet laptop microphone still gives the model a clear signal
    this.stream = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, echoCancellation: false, noiseSuppression: true, autoGainControl: true } });
    try {
      this.ctx = new AudioContext({ sampleRate: RATE });
    } catch {
      this.ctx = new AudioContext(); // older Safari: the device's rate, resampled when a window is sent
    }
    this.rate = this.ctx.sampleRate;
    await this.ctx.audioWorklet.addModule("/voice-worklet.js");
    const src = this.ctx.createMediaStreamSource(this.stream);
    this.node = new AudioWorkletNode(this.ctx, "docendo-tap");
    const mute = this.ctx.createGain();
    mute.gain.value = 0; // the graph must reach the speakers to run, silently
    src.connect(this.node).connect(mute).connect(this.ctx.destination);
    this.node.port.onmessage = (e: MessageEvent<Float32Array>) => this.take(e.data);
  }

  get seconds() {
    return this.total / this.rate;
  }

  private take(batch: Float32Array) {
    if (this.stopped) return;
    this.samples.push(batch);
    this.total += batch.length;
    let sum = 0;
    for (let i = 0; i < batch.length; i++) sum += batch[i]! * batch[i]!;
    const rms = Math.sqrt(sum / batch.length);
    this.rmsOf.push(rms);
    // the background noise: drops at once in a quieter moment, rises only very slowly and never to speech level
    // (otherwise, during long continuous speech, speech itself would come to count as background)
    this.floor = rms < this.floor ? rms : Math.min(NOISE_CAP, this.floor * 1.002);
    const speaking = rms > Math.max(0.008, this.floor * 2.5);
    this.quiet = speaking ? 0 : this.quiet + batch.length;
    if (speaking) this.voiced += batch.length;
    this.spoke.push(speaking);
    this.ev.onLevel(Math.min(1, Math.sqrt(rms) * 2.6));
    if (this.seconds >= MAX_SEC) this.ev.onLimit();
    // read the window again once there is enough new audio, or as soon as the learner pauses
    const fresh = (this.total - this.sentTo) / this.rate;
    const pausedNow = this.quiet >= PAUSE * this.rate && this.quiet - batch.length < PAUSE * this.rate;
    if (!this.busy && fresh > 0.3 && (fresh >= EVERY || pausedNow)) this.read();
  }

  /** The loudest batch between two sample positions. */
  private peakIn(a: number, b: number) {
    let m = 0;
    for (let i = Math.floor(a / BATCH); i < Math.ceil(b / BATCH) && i < this.rmsOf.length; i++) m = Math.max(m, this.rmsOf[i]!);
    return m;
  }

  /** Write out the open window (from the last settled point to now). */
  private read() {
    const a = this.from;
    const b = this.total;
    this.sentTo = b;
    // a window with nothing said: never sent; if it is long, it settles empty (a long pause)
    if (this.peakIn(a, b) < Math.max(0.015, this.floor * 3)) {
      if ((b - a) / this.rate >= 2) (this.from = b), (this.tail = "");
      return;
    }
    this.busy = true;
    this.emit();
    const len = (b - a) / this.rate;
    const endsInPause = this.quiet >= PAUSE * this.rate;
    void this.send(this.wav(a, b), "preview")
      .then((t) => {
        if (this.stopped || a !== this.from) return;
        // settle a long enough window at a pause (or a very long one anyway); otherwise it stays open and grows
        if ((len >= SETTLE_MIN && endsInPause) || len >= SETTLE_MAX) {
          if (t) this.settled.push(t);
          this.from = b;
          this.tail = "";
        } else this.tail = t;
      })
      .catch(() => {})
      .finally(() => {
        this.busy = false;
        this.emit();
      });
  }

  private emit() {
    if (!this.stopped) this.ev.onPreview(this.preview, this.busy || (this.total - this.sentTo) / this.rate > 0.3);
  }

  /** The settled parts and the open window's latest reading, joined. */
  get preview() {
    return [...this.settled, this.tail].filter(Boolean).reduce(joinParts, "");
  }

  /** Stop: the open window is read once more and joins the settled parts (on failure, its live reading stands). */
  async finish(): Promise<{ text: string; final: boolean }> {
    this.stopped = true;
    this.release();
    // nothing that sounded like speech: send nothing (a model asked to transcribe silence makes words up)
    if (this.seconds < 0.5 || this.voiced / this.rate < 0.4) return { text: "", final: true };
    const open = this.spoke.slice(Math.floor(this.from / BATCH)).some(Boolean);
    if (!open) return { text: this.preview, final: true };
    try {
      this.tail = await this.send(this.wav(this.from, this.total), "final");
      return { text: this.preview, final: true };
    } catch (e) {
      if (this.preview) return { text: this.preview, final: false };
      throw e;
    }
  }

  cancel() {
    this.stopped = true;
    this.release();
  }

  private release() {
    this.node?.port.close();
    this.stream?.getTracks().forEach((t) => t.stop());
    void this.ctx?.close().catch(() => {});
  }

  private async send(wav: Blob, kind: "preview" | "final"): Promise<string> {
    const res = await fetch("/api/transcribe", {
      method: "POST",
      headers: { "content-type": "audio/wav", "x-docendo-token": this.token, "x-docendo-where": this.where, "x-docendo-kind": kind },
      body: wav,
    });
    const d = (await res.json().catch(() => ({}))) as { text?: string; error?: string };
    if (!res.ok) throw new Error(d.error ?? "Voice input isn't working right now. Type instead.");
    return (d.text ?? "").trim();
  }

  /**
   * Batches [from, to) as a 16 kHz mono 16-bit WAV, trimmed: from a little before the first speech to a little after
   * the last, with pauses longer than GAP shortened to GAP.
   */
  private wav(from: number, to: number): Blob {
    const i0 = Math.floor(from / BATCH);
    const i1 = Math.min(this.samples.length, Math.ceil(to / BATCH));
    let first = -1;
    let last = -1;
    for (let i = i0; i < i1; i++) if (this.spoke[i]) (first < 0 && (first = i), (last = i));
    const keep: Float32Array[] = [];
    const edge = Math.round((EDGE * this.rate) / BATCH);
    const gap = Math.round((GAP * this.rate) / BATCH);
    if (first >= 0) {
      let quiet = 0;
      for (let i = Math.max(i0, first - edge); i < Math.min(i1, last + edge + 1); i++) {
        quiet = this.spoke[i] ? 0 : quiet + 1;
        if (quiet <= gap) keep.push(this.samples[i]!);
      }
    }
    const pcm = new Float32Array(keep.reduce((n, b) => n + b.length, 0));
    let at = 0;
    for (const b of keep) (pcm.set(b, at), (at += b.length));
    const data = this.rate === RATE ? pcm : resample(pcm, this.rate, RATE);
    const buf = new ArrayBuffer(44 + data.length * 2);
    const v = new DataView(buf);
    const str = (o: number, s: string) => [...s].forEach((c, k) => v.setUint8(o + k, c.charCodeAt(0)));
    str(0, "RIFF");
    v.setUint32(4, 36 + data.length * 2, true);
    str(8, "WAVE");
    str(12, "fmt ");
    v.setUint32(16, 16, true);
    v.setUint16(20, 1, true);
    v.setUint16(22, 1, true);
    v.setUint32(24, RATE, true);
    v.setUint32(28, RATE * 2, true);
    v.setUint16(32, 2, true);
    v.setUint16(34, 16, true);
    str(36, "data");
    v.setUint32(40, data.length * 2, true);
    for (let k = 0; k < data.length; k++) v.setInt16(44 + k * 2, Math.max(-1, Math.min(1, data[k]!)) * 0x7fff, true);
    return new Blob([buf], { type: "audio/wav" });
  }
}

/** Linear resampling (only for browsers that can't record at 16 kHz). */
function resample(x: Float32Array, from: number, to: number): Float32Array {
  const out = new Float32Array(Math.floor((x.length * to) / from));
  const r = from / to;
  for (let i = 0; i < out.length; i++) {
    const p = i * r;
    const j = Math.floor(p);
    const f = p - j;
    out[i] = (x[j] ?? 0) * (1 - f) + (x[j + 1] ?? x[j] ?? 0) * f;
  }
  return out;
}

/**
 * Two readings of neighbouring stretches, joined: one that starts mid-sentence ("every night…") continues the one
 * before without its full stop, and a word read on both sides of the cut ("the bonus is" + "is bigger") counts once.
 */
export function joinParts(a: string, b: string): string {
  if (!a) return b.trim();
  if (!b) return a;
  const word = (w: string | undefined) => (w ?? "").toLowerCase().replace(/[^\p{L}\p{N}']/gu, "");
  const tail = a.trim().split(/\s+/);
  let head = b.trim().split(/\s+/);
  if (word(tail.at(-1)) && word(tail.at(-1)) === word(head[0])) head = head.slice(1);
  if (!head.length) return a.trim();
  const left = /^[a-z]/.test(head[0]!) ? a.trim().replace(/[.]$/, "") : a.trim();
  return `${left} ${head.join(" ")}`;
}

/** Text joined with one space where needed. */
export function joinText(a: string, b: string) {
  if (!a) return b;
  if (!b) return a;
  return /\s$/.test(a) || /^\s/.test(b) ? a + b : `${a} ${b}`;
}
