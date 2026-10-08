import { z } from "zod";
import type { Bundle } from "../../content/schema";
import { hasTerm } from "../../content/terms";
import { chatJson, MODELS, type OnCall } from "../llm";
import { Verdict } from "./state";
import { tokens } from "./text";

export const Intent = z.enum(["explain", "answer", "ask_kai", "unsure", "move_on", "off_topic"]);

export type Judgement = {
  intent: z.infer<typeof Intent>;
  facts: { fact: string; verdict: Verdict; quote: string }[];
  termsUsed: string[]; // lexicon terms in the learner's message (computed, not judged)
  dropped?: { fact: string; quote: string }[]; // verdicts thrown out by the quote check (for logs)
};

// the fact field may only hold real ids, so the model can't return "n01.f1: <text>"
const replyCache = new WeakMap<Bundle, z.ZodType<{ intent: z.infer<typeof Intent>; facts: Judgement["facts"] }>>();
function replySchema(bundle: Bundle) {
  const hit = replyCache.get(bundle);
  if (hit) return hit;
  const ids = bundle.nodes.filter((n) => n.kind === "core").flatMap((n) => n.facts.map((f) => f.id));
  const schema = z.object({ intent: Intent, facts: z.array(z.object({ fact: z.enum(ids as [string, ...string[]]), verdict: Verdict, quote: z.string() })) });
  replyCache.set(bundle, schema);
  return schema;
}

const norm = (s: string) => s.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();

/** Keep only verdicts on real facts whose quote really is in the learner's message. */
export function checkQuotes(bundle: Bundle, message: string, facts: Judgement["facts"]): Judgement["facts"] {
  return screenQuotes(bundle, message, facts).kept;
}

export function screenQuotes(bundle: Bundle, message: string, facts: Judgement["facts"]) {
  const ids = new Set(bundle.nodes.filter((n) => n.kind === "core").flatMap((n) => n.facts.map((f) => f.id)));
  const seen = new Set<string>();
  const kept: Judgement["facts"] = [];
  const dropped: { fact: string; quote: string }[] = [];
  for (const raw of facts) {
    // tolerate an id with its text attached ("n01.f1: …")
    const v = { ...raw, fact: /^\s*([a-z]+\d+\.f\d+)\b/i.exec(raw.fact)?.[1] ?? raw.fact };
    if (seen.has(v.fact)) continue;
    if (!ids.has(v.fact)) {
      dropped.push({ fact: v.fact.slice(0, 40), quote: "(unknown fact id)" });
      continue;
    }
    const quote = findQuote(message, v.quote);
    if (!quote) {
      dropped.push({ fact: v.fact, quote: v.quote.slice(0, 200) });
      continue;
    }
    seen.add(v.fact);
    kept.push({ ...v, quote });
  }
  return { kept, dropped };
}

/**
 * The learner's own words behind a quote, or null. Exact (ignoring case and
 * punctuation) is accepted as is. A slightly misquoted one (a word dropped or
 * changed) is accepted when at least 80% of its words, and at least 3, appear
 * in the message in the same order and close together; Kai then keeps the
 * matching stretch of the learner's message, never the judge's version.
 */
export function findQuote(message: string, quote: string): string | null {
  const q = norm(quote);
  if (q.length < 3) return null;
  if (norm(message).includes(q)) return quote;
  const words = [...message.matchAll(/[\p{L}\p{N}]+/gu)];
  const mw = words.map((w) => w[0].toLowerCase());
  const qw = q.split(" ");
  if (qw.length < 3 || !mw.length) return null;
  // longest common subsequence of words, remembering where each match falls in the message
  const L = Array.from({ length: qw.length + 1 }, () => new Array<number>(mw.length + 1).fill(0));
  for (let i = qw.length - 1; i >= 0; i--)
    for (let k = mw.length - 1; k >= 0; k--) L[i]![k] = qw[i] === mw[k] ? 1 + L[i + 1]![k + 1]! : Math.max(L[i + 1]![k]!, L[i]![k + 1]!);
  if (L[0]![0]! < Math.ceil(0.8 * qw.length)) return null;
  const hits: number[] = [];
  for (let i = 0, k = 0; i < qw.length && k < mw.length; ) {
    if (qw[i] === mw[k]) (hits.push(k), i++, k++);
    else if (L[i + 1]![k]! >= L[i]![k + 1]!) i++;
    else k++;
  }
  const first = hits[0]!;
  const last = hits[hits.length - 1]!;
  if (last - first + 1 > qw.length * 2 + 4) return null; // matched words scattered across the message
  return message.slice(words[first]!.index, words[last]!.index + words[last]![0].length);
}

export function termsUsed(bundle: Bundle, message: string): string[] {
  return bundle.nodes.flatMap((n) => n.lexicon.filter((t) => hasTerm(message, t)));
}

const SYSTEM = `You check what a student teacher has just explained to a classmate. You get a numbered list of facts from the lesson, what the classmate last said, and the teacher's latest message.

For every fact the message explains, return:
- fact: its id only, e.g. "n03.f2".
- verdict: "correct" if the message gets the idea across. Be generous: informal wording, an analogy, a worked example or a short answer to the classmate's question all count, as long as the core idea is right. "partial" only if a key part of the fact is missing or it is too vague to tell. "wrong" if it says something that contradicts the fact.
- quote: the exact words from the teacher's message that state it, copied character for character (at most 25 words). A short reply like "no, only the one you picked" is read in the light of the classmate's question, but the quote must still come from the teacher's message.
Only include facts the message actually addresses. Most messages address 0–3 facts.

intent: "explain" (teaching), "answer" (replying to the classmate's question), "ask_kai" (asking the classmate a question), "unsure" (saying they don't know), "move_on" (asking to move on or saying they're done with this part, e.g. "what's next?", "that's it", "next one"), "off_topic" (anything else, including chit-chat and messages that make no sense).`;

export async function llmJudge(bundle: Bundle, message: string, kaiLast: string, onCall?: OnCall): Promise<Judgement> {
  const facts = bundle.nodes.filter((n) => n.kind === "core").flatMap((n) => n.facts.map((f) => `[${f.id}] ${f.text}`));
  const r = await chatJson({
    model: MODELS.judge,
    name: "judgement",
    schema: replySchema(bundle),
    maxTokens: 900,
    messages: [
      { role: "system", content: SYSTEM },
      {
        role: "user",
        content: `Facts:\n${facts.join("\n")}\n\nThe classmate (Kai) had just said: "${kaiLast.slice(0, 600)}"\n\nThe teacher's message:\n"""${message}"""`,
      },
    ],
  });
  onCall?.({ role: "judge", model: MODELS.judge, ms: r.ms, usage: r.usage });
  const { kept, dropped } = screenQuotes(bundle, message, r.data.facts);
  return { intent: r.data.intent, facts: kept, dropped, termsUsed: termsUsed(bundle, message) };
}

/**
 * Offline stand-in for demo mode. A fact counts as explained when the message
 * shares enough of the fact's distinctive words (weighted by how rare each
 * word is across all facts, so "arm" or "restaurant" alone don't count):
 * 40% or more is "correct", 22% or more is "partial".
 */
export function mockJudge(bundle: Bundle, message: string): Judgement {
  const lower = message.toLowerCase();
  const idf = idfFor(bundle);
  const lessonWords = tokens(message).filter((t) => idf.has(t)).length;
  const intent: Judgement["intent"] = /\b(don'?t know|not sure|no idea|idk)\b/.test(lower)
    ? "unsure"
    : /\b(what'?s next|what next|next (one|topic|idea|thing|question)|that'?s (it|all)|move on|skip( it| this)?|let'?s continue|keep going)\b/.test(lower) && lessonWords < 3
      ? "move_on"
      : message.trim().endsWith("?")
        ? "ask_kai"
        : lessonWords === 0
          ? "off_topic"
          : "explain";
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
