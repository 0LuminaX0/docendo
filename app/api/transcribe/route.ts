import type { NextRequest } from "next/server";
import { z } from "zod";
import { MODELS, transcribeAudio, type LlmCall } from "@/engine/llm";
import { config } from "@/lib/server/env";
import { clientIp, fail, ok, sameOrigin } from "@/lib/server/http";
import { limitAll } from "@/lib/server/limit";
import { verifyToken } from "@/lib/server/token";
import { record } from "@/lib/server/events";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Voice input: the browser records the learner, turns it into a 16 kHz mono WAV (32 kB a second) and posts it here;
// the transcript goes back into the text box, where the learner can edit it before sending. The audio is not kept.
const MAX_SEC = 120;
const MAX_BYTES = 44 + MAX_SEC * 32_000 + 4_096;
const Where = z.enum(["teach", "fix"]);

const INSTRUCTIONS = [
  "Transcribe this recording of a student explaining an idea to a classmate, word for word: write exactly the words spoken, in their language, and never replace a word with another or tidy up the wording.",
  "The topic is multi-armed bandits (arms, rewards, averages, greedy, epsilon-greedy, UCB, bonus, exploration, exploitation), so expect those words.",
  "Plain text with normal punctuation: no LaTeX, no markdown, no filler sounds (um, uh). Don't add, answer, correct, summarise or explain anything.",
  "Reply with the transcript only. If nothing is said, reply with nothing.",
].join(" ");

export async function POST(req: NextRequest) {
  if (!sameOrigin(req)) return fail(403, "Requests from other sites are not allowed.");
  const session = verifyToken(req.headers.get("x-docendo-token") ?? "");
  if (!session) return fail(401, "Your session has expired. Start again from the first page.", { expired: true });
  const where = Where.safeParse(req.headers.get("x-docendo-where"));
  if (!where.success || req.headers.get("content-type") !== "audio/wav") return fail(400, "Bad request.");
  if (Number(req.headers.get("content-length") ?? "0") > MAX_BYTES) return fail(413, `Recordings can be up to ${MAX_SEC / 60} minutes.`);
  if (config.demo) return fail(503, "Voice input needs the live model. Type instead.");

  const r = await limitAll([
    [`voice:sidmin:${session.sid}`, 8, 60, "local"],
    [`voice:ip:${clientIp(req)}`, 120, 60, "local"],
    [`voice:sid:${session.sid}`, 60, 6 * 3600], // costs model budget: shared across instances
    ["chat:global", config.dailyTurnLimit, 86_400], // the site's daily model budget
  ]);
  if (!r.ok) {
    record({ t: "voice_limited", sid: session.sid, where: where.data });
    return fail(429, "Too many recordings in a short time. Type for now.", { retryAfter: r.retryAfter });
  }

  const wav = Buffer.from(await req.arrayBuffer());
  if (wav.length > MAX_BYTES || wav.length < 44 + 3_200 || wav.toString("ascii", 0, 4) !== "RIFF" || wav.toString("ascii", 8, 12) !== "WAVE")
    return fail(400, "That recording couldn't be read. Try again, or type.");
  const sec = Math.round((wav.length - 44) / 3_200) / 10;

  const calls: LlmCall[] = [];
  try {
    const t = await transcribeAudio({ model: MODELS.transcribe, wav, instructions: INSTRUCTIONS, timeoutMs: 25_000 });
    calls.push({ role: "transcribe", model: MODELS.transcribe, ms: t.ms, usage: t.usage });
    const text = t.text.trim().replace(/^["“]|["”]$/g, "").slice(0, 4_000);
    record({ t: "voice", sid: session.sid, condition: session.cond, where: where.data, sec, chars: text.length, text, llm: calls });
    return ok({ text });
  } catch (e) {
    record({ t: "voice_error", sid: session.sid, where: where.data, sec, error: e instanceof Error ? e.message.slice(0, 300) : String(e) });
    return fail(503, "Voice input isn't working right now. Type instead.");
  }
}
