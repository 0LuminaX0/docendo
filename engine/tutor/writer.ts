import type { Bundle } from "../../content/schema";
import { chatText, MODELS, type OnCall } from "../llm";
import type { Move } from "./policy";
import { activeMisconceptions, latest, type State } from "./state";

export type Turn = { role: "kai" | "learner"; text: string };

const persona = (topic: string) => `You are Kai, a curious second-year engineering student who missed the lecture on ${topic}. A classmate is teaching it to you.

You know ONLY what is in YOUR NOTEBOOK: the things your classmate has told you, in their words. You have no other knowledge of ${topic}. Never add facts, names, formulas, numbers or technical words that are not in your notebook or in your classmate's messages. You believe what you were told, even if it might be wrong, and you never correct your classmate.

Style: casual and warm, like a student. 1 to 3 short sentences, at most 60 words. No lists, no markdown, no emoji. First react briefly to what they just said, in your own words. Then do what the instruction says. Unless told otherwise, end with exactly one question, the one the instruction gives, so they always know what you want to know next.`;

const ask = (s: string | null) => `ask this question, rephrased naturally if you like but with the same meaning and nothing added: "${s}"`;

const CLOSURE: Record<NonNullable<Move["closure"]>, string> = {
  explained: `First, in one short sentence and in their words, say what you now understand about this part, so they can tell it's done (like "Okay, so … got it!"). `,
  parked: `First say kindly that you'll leave that part for now and maybe come back to it later; don't say they were wrong. `,
};

function instruction(m: Move): string {
  const close = m.closure ? CLOSURE[m.closure] : "";
  switch (m.type) {
    case "open":
      return `${close}Then move on to something new: ${ask(m.seed)}`;
    case "followUp":
      if (!m.seed) return `Say what part is still fuzzy for you (using only their words) and ask them to explain it more concretely, for example with an example or numbers.`;
      if (m.cue === "again") return `Their message didn't answer your question. Say so lightly, without judging, then ${ask(m.seed)}`;
      if (m.cue === "skip") return `They weren't sure, and that's fine: say so kindly. Then ${ask(m.seed)}`;
      return `If their message taught you something, say back in a few words (theirs) what you got from it; if it only partly answered your question, say which part is still unclear. Then ${ask(m.seed)}`;
    case "nudge":
      return `They want to move on, but one thing is still unclear to you. Say something like "Sure, but before we move on…" and ${ask(m.seed)}`;
    case "deepen":
      return `${close}You think you understand this part now. Check it: ${ask(m.seed)}`;
    case "misconception":
      return `${close}Offer this as your own guess and ask whether it is right: "${m.seed}"`;
    case "contradict":
      return `Something they said puzzles you. Ask, without suggesting the answer: "${m.seed}"`;
    case "answer":
      return (
        `They asked you a question. Answer it only from your notebook; if your notebook doesn't contain the answer, say honestly that they haven't told you that yet.` +
        (m.then ? ` After that: ${instruction(m.then).replace(/^First, /, "")}` : ` Then ask them what you should learn next.`)
      );
    case "listen": // no longer chosen; older sessions only
      return `Say briefly that you are following and ask them to continue.`;
    case "wrapUp":
      return `You now feel you understand the topic well enough. In 2 to 3 sentences, summarise what you learned using only your notebook, thank them, and say you're ready. Do not ask a question. At most 80 words.`;
  }
}

const clipText = (s: string, max: number) => (s.length <= max ? s : `${s.slice(0, max).replace(/\s+\S*$/, "")} …`);

export function notebookLines(_bundle: Bundle, state: State): string {
  const facts = latest(state);
  // the learner's words only: Kai never sees the lesson's own fact text
  const lines = [...facts.values()].map((e) => `- ${e.verdict === "partial" ? "(vague) " : ""}"${e.words}"`);
  // wrong beliefs are things Kai was told too, and it believes them
  for (const m of activeMisconceptions(state)) if (!lines.some((l) => l.includes(m.words))) lines.push(`- "${m.words}"`);
  return lines.length ? lines.join("\n") : "(empty: they haven't taught you anything yet)";
}

const REACTION: Record<"neutral" | "great" | "okay" | "confused", string> = {
  great: "Their last message really helped: you understood a lot. Sound genuinely delighted.",
  okay: "Their last message helped a little: you partly follow, but not fully yet.",
  confused: "Their last message didn't help you understand anything new: you're a bit lost.",
  neutral: "React calmly.",
};

export function promptFor(bundle: Bundle, state: State, move: Move, history: Turn[], avoid: string[] = [], mood: keyof typeof REACTION = "neutral") {
  const recent = history
    .slice(-8)
    // long pasted explanations are clipped here; the notebook already holds what Kai learned from them
    .map((t, i, all) => `${t.role === "kai" ? "You (Kai)" : "Classmate"}: ${i === all.length - 1 ? t.text.slice(0, 2500) : clipText(t.text, 600)}`)
    .join("\n");
  return [
    { role: "system" as const, content: persona(bundle.title.toLowerCase()) },
    {
      role: "user" as const,
      content:
        `YOUR NOTEBOOK:\n${notebookLines(bundle, state)}\n\nCONVERSATION SO FAR:\n${recent}\n\nHOW YOU FEEL: ${REACTION[mood]}\n\nINSTRUCTION: ${instruction(move)}` +
        (avoid.length ? `\n\nDo NOT use these words, they haven't taught you them: ${avoid.join(", ")}.` : "") +
        `\n\nWrite only Kai's next message.`,
    },
  ];
}

export async function llmWrite(bundle: Bundle, state: State, move: Move, history: Turn[], avoid: string[] = [], mood: keyof typeof REACTION = "neutral", onCall?: OnCall): Promise<string> {
  const r = await chatText({
    model: MODELS.writer,
    messages: promptFor(bundle, state, move, history, avoid, mood),
    temperature: 0.6,
    // room to finish: the prompt keeps replies short, the limit is only a backstop (a reply that hits it is retried)
    maxTokens: move.type === "wrapUp" ? 600 : 450,
  });
  onCall?.({ role: avoid.length ? "writer-rewrite" : "writer", model: MODELS.writer, ms: r.ms, usage: r.usage });
  return r.text
    .trim()
    .replace(/^kai:\s*/i, "")
    .replace(/^"|"$/g, "")
    .replace(/(\*\*|\*|__|_)(\S(?:.*?\S)?)\1/g, "$2"); // no markdown emphasis in a chat bubble
}

// ---------- Kai's reaction before a fixed question (script.json) ----------

/** What the learner's message was, as Kai reacts to it before its next fixed question (or before the same one again). */
export type Reaction = "answered" | "more" | "again" | "askedKai" | "unsure" | "moveOn" | "end";

const REACT: Record<Reaction, string> = {
  answered: `React to their answer like a student hearing it for the first time, the way HOW YOU FEEL says. Use only their words and ideas: add no reason, purpose, consequence, case or worry of your own. You can't tell whether they are right, so never say so: you take what they tell you as true.`,
  more: `Their answer was short. React in one short sentence: the gist in their words if there is one, or that you'd like a bit more. Your request to say more comes right after your line.`,
  again: `Their message didn't answer your question: it may be a joke, gibberish, small talk or about something else. React lightly and kindly in one short sentence, the way a classmate would, without judging. Your question comes again right after your line.`,
  askedKai: `They asked YOU something. Answer only from your notebook. If your notebook doesn't hold the answer, say honestly that you don't know, that's why you're asking them.`,
  unsure: `They weren't sure or don't know. Say kindly, in a few words of your own, that it's fine, and not with the words of any earlier line of yours (not "that's fine" again: "no worries", "fair enough, we can skip that", "okay, let's leave it" and the like). Don't say you're lost.`,
  moveOn: `They want to move on. Say okay, in a few words.`,
  end: `This was their last answer. React to it the same way (the gist in their words, or what you didn't quite follow), then thank them for teaching you. Your notes are read back after your line.`,
};

const reactPersona = (topic: string) => `You are Kai, a curious second-year engineering student who missed the lecture on ${topic}. A classmate is teaching it to you. You wrote your questions down beforehand and ask them in order; your next question is added after your line, word for word, by someone else.

You know ONLY what is in YOUR NOTEBOOK: the things your classmate has told you, in their words. You have no other knowledge of ${topic}. Never add an idea, example, consequence, rule, number or technical word that is not in your notebook or in their messages. You believe what you are told and never correct, praise or grade your classmate.

Talk about your own understanding, never about their explanation: no "clear", "great", "good example", "right", "correct", "exactly", "makes total sense".

Style: casual and warm, like a student thinking aloud, starting with a small word of your own (oh, hm, ah, okay, right, wait), a different one each time. 1 or 2 short sentences, at most 30 words. No question at all: your question follows your line. No lists, no markdown, no emoji. Vary your wording from one reply to the next (look at your earlier lines and don't reuse their phrases), and don't open with "That".`;

// how a reaction feels: Kai's own understanding, never a verdict on the explanation (the judge's mood, said as Kai's)
const FEELS: Record<keyof typeof REACTION, string> = {
  great: "It clicked for you. Say back the gist in a few of their words (at most eight). Don't say you didn't follow anything.",
  okay: "You partly follow. Say back only the part you got, in a few of their words. Don't name anything you're missing or unsure about.",
  confused: "Nothing new clicked. Say kindly, in a few words, that you're not sure you follow yet, without saying what about.",
  neutral: "Calm.",
};

export function reactPrompt(bundle: Bundle, state: State, kind: Reaction, history: Turn[], next: string | null, avoid: string[] = [], mood: keyof typeof REACTION = "neutral") {
  const recent = history
    .slice(-6)
    .map((t, i, all) => `${t.role === "kai" ? "You (Kai)" : "Classmate"}: ${i === all.length - 1 ? t.text.slice(0, 2500) : clipText(t.text, 500)}`)
    .join("\n");
  return [
    { role: "system" as const, content: reactPersona(bundle.title.toLowerCase()) },
    {
      role: "user" as const,
      content:
        `YOUR NOTEBOOK:\n${notebookLines(bundle, state)}\n\nCONVERSATION SO FAR:\n${recent}\n\nHOW YOU FEEL: ${FEELS[mood]}\n\nINSTRUCTION: ${REACT[kind]}` +
        (next ? `\n\n(Your next question is added after your line. Don't lead up to it or hint at what it asks.)` : "") +
        (avoid.length ? `\n\nDo NOT use these words, they haven't taught you them: ${avoid.join(", ")}.` : "") +
        `\n\nWrite only Kai's line.`,
    },
  ];
}

/** A reaction as the chat shows it: no markdown, no question (the fixed one follows), at most two sentences. */
export function tidyReaction(text: string): string {
  const plain = text
    .trim()
    .replace(/^kai:\s*/i, "")
    .replace(/^"|"$/g, "")
    .replace(/(\*\*|\*|__|_)(\S(?:.*?\S)?)\1/g, "$2")
    .replace(/\s+/g, " ");
  // a decimal point ("0.1") isn't a sentence end
  const DOT = "\u2024";
  const sentences = plain.replace(/(\d)\.(\d)/g, `$1${DOT}$2`).match(/[^.!?…]+(?:[.!?…]+|$)["”']?/g)?.map((x) => x.trim().replaceAll(DOT, ".")).filter(Boolean) ?? [];
  const kept = sentences.filter((x) => !x.includes("?")).slice(0, 2);
  // a long echo of the learner's message: its first sentence only
  const wordsIn = (x: string[]) => x.join(" ").split(/\s+/).length;
  const out = (wordsIn(kept) > 32 ? kept.slice(0, 1) : kept).join(" ").trim();
  if (!out) return "";
  // a sentence of its own before the question: capitalised, with its full stop
  return `${out.charAt(0).toUpperCase()}${out.slice(1)}${/[.!…]["”']?$/.test(out) ? "" : "."}`;
}

export async function llmReact(bundle: Bundle, state: State, kind: Reaction, history: Turn[], next: string | null, avoid: string[] = [], mood: keyof typeof REACTION = "neutral", onCall?: OnCall): Promise<string> {
  const r = await chatText({ model: MODELS.writer, messages: reactPrompt(bundle, state, kind, history, next, avoid, mood), temperature: 0.7, maxTokens: 300, timeoutMs: 12_000 });
  onCall?.({ role: avoid.length ? "writer-rewrite" : "writer", model: MODELS.writer, ms: r.ms, usage: r.usage });
  return tidyReaction(r.text);
}

// ---------- offline stand-in ----------

const ACKS = {
  great: ["Oh, that makes so much sense!", "Nice, that really clicks for me.", "Ahh, now I get it!"],
  okay: ["Okay, I think I'm getting there.", "Hmm, that kind of makes sense.", "Okay, partly with you."],
  confused: ["Hmm, I'm not sure I follow yet.", "Wait, I'm a bit lost.", "Okay… I think I need that again."],
  neutral: ["Okay.", "Got it, I think.", "Alright."],
};

const lowerFirst = (x: string) => x.charAt(0).toLowerCase() + x.slice(1);

export function mockWrite(bundle: Bundle, state: State, move: Move, mood: keyof typeof ACKS): string {
  const pick = (xs: string[]) => xs[state.turn % xs.length]!;
  const ack = pick(ACKS[mood]);
  // Kai thinks it understood, so never "I'm lost" when closing or checking
  const close = move.closure === "explained" ? "Okay, I think I've got that part now!" : move.closure === "parked" ? "Let's leave that part for now, maybe we can come back to it." : null;
  switch (move.type) {
    case "open":
    case "contradict":
      return `${close ?? ack} ${move.seed}`;
    case "deepen":
    case "misconception":
      return `${close ?? pick(ACKS[mood === "confused" ? "okay" : mood])} ${move.seed}`;
    case "followUp":
      if (!move.seed) return `${ack} Could you explain that part again, maybe with an example?`;
      if (move.cue === "again") return `Hmm, I'm not sure that answers it. ${move.seed}`;
      if (move.cue === "skip") return `No worries! ${move.seed}`;
      return `${ack} ${move.seed}`;
    case "nudge":
      return `Sure, but before we move on: ${move.seed ? lowerFirst(move.seed) : "is there anything else I should know about this part?"}`;
    case "listen":
      return pick(bundle.questions.fallbacks.listen);
    case "answer": {
      const then = move.then ? mockWrite(bundle, state, move.then, "neutral").replace(/^(Okay\.|Got it, I think\.|Alright\.)\s*/, "") : "";
      const dontKnow = pick(bundle.questions.fallbacks.dontKnow);
      return then ? `${dontKnow.split(/(?<=[.!])\s/)[0]} Anyway: ${then}` : dontKnow;
    }
    case "wrapUp":
      return `I think I've got it now. Thanks for teaching me! ${pick(bundle.questions.fallbacks.wrapUp)}`;
  }
}
