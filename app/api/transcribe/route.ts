import type { NextRequest } from "next/server";
import { z } from "zod";
import { MODELS, transcribeAudio, type LlmCall } from "@/engine/llm";
import { config } from "@/lib/server/env";
import { clientIp, fail, ok, sameOrigin } from "@/lib/server/http";
import { limitAll } from "@/lib/server/limit";
import { verifyToken } from "@/lib/server/token";
import { record } from "@/lib/server/events";
import { getSettings } from "@/lib/server/settings";
import { plausibleWords } from "@/lib/voice";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Voice input: the browser records the learner as 16 kHz mono WAV (32 kB a second) and posts it here, in two kinds:
//   preview: the audio since the last settled point (up to about 8 s), read again about every 2 s while the learner
//            speaks (the live grey text); no context from the readings before (given it, models chatted instead);
//   final:   the open window when they stop (the settled parts stand), counted like a chat turn.
// The transcript goes into the text box, where the learner can edit it before sending. The audio is not kept.
const MAX_SEC = 120; // the longest recording the browser allows; one clip is at most this
const MAX_BYTES = 44 + MAX_SEC * 32_000 + 4_096;
const Where = z.enum(["teach", "fix"]);
const Kind = z.enum(["preview", "final"]);

// Short, and no topic on purpose: every extra word (a topic, a spelling list) was something a model could write in
// place of what was said, and a mishearing pulled towards the topic reads like a claim the learner made. The browser
// never sends silence and trims the quiet; a transcript longer than the audio could hold is dropped below.
// every reading (live, and the last one) is a stretch of a longer recording, which may start or end mid-sentence
const INSTRUCTIONS = "Transcribe this stretch of a recording word for word: write exactly the words spoken, with normal punctuation, and nothing else. It may start or end in the middle of a sentence. If nothing is said, reply with nothing.";

export async function POST(req: NextRequest) {
  if (!sameOrigin(req)) return fail(403, "Requests from other sites are not allowed.");
  const session = verifyToken(req.headers.get("x-docendo-token") ?? "");
  if (!session) return fail(401, "Your session has expired. Start again from the first page.", { expired: true });
  const where = Where.safeParse(req.headers.get("x-docendo-where"));
  const kind = Kind.safeParse(req.headers.get("x-docendo-kind") ?? "final");
  if (!where.success || !kind.success || req.headers.get("content-type") !== "audio/wav") return fail(400, "Bad request.");
  const preview = kind.data === "preview";
  if (Number(req.headers.get("content-length") ?? "0") > MAX_BYTES) return fail(413, `Recordings can be up to ${MAX_SEC / 60} minutes.`);
  if (config.demo) return fail(503, "Voice input needs the live model. Type instead.");
  const { settings } = await getSettings();
  if (!settings.tools.voice) return fail(403, "Voice input is switched off. Type instead.");

  // live pieces come every couple of seconds while someone speaks: counted on this instance only (each shared check
  // costs Redis commands); the final pass counts against the session's and the site's budget like a chat turn
  const r = await limitAll(
    preview
      ? [
          [`voice:prevmin:${session.sid}`, 60, 60, "local"],
          [`voice:prev:${session.sid}`, 1200, 6 * 3600, "local"],
          [`voice:ip:${clientIp(req)}`, 1500, 60, "local"],
        ]
      : [
          [`voice:sidmin:${session.sid}`, 8, 60, "local"],
          [`voice:ip:${clientIp(req)}`, 1500, 60, "local"],
          [`voice:sid:${session.sid}`, 60, 6 * 3600], // costs model budget: shared across instances
          ["chat:global", settings.dailyTurnLimit, 86_400], // the site's daily model budget
        ],
  );
  if (!r.ok) {
    record({ t: "voice_limited", sid: session.sid, where: where.data });
    return fail(429, "Too many recordings in a short time. Type for now.", { retryAfter: r.retryAfter });
  }

  const wav = Buffer.from(await req.arrayBuffer());
  if (wav.length > MAX_BYTES || wav.length < 44 + (preview ? 1_600 : 3_200) || wav.toString("ascii", 0, 4) !== "RIFF" || wav.toString("ascii", 8, 12) !== "WAVE")
    return fail(400, "That recording couldn't be read. Try again, or type.");
  const sec = Math.round((wav.length - 44) / 3_200) / 10;

  const calls: LlmCall[] = [];
  try {
    const t = await transcribeAudio({ model: MODELS.transcribe, wav, instructions: INSTRUCTIONS, timeoutMs: preview ? 8_000 : 25_000, maxTokens: preview ? 120 : 1500 });
    calls.push({ role: preview ? "transcribe-live" : "transcribe", model: MODELS.transcribe, ms: t.ms, usage: t.usage });
    let text = t.text.trim().replace(/^["“]|["”]$/g, "").replace(/[*_#`]+/g, "").slice(0, 4_000);
    // a live piece cut mid-sentence comes back as "…every night": the joins are ours to make
    if (preview) text = text.replace(/^(\.\.\.|…)\s*/, "").replace(/\s*(\.\.\.|…)$/, "");
    // people say at most about 4 words a second: much more than the audio could hold means the model made it up
    const words = text ? text.split(/\s+/).length : 0;
    if (words > plausibleWords(sec)) {
      record({ t: "voice_rejected", sid: session.sid, where: where.data, kind: kind.data, sec, words });
      text = "";
    }
    // live pieces: cost and timing only (their words are provisional); the final pass: the transcript too
    if (preview) record({ t: "voice_preview", sid: session.sid, where: where.data, sec, chars: text.length, llm: calls });
    else record({ t: "voice", sid: session.sid, condition: session.cond, where: where.data, sec, chars: text.length, text, llm: calls });
    return ok({ text });
  } catch (e) {
    record({ t: "voice_error", sid: session.sid, where: where.data, kind: kind.data, sec, error: e instanceof Error ? e.message.slice(0, 300) : String(e) });
    return fail(503, "Voice input isn't working right now. Type instead.");
  }
}
