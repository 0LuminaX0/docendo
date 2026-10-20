import type { Bundle } from "../../content/schema";
import { hasTerm } from "../../content/terms";

// What Kai writes down for a quote the judge credited (or recorded as a misconception): a statement that still makes
// sense when read alone later, in the learner's own words wherever possible. In this order:
//   1. a quote that stands alone is the note as it is;
//   2. a fragment becomes the learner's whole sentence around it (their words only);
//   3. a fragment that only leans on a leading "and"/"so" loses that word;
//   4. otherwise (a short answer to Kai's question, nothing more in the message) the judge's few words before and
//      after are put around the quote, kept only if they add nothing the learner or Kai's question didn't say.
// The judge proposes, code decides: asked to write whole notes, the judge paraphrased the lesson's fact text.

export type Annotated = { quote: string; note: string | null }; // quote: the learner's words; note: with Kai's words around
export type Refusal = { quote: string; note: string; why: string };

export const norm = (s: string) => s.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
const firstWord = (s: string) => (s.trim().split(/\s+/)[0] ?? "").toLowerCase().replace(/[^\p{L}']/gu, "");
const indexIn = (text: string, part: string) => text.toLowerCase().indexOf(part.trim().toLowerCase());

// first words that make a quote lean on what came before it, wherever it stands
const POINTS_BACK = new Set("it its it's they them their this that that's these those which who and but so because then or nope no yes yeah yep".split(" "));
const JOINS = /^(and|but|so|then|or)\s+/i;
// words added around a quote may use freely: they carry no lesson content
const FREE = new Set(
  "a an the and or but so if then than that this these those it its it's they them their there here is are was were be been being am do does did done has have had having will would can could should may might must shall not no yes never always only just also too very more most less least each every all any some one two first next last same other another such what which who whom whose when where why how because since as at by for from in into of on onto to with without about after before between during over under up down out off again still even ever once you your yours i me my we us our he she him her his says said say tells told tell means mean called call like".split(" "),
);
const MAX_NEW = 2; // content words the added words may bring beyond the learner's message and Kai's question
const MAX_SENTENCE = 240; // a longer sentence around a fragment is too much for one note

/**
 * Does a quote need more to stand alone? When it is short, points back ("it…", "that…", "nope", "and…"), or doesn't
 * begin a sentence of the learner's (it continues one: "picks the truck with…"), however long it is.
 */
export function isFragment(quote: string, message: string): boolean {
  if (quote.trim().split(/\s+/).length < 6 || POINTS_BACK.has(firstWord(quote))) return true;
  const at = indexIn(message, quote);
  return at > 0 && !/[.!?:;\n]["”')]?\s*$/.test(message.slice(0, at));
}

/** The learner's whole sentence around a quote (their words only), or null if there is no more to it. */
export function sentenceAround(message: string, quote: string): string | null {
  const at = indexIn(message, quote);
  if (at < 0) return null;
  const q = quote.trim();
  const start = Math.max(...[".", "!", "?", "\n"].map((c) => message.slice(0, at).lastIndexOf(c))) + 1;
  const rest = message.slice(at + q.length);
  const stop = /[.!?\n]/.exec(rest);
  const end = at + q.length + (stop ? stop.index + (stop[0] === "\n" ? 0 : 1) : rest.length);
  const s = message.slice(start, end).trim();
  return s.length > q.length ? s : null;
}

/** "so you only find out how good a place is" → "You only find out how good a place is." (still the learner's words) */
function withoutJoin(quote: string): string | null {
  const m = JOINS.exec(quote.trim());
  if (!m) return null;
  const rest = quote.trim().slice(m[0].length);
  if (rest.split(/\s+/).length < 6 || POINTS_BACK.has(firstWord(rest))) return null;
  const s = rest.charAt(0).toUpperCase() + rest.slice(1);
  return /[.!?…"”)]$/.test(s) ? s : `${s}.`;
}

/**
 * The judge's words before and after put around the quote (code assembles the sentence, so the quote stays verbatim),
 * or null when they add nothing or repeat the quote. `quote` comes back as it stands in the note (first letter's case).
 */
export function assemble(quote: string, before?: string | null, after?: string | null): { quote: string; note: string } | null {
  const b = (before ?? "").trim().replace(/\s+/g, " ");
  let a = (after ?? "").trim().replace(/\s+/g, " ");
  if (!b && !a) return null;
  // the words around it must not repeat the quote: no three words in a row from it, none of its content words
  const runs = (t: string) => {
    const w = norm(t).split(" ").filter(Boolean);
    return w.slice(0, -2).map((_, i) => w.slice(i, i + 3).join(" "));
  };
  const qRuns = new Set(runs(quote));
  const content = (t: string) => norm(t).split(" ").filter((w) => w && !FREE.has(w));
  const qWords = new Set(content(quote));
  if ([...runs(b), ...runs(a)].some((r) => qRuns.has(r)) || [...content(b), ...content(a)].some((w) => qWords.has(w))) return null;
  if (norm(b).split(" ").pop() === norm(quote).split(" ")[0]) return null;

  let q = quote.trim();
  let front = b;
  if (b) q = q.replace(JOINS, "");
  if (b && !/[.!?:,;]$/.test(b) && /^(it|it's|its|they|their|them|this|that)\b/i.test(q)) front = `${b}:`; // "Greedy: it always…"
  if (/[.!?]$/.test(b)) q = q.charAt(0).toUpperCase() + q.slice(1);
  else if (b && !front.endsWith(":") && /^[A-Z][a-z]/.test(q) && !/^I\b/.test(q)) q = q.charAt(0).toLowerCase() + q.slice(1); // continues the sentence
  if (/^[.!?]+$/.test(a) && /[.!?]$/.test(q)) a = "";
  let note = `${front ? `${front} ` : ""}${q}${a ? (/^[,.;:!?)]/.test(a) ? a : ` ${a}`) : ""}`;
  note = note.charAt(0).toUpperCase() + note.slice(1);
  if (!/[.!?…"”)]$/.test(note)) note += ".";
  const at = indexIn(note, q);
  return { quote: at >= 0 ? note.slice(at, at + q.length) : q, note };
}

/**
 * Whether an assembled note may stand: the learner's words verbatim inside, and around them no lesson term neither
 * the learner nor Kai's question used, no number of its own, nothing new after the quote, at most two new content
 * words before it. Returns the reason it may not, or null.
 */
export function refuse(bundle: Bundle, note: string, quote: string, message: string, kaiLast: string): string | null {
  if (note.length > 300 || note.length > quote.length * 4 + 120) return "too long";
  const at = indexIn(note, quote);
  if (at < 0) return "the learner's words aren't in it verbatim";
  const context = `${message} ${kaiLast}`;
  for (const node of bundle.nodes) for (const t of node.lexicon) if (hasTerm(note, t) && !hasTerm(context, t)) return `a lesson term nobody used: ${t}`;
  const known = new Set(norm(context).split(" "));
  const newIn = (t: string) => norm(t).split(" ").filter((w) => w && !known.has(w));
  const after = newIn(note.slice(at + quote.length)).filter((w) => !FREE.has(w));
  if (after.length) return `adds after the learner's words: ${after.join(" ")}`;
  const added = newIn(note.slice(0, at));
  if (added.some((w) => /\d/.test(w))) return "a number of its own";
  const extra = added.filter((w) => !FREE.has(w));
  return extra.length > MAX_NEW ? `too many new words: ${extra.join(" ")}` : null;
}

/**
 * Kai's note for one quote (see the order at the top). `others`: the quotes of this message recorded the other way
 * (misconceptions beside a right fact, or the reverse): a sentence that would take one in isn't used.
 */
export function annotate(
  bundle: Bundle,
  item: { quote: string; before?: string; after?: string; note?: string | null },
  message: string,
  kaiLast: string,
  others: { quote: string }[] = [],
  refused?: (r: Refusal) => void,
): Annotated {
  const { quote } = item;
  if (!isFragment(quote, message)) return { quote, note: null };
  const s = sentenceAround(message, quote);
  const takesOther = (t: string) => others.some((o) => indexIn(t, o.quote) >= 0 && indexIn(quote, o.quote) < 0);
  if (s && s.length <= MAX_SENTENCE && !takesOther(s)) return { quote: s, note: null };
  const plain = withoutJoin(quote);
  if (plain) return { quote: plain, note: null };
  // the judge's words around the quote (or, from tests and older callers, a whole note given as is)
  const made: { quote: string; note: string } | null = item.before !== undefined || item.after !== undefined ? assemble(quote, item.before, item.after) : item.note ? { quote, note: item.note } : null;
  if (!made) return { quote, note: null };
  // words "added" that the learner wrote right there are theirs: then it is simply their words, no note
  const span = indexIn(message, made.note.replace(/[.!?…]$/, ""));
  if (span >= 0) return { quote: message.slice(span, span + made.note.replace(/[.!?…]$/, "").length), note: null };
  const why = refuse(bundle, made.note, made.quote, message, kaiLast);
  if (why) {
    refused?.({ quote, note: made.note.slice(0, 300), why });
    return { quote, note: null };
  }
  return made;
}
