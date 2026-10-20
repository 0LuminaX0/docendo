import { z } from "zod";
import type { Bundle } from "../../content/schema";
import { hasTerm } from "../../content/terms";
import { chatJson, MODELS, type OnCall } from "../llm";
import { Verdict } from "./state";
import { tokens } from "./text";
import { annotate, type Refusal } from "./notes";

export const Intent = z.enum(["explain", "answer", "ask_kai", "unsure", "move_on", "off_topic"]);

export type Judgement = {
  intent: z.infer<typeof Intent>;
  // note: the point as a whole sentence around the learner's words (null when the judge gave none or it failed the check)
  facts: { fact: string; verdict: Verdict; quote: string; note?: string | null }[];
  // wrong beliefs the learner stated, open-ended (no fixed list); `belief` is the judge's summary, for the log only
  misconceptions?: { node: string; quote: string; belief: string; note?: string | null }[];
  termsUsed: string[]; // lexicon terms in the learner's message (computed, not judged)
  dropped?: { fact: string; quote: string }[]; // verdicts thrown out by the quote check (for logs)
  notesDropped?: { quote: string; note: string; why: string }[]; // whole-sentence notes the note check refused (for logs)
};

// before/after: the few words the model puts around the quote; code assembles the note (notes.ts), so the quote is verbatim
type Around = { before?: string; after?: string };
type Reply = { claims?: string[]; intent: z.infer<typeof Intent>; facts: (Judgement["facts"][number] & Around)[]; misconceptions?: (NonNullable<Judgement["misconceptions"]>[number] & Around)[] };

// the fact and node fields may only hold real ids, so the model can't return "n01.f1: <text>"
const replyCache = new WeakMap<Bundle, z.ZodType<Reply>>();
function replySchema(bundle: Bundle) {
  const hit = replyCache.get(bundle);
  if (hit) return hit;
  const core = bundle.nodes;
  const ids = core.flatMap((n) => n.facts.map((f) => f.id));
  const nodes = core.map((n) => n.id);
  const schema = z.object({
    // first, the message split into its separate claims: makes the model weigh each one (log only)
    claims: z.array(z.string()),
    intent: Intent,
    facts: z.array(z.object({ fact: z.enum(ids as [string, ...string[]]), verdict: Verdict, quote: z.string(), before: z.string(), after: z.string() })),
    misconceptions: z.array(z.object({ node: z.enum(nodes as [string, ...string[]]), quote: z.string(), belief: z.string(), before: z.string(), after: z.string() })).optional(),
  });
  replyCache.set(bundle, schema);
  return schema;
}

/** Keep misconceptions about real ideas whose quote is in the message, in the learner's words. */
export function screenMisconceptions(bundle: Bundle, message: string, list: (NonNullable<Judgement["misconceptions"]>[number] & Around)[]) {
  const nodes = new Set(bundle.nodes.map((n) => n.id));
  const kept: (NonNullable<Judgement["misconceptions"]>[number] & Around)[] = [];
  const dropped: { fact: string; quote: string }[] = [];
  for (const m of list.slice(0, 6)) {
    const quote = nodes.has(m.node) ? findQuote(message, m.quote) : null;
    if (!quote) {
      dropped.push({ fact: `${m.node.slice(0, 12)} (misconception)`, quote: m.quote.slice(0, 200) });
      continue;
    }
    if (!kept.some((k) => k.node === m.node && k.quote === quote)) kept.push({ ...m, quote, belief: m.belief.slice(0, 300) });
  }
  return { kept, dropped };
}

const norm = (s: string) => s.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();

/** Keep only verdicts on real facts whose quote really is in the learner's message, each with Kai's note for it. */
export function checkQuotes(bundle: Bundle, message: string, facts: (Judgement["facts"][number] & Around)[]): Judgement["facts"] {
  return screenQuotes(bundle, message, facts).kept.map((v) => withNote(bundle, v, message, ""));
}

export function screenQuotes(bundle: Bundle, message: string, facts: (Judgement["facts"][number] & Around)[]) {
  const ids = new Set(bundle.nodes.flatMap((n) => n.facts.map((f) => f.id)));
  const seen = new Set<string>();
  const kept: (Judgement["facts"][number] & Around)[] = [];
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

/** One verdict or misconception with Kai's note in place of the judge's raw words around its quote (notes.ts). */
function withNote<T extends { quote: string; note?: string | null } & Around>(bundle: Bundle, v: T, message: string, kaiLast: string, others: { quote: string }[] = [], refused?: (r: Refusal) => void) {
  const { before: _b, after: _a, ...rest } = v;
  return { ...rest, ...annotate(bundle, v, message, kaiLast, others, refused) };
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

First, claims: split the teacher's message into its separate claims (each a short phrase in their words). Then judge each claim: a right one is a fact below, a wrong one a misconception, anything else nothing.

For every fact the message explains, return:
- fact: its id only, e.g. "n03.f2".
- verdict: "correct" if the message gets the idea across. Be generous: informal wording, an analogy, a worked example or a short answer to the classmate's question all count, as long as the core idea is right. "partial" only if a key part of the fact is missing or it is too vague to tell. "wrong" if it says something that contradicts the fact.
- quote: the exact words from the teacher's message that state it, copied character for character (at most 25 words). A short reply like "no, only the one you picked" is read in the light of the classmate's question, but the quote must still come from the teacher's message.
- before, after: the classmate writes the quote into their notebook, and it must still make sense when read alone later. So give the few words that go before and after the quote to make it one whole sentence (code puts them together: before + quote + after). Add only what the quote leaves implicit, taken from the classmate's question or the rest of the teacher's message: what "it" or "they" stands for, what the quote answers. Usually 2 to 8 words, often only before. Fill them whenever the quote doesn't say what it is about: it starts with "it", "they", "with", "and", a verb ("picks the…"), or it continues a sentence that began earlier in the message. Never add an idea, a term or a number the teacher didn't say, never use the wording of the facts above, and don't correct or improve the quote. If the quote already reads as a whole statement that names its subject, leave both empty. Never repeat the quote's words in before or after.
  Examples. Classmate: "So what does greedy keep track of for each truck?" Teacher: "you store its average" → before "For each truck greedy tries,", after "". Classmate: "Does greedy ever go back to a truck that looked bad at first?" Teacher: "nope, never" → before "Going back to a truck that looked bad at first, for greedy:", after "". Teacher: "and never tries the others again" (earlier in the message: "Greedy always goes to the best average") → before "Greedy", after "".
A short "no" or "nope" counts when it clearly answers the classmate's question as asked ("nope, never" to "would I ever go back?"). When it only says they don't know ("nope, no idea", "not this either", "me neither" after an "I don't know"), it is "unsure": credit nothing for it.
Only include facts the message actually addresses. Most messages address 0–3 facts.
Credit every fact the message explains, whether or not it answers what the classmate just asked: teachers often move on to another idea, and that still counts.
A message often mixes a right part and a wrong part, e.g. "UCB adds a bonus to each average and picks the highest total, and the bonus grows every time you pick it": credit the right part as "correct" for its fact (quoting just that part) and record the wrong part under misconceptions. A wrong part never cancels a right one.

misconceptions: every belief in the message that is wrong about the topic, whether or not it contradicts one of the listed facts. Misconceptions are not limited to a list; record whatever the teacher gets wrong. For each:
- node: the id of the idea it is about, e.g. "n07" (the part before the dot in the fact ids).
- quote: the exact words from the teacher's message that state it, copied character for character (at most 25 words).
- belief: one short sentence saying what the teacher believes, e.g. "exploring never picks the current favourite". Don't state the correct version.
- before, after: as for facts: the few words around the quote that make it one sentence that makes sense alone, only from the classmate's question or the message (it stays wrong: don't fix it).
Leave the list empty when nothing is wrong. Vague or incomplete is not wrong.

intent, the main thing the message does:
- "explain": teaching something on their own initiative.
- "answer": replying to what the classmate just asked (even a short "no, only the one you picked"); prefer this over "explain" when the message answers Kai's question.
- "ask_kai": asking the classmate a question, e.g. "Is this like the slot machines in a casino?", "What do you think greedy does?". Any message that is mainly a question to Kai is "ask_kai", even if it's about something new.
- "unsure": saying they don't know or aren't sure ("idk", "no idea", "not this either", "me neither", "nope, no clue"), also when it starts with "no" or "nope": a "no" that only says they don't know is not an answer to the classmate's question.
- "move_on": asking to move on or saying they're done with this part ("what's next?", "that's it", "next one").
- "off_topic": chit-chat, or messages that make no sense. Never use it for a question to Kai.`;

export async function llmJudge(bundle: Bundle, message: string, kaiLast: string, onCall?: OnCall, limits: { timeoutMs?: number; retries?: number } = {}): Promise<Judgement> {
  const facts = bundle.nodes.flatMap((n) => n.facts.map((f) => `[${f.id}] ${f.text}`));
  const r = await chatJson({
    model: MODELS.judge,
    name: "judgement",
    schema: replySchema(bundle),
    maxTokens: 1200,
    timeoutMs: limits.timeoutMs ?? 15_000, // two tries of 15 s plus the writer's 25 s stay under the chat route's 60 s
    retries: limits.retries ?? 1,
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
  const mis = screenMisconceptions(bundle, message, r.data.misconceptions ?? []);
  // what Kai writes down for each: the learner's words, made a statement that stands alone (notes.ts)
  const notesDropped: Refusal[] = [];
  const credited = kept.map((v) => withNote(bundle, v, message, kaiLast, mis.kept, (x) => notesDropped.push(x)));
  const beliefs = mis.kept.map((m) => withNote(bundle, m, message, kaiLast, kept, (x) => notesDropped.push(x)));
  return consistent({ intent: r.data.intent, facts: credited, misconceptions: beliefs, dropped: [...dropped, ...mis.dropped], notesDropped, termsUsed: termsUsed(bundle, message) });
}

// intents that say the message teaches nothing: "I don't know", chit-chat, "what's next?"
const NOT_TEACHING = new Set<Judgement["intent"]>(["unsure", "off_topic", "move_on"]);

/**
 * One reading of a message, not two: one the judge classes as "I don't know", off-topic or "move on" can't also
 * explain a fact or state a misconception. Its verdicts are dropped (and logged), so Kai's reply ("let's leave that
 * part") and Kai's notebook and mind agree. The judge once read "nope, not this either" (after "i dunno") as unsure
 * and, at the same time, as a right answer to Kai's yes/no question.
 */
export function consistent(j: Judgement): Judgement {
  if (!NOT_TEACHING.has(j.intent) || (!j.facts.length && !j.misconceptions?.length)) return j;
  const why = `(dropped: the message is ${j.intent.replace("_", " ")})`;
  return {
    ...j,
    facts: [],
    misconceptions: [],
    dropped: [...(j.dropped ?? []), ...j.facts.map((v) => ({ fact: v.fact, quote: `${v.quote.slice(0, 160)} ${why}` })), ...(j.misconceptions ?? []).map((m) => ({ fact: `${m.node} (misconception)`, quote: `${m.quote.slice(0, 160)} ${why}` }))],
  };
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
  const intent: Judgement["intent"] = /\b(don'?t know|dunno|not sure|no idea|no clue|idk|not this either|me neither)\b/.test(lower)
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
  for (const n of bundle.nodes)
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
  return consistent({ intent, facts: checkQuotes(bundle, message, facts), termsUsed: termsUsed(bundle, message) });
}

const idfCache = new WeakMap<Bundle, Map<string, number>>();
function idfFor(bundle: Bundle): Map<string, number> {
  const hit = idfCache.get(bundle);
  if (hit) return hit;
  const docs = bundle.nodes.flatMap((n) => n.facts.map((f) => new Set(tokens(f.text + " " + n.lexicon.join(" ")))));
  const df = new Map<string, number>();
  for (const d of docs) for (const t of d) df.set(t, (df.get(t) ?? 0) + 1);
  const idf = new Map([...df].map(([t, n]) => [t, Math.log(1 + docs.length / n)]));
  idfCache.set(bundle, idf);
  return idf;
}

/**
 * The message itself, cut if it is long: at the last sentence end that fits, else at a word boundary (still a
 * substring, so it passes the quote check, and Kai's note doesn't stop mid-sentence where it can be helped).
 */
export function clip(message: string, max = 240): string {
  const m = message.trim();
  if (m.length <= max) return m;
  const cut = m.slice(0, max);
  const sentence = Math.max(...[". ", "! ", "? ", "\n"].map((e) => cut.lastIndexOf(e)));
  if (sentence >= 60) return cut.slice(0, sentence + 1).trimEnd();
  return cut.slice(0, Math.max(cut.lastIndexOf(" "), 40)).trimEnd();
}
