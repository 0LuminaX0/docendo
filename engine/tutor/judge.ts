import { z } from "zod";
import type { Bundle } from "../../content/schema";
import { hasTerm } from "../../content/terms";
import { chatJson, MODELS } from "../llm";
import { Verdict } from "./state";
import { tokens } from "./text";

export const Intent = z.enum(["explain", "answer", "ask_kai", "unsure", "off_topic"]);

export type Judgement = {
  intent: z.infer<typeof Intent>;
  facts: { fact: string; verdict: Verdict; quote: string }[];
  termsUsed: string[]; // lexicon terms in the learner's message (computed, not judged)
};

const Reply = z.object({
  intent: Intent,
  facts: z.array(z.object({ fact: z.string(), verdict: Verdict, quote: z.string() })),
});

const norm = (s: string) => s.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();

/** Keep only verdicts on real facts whose quote really is in the learner's message. */
export function checkQuotes(bundle: Bundle, message: string, facts: Judgement["facts"]): Judgement["facts"] {
  const ids = new Set(bundle.nodes.filter((n) => n.kind === "core").flatMap((n) => n.facts.map((f) => f.id)));
  const msg = norm(message);
  const seen = new Set<string>();
  return facts.filter((v) => {
    if (!ids.has(v.fact) || seen.has(v.fact)) return false;
    const q = norm(v.quote);
    if (q.length < 3 || !msg.includes(q)) return false;
    seen.add(v.fact);
    return true;
  });
}

export function termsUsed(bundle: Bundle, message: string): string[] {
  return bundle.nodes.flatMap((n) => n.lexicon.filter((t) => hasTerm(message, t)));
}

const SYSTEM = `You check what a student teacher has just explained to a classmate. You get a numbered list of facts from the lesson and the teacher's latest message.

For every fact the message explains, return:
- verdict: "correct" if the message states it (any wording, informal is fine, the core idea must be right); "partial" if it states only part of it or stays vague; "wrong" if it states something that contradicts it.
- quote: the exact words from the teacher's message that state it, copied character for character (at most 25 words).
Only include facts the message actually addresses. Most messages address 0–3 facts.

intent: "explain" (teaching), "answer" (replying to the classmate's question), "ask_kai" (asking the classmate a question), "unsure" (saying they don't know), "off_topic".`;

export async function llmJudge(bundle: Bundle, message: string, kaiLast: string): Promise<Judgement> {
  const facts = bundle.nodes.filter((n) => n.kind === "core").flatMap((n) => n.facts.map((f) => `${f.id}: ${f.text}`));
  const r = await chatJson({
    model: MODELS.judge,
    name: "judgement",
    schema: Reply,
    maxTokens: 900,
    messages: [
      { role: "system", content: SYSTEM },
      {
        role: "user",
        content: `Facts:\n${facts.join("\n")}\n\nThe classmate (Kai) had just said: "${kaiLast.slice(0, 600)}"\n\nThe teacher's message:\n"""${message}"""`,
      },
    ],
  });
  return { intent: r.data.intent, facts: checkQuotes(bundle, message, r.data.facts), termsUsed: termsUsed(bundle, message) };
}

/**
 * Offline stand-in for demo mode. A fact counts as explained when the message
 * shares enough of the fact's distinctive words (weighted by how rare each
 * word is across all facts, so "arm" or "restaurant" alone don't count):
 * 40% or more is "correct", 22% or more is "partial".
 */
export function mockJudge(bundle: Bundle, message: string): Judgement {
  const lower = message.toLowerCase();
  const intent: Judgement["intent"] = /\b(don'?t know|not sure|no idea|idk)\b/.test(lower)
    ? "unsure"
    : message.trim().endsWith("?")
      ? "ask_kai"
      : "explain";
  const idf = idfFor(bundle);
  const got = new Set(tokens(message));
  const facts: Judgement["facts"] = [];
  for (const n of bundle.nodes.filter((x) => x.kind === "core"))
    for (const f of n.facts) {
      const ref = new Set(tokens(f.text + " " + n.lexicon.join(" ")));
      let have = 0;
      let all = 0;
      for (const t of ref) {
        const w = idf.get(t) ?? 1;
        all += w;
        if (got.has(t)) have += w;
      }
      const share = all ? have / all : 0;
      if (share >= 0.4) facts.push({ fact: f.id, verdict: "correct", quote: clip(message) });
      else if (share >= 0.22) facts.push({ fact: f.id, verdict: "partial", quote: clip(message) });
    }
  return { intent, facts: checkQuotes(bundle, message, facts), termsUsed: termsUsed(bundle, message) };
}

const idfCache = new WeakMap<Bundle, Map<string, number>>();
function idfFor(bundle: Bundle): Map<string, number> {
  const hit = idfCache.get(bundle);
  if (hit) return hit;
  const docs = bundle.nodes.filter((n) => n.kind === "core").flatMap((n) => n.facts.map((f) => new Set(tokens(f.text + " " + n.lexicon.join(" ")))));
  const df = new Map<string, number>();
  for (const d of docs) for (const t of d) df.set(t, (df.get(t) ?? 0) + 1);
  const idf = new Map([...df].map(([t, n]) => [t, Math.log(1 + docs.length / n)]));
  idfCache.set(bundle, idf);
  return idf;
}

/** The message itself, cut at a word boundary if it is long (still a substring, so it passes the quote check). */
function clip(message: string, max = 240): string {
  const m = message.trim();
  if (m.length <= max) return m;
  const cut = m.slice(0, max);
  return cut.slice(0, Math.max(cut.lastIndexOf(" "), 40)).trimEnd();
}
