import type { Bundle } from "../../content/schema";
import { chatText, MODELS } from "../llm";
import type { Move } from "./policy";
import { latest, type State } from "./state";

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

export function notebookLines(_bundle: Bundle, state: State): string {
  const facts = latest(state);
  if (!facts.size) return "(empty: they haven't taught you anything yet)";
  // the learner's words only: Kai never sees the lesson's own fact text
  return [...facts.values()].map((e) => `- ${e.verdict === "partial" ? "(vague) " : ""}"${e.words}"`).join("\n");
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
    .map((t) => `${t.role === "kai" ? "You (Kai)" : "Classmate"}: ${t.text}`)
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

export async function llmWrite(bundle: Bundle, state: State, move: Move, history: Turn[], avoid: string[] = [], mood: keyof typeof REACTION = "neutral"): Promise<string> {
  const r = await chatText({
    model: MODELS.writer,
    messages: promptFor(bundle, state, move, history, avoid, mood),
    temperature: 0.6,
    maxTokens: move.type === "wrapUp" ? 260 : 180,
  });
  return r.text
    .trim()
    .replace(/^kai:\s*/i, "")
    .replace(/^"|"$/g, "")
    .replace(/(\*\*|\*|__|_)(\S(?:.*?\S)?)\1/g, "$2"); // no markdown emphasis in a chat bubble
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
