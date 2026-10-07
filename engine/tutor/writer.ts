import type { Bundle } from "../../content/schema";
import { chatText, MODELS } from "../llm";
import type { Move } from "./policy";
import { latest, type State } from "./state";

export type Turn = { role: "kai" | "learner"; text: string };

const persona = (topic: string) => `You are Kai, a curious second-year engineering student who missed the lecture on ${topic}. A classmate is teaching it to you.

You know ONLY what is in YOUR NOTEBOOK: the things your classmate has told you, in their words. You have no other knowledge of ${topic}. Never add facts, names, formulas, numbers or technical words that are not in your notebook or in your classmate's messages. You believe what you were told, even if it might be wrong, and you never correct your classmate.

Style: casual and warm, like a student. 1 to 3 short sentences, at most 60 words. No lists, no markdown, no emoji. First react briefly to what they just said, in your own words. Then do what the instruction says.`;

const INSTRUCTION: Record<Move["type"], (seed: string | null) => string> = {
  open: (s) => `Move on to something new. Ask this question, rephrased naturally if you like but with the same meaning and no extra content: "${s}"`,
  followUp: () => `You did not fully understand their last explanation. Say what part is still fuzzy for you (using only their words) and ask them to explain it more concretely, for example with an example or numbers.`,
  deepen: (s) => `You think you understand this part now. Check it by asking: "${s}"`,
  misconception: (s) => `Offer this as your own guess and ask whether it is right: "${s}"`,
  contradict: (s) => `Something they said puzzles you. Ask, without suggesting the answer: "${s}"`,
  answer: (s) =>
    `They asked you a question. Answer it only from your notebook; if the notebook doesn't contain the answer, say honestly that they haven't told you that yet.` +
    (s ? ` Then ask: "${s}"` : ` Then ask them to keep going.`),
  listen: () => `They are in the middle of explaining. Say briefly that you are following and ask them to continue. Do not ask about anything new.`,
  wrapUp: () =>
    `You now feel you understand the topic well enough. In 2 to 3 sentences, summarise what you learned using only your notebook, thank them, and say you're ready. Do not ask a question. At most 80 words.`,
};

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
        `YOUR NOTEBOOK:\n${notebookLines(bundle, state)}\n\nCONVERSATION SO FAR:\n${recent}\n\nHOW YOU FEEL: ${REACTION[mood]}\n\nINSTRUCTION: ${INSTRUCTION[move.type](move.seed)}` +
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
  return r.text.trim().replace(/^kai:\s*/i, "").replace(/^"|"$/g, "");
}

// ---------- offline stand-in ----------

const ACKS = {
  great: ["Oh, that makes so much sense!", "Nice, that really clicks for me.", "Ahh, now I get it!"],
  okay: ["Okay, I think I'm getting there.", "Hmm, that kind of makes sense.", "Okay, partly with you."],
  confused: ["Hmm, I'm not sure I follow yet.", "Wait, I'm a bit lost.", "Okay… I think I need that again."],
  neutral: ["Okay.", "Got it, I think.", "Alright."],
};

export function mockWrite(bundle: Bundle, state: State, move: Move, mood: keyof typeof ACKS): string {
  const pick = (xs: string[]) => xs[state.turn % xs.length]!;
  const ack = pick(ACKS[mood]);
  switch (move.type) {
    case "open":
    case "contradict":
      return `${ack} ${move.seed}`;
    case "deepen":
    case "misconception":
      // Kai thinks it understood, so never "I'm lost" here; otherwise match the face
      return `${pick(ACKS[mood === "confused" ? "okay" : mood])} ${move.seed}`;
    case "followUp":
      return mood === "confused"
        ? `${pick(ACKS.confused)} Could you explain that part again, maybe with an example?`
        : `${pick(ACKS.okay)} Could you explain the rest of it, maybe with an example?`;
    case "listen":
      return pick(bundle.questions.fallbacks.listen);
    case "answer":
      return `${pick(bundle.questions.fallbacks.dontKnow)}${move.seed ? ` Also, ${move.seed.charAt(0).toLowerCase()}${move.seed.slice(1)}` : ""}`;
    case "wrapUp":
      return `I think I've got it now. Thanks for teaching me! ${pick(bundle.questions.fallbacks.wrapUp)}`;
  }
}
