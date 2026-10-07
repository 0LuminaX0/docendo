import type { Chunk } from "../schema";
import { decodeEntities, squash, wordCount } from "./text";

export type Cue = { start: number; end: number; text: string }; // seconds

const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130 Safari/537.36";

/**
 * Fetch captions for a video. The caption URL embedded in the watch page is
 * guarded, so we ask the player API as the Android client, which returns a
 * caption URL that works without a session. Prefers human captions over
 * auto-generated ones. This can break when YouTube changes; the fallback is a
 * manual `.vtt` file in sources/raw (see ingest/index.ts).
 */
export async function fetchYoutubeCaptions(videoId: string): Promise<{ title: string; kind: string; cues: Cue[] }> {
  const watch = await (await fetch(`https://www.youtube.com/watch?v=${videoId}`, {
    headers: { "User-Agent": UA, "Accept-Language": "en" },
  })).text();
  const key = /"INNERTUBE_API_KEY":"([^"]+)"/.exec(watch)?.[1];
  if (!key) throw new Error(`youtube ${videoId}: no API key in watch page`);
  const title = decodeEntities(/<title>([^<]*)<\/title>/.exec(watch)?.[1] ?? videoId).replace(/ - YouTube$/, "");

  const player = (await (await fetch(`https://www.youtube.com/youtubei/v1/player?key=${key}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "User-Agent": UA },
    body: JSON.stringify({
      context: { client: { clientName: "ANDROID", clientVersion: "20.10.38", hl: "en" } },
      videoId,
    }),
  })).json()) as {
    captions?: { playerCaptionsTracklistRenderer?: { captionTracks?: { baseUrl: string; languageCode: string; kind?: string }[] } };
  };
  const tracks = player.captions?.playerCaptionsTracklistRenderer?.captionTracks ?? [];
  const english = tracks.filter((t) => t.languageCode.startsWith("en"));
  const track = english.find((t) => t.kind !== "asr") ?? english[0];
  if (!track) throw new Error(`youtube ${videoId}: no English captions`);

  const xml = await (await fetch(track.baseUrl, { headers: { "User-Agent": UA } })).text();
  const cues = parseTimedText(xml);
  if (!cues.length) throw new Error(`youtube ${videoId}: caption track was empty`);
  return { title, kind: track.kind === "asr" ? "auto-generated" : "human", cues };
}

/** Parse YouTube timedtext XML, format 3 (`<p t= d=>`) or format 1 (`<text start= dur=>`). */
export function parseTimedText(xml: string): Cue[] {
  const cues: Cue[] = [];
  const p3 = /<p\s+([^>]*)>([\s\S]*?)<\/p>/g;
  const p1 = /<text\s+([^>]*)>([\s\S]*?)<\/text>/g;
  const attr = (attrs: string, name: string) => {
    const m = new RegExp(`\\b${name}="([^"]*)"`).exec(attrs);
    return m ? Number(m[1]) : NaN;
  };
  for (const m of xml.matchAll(p3)) {
    const start = attr(m[1]!, "t") / 1000;
    const dur = attr(m[1]!, "d") / 1000;
    pushCue(cues, start, start + (Number.isFinite(dur) ? dur : 0), m[2]!);
  }
  if (!cues.length) {
    for (const m of xml.matchAll(p1)) {
      const start = attr(m[1]!, "start");
      const dur = attr(m[1]!, "dur");
      pushCue(cues, start, start + (Number.isFinite(dur) ? dur : 0), m[2]!);
    }
  }
  return cues;
}

function pushCue(cues: Cue[], start: number, end: number, inner: string) {
  // inner may hold <s> word tags and entity-encoded text
  const text = squash(decodeEntities(decodeEntities(inner.replace(/<[^>]+>/g, ""))));
  if (!text || /^\[(music|applause)\]$/i.test(text) || !Number.isFinite(start)) return;
  cues.push({ start, end, text });
}

/** Parse a WebVTT file (manual fallback when captions can't be fetched). */
export function parseVtt(vtt: string): Cue[] {
  const toSec = (t: string) => {
    const parts = t.split(":").map(Number);
    return parts.reduce((acc, x) => acc * 60 + x, 0);
  };
  const cues: Cue[] = [];
  for (const block of vtt.split(/\r?\n\r?\n/)) {
    const m = /(\d{1,2}:?\d{2}:\d{2}\.\d{3})\s+-->\s+(\d{1,2}:?\d{2}:\d{2}\.\d{3})[^\n]*\n([\s\S]+)/.exec(block);
    if (m) pushCue(cues, toSec(m[1]!), toSec(m[2]!), m[3]!);
  }
  return cues;
}

/** Group cues into chunks of about `seconds` seconds, keeping exact start and end times. */
export function cueChunks(sourceId: string, cues: Cue[], seconds = 30, maxWords = 110): Chunk[] {
  const chunks: Chunk[] = [];
  let cur: Cue[] = [];
  const flush = () => {
    if (!cur.length) return;
    chunks.push({
      id: `${sourceId}#${chunks.length}`,
      sourceId,
      loc: { kind: "time", start: round(cur[0]!.start), end: round(cur[cur.length - 1]!.end) },
      text: squash(cur.map((c) => c.text).join(" ")),
    });
    cur = [];
  };
  for (const cue of cues) {
    if (cur.length) {
      const span = cue.end - cur[0]!.start;
      const words = wordCount(cur.map((c) => c.text).join(" ")) + wordCount(cue.text);
      if (span > seconds || words > maxWords) flush();
    }
    cur.push(cue);
  }
  flush();
  return chunks;
}

const round = (x: number) => Math.round(x * 10) / 10;
