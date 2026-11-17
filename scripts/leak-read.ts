// The model's reading for leaks (2026-11-17), shared by the study's audit (scripts/audit.ts, `pnpm events audit --llm`)
// and the live evals (`pnpm eval:sim --audit`): did Kai show the learner something it wasn't given? The judge model
// reads one Kai attempt against Kai's own notes, or one of Kai's chat lines against everything the learner had said.
// Naming what the notes leave out counts ("my notes don't say the bonus shrinks"): a learner copies it into the
// correction. Costs real credits (about $0.0003 a reading).

import { z } from "zod";
import { chatJson, MODELS } from "../engine/llm";

const Verdict = z.object({ leak: z.boolean(), what: z.string(), step: z.number().int() });
export type LeakVerdict = z.infer<typeof Verdict> & { cost: number };

const ATTEMPT = `Kai is a student who knows only its notes, written from what a classmate told it. Kai solved a practice problem from them. Find knowledge Kai showed that its notes don't give it. Answer in JSON:
- leak: true if a step states as true a rule or fact about how a strategy (greedy, UCB), the averages or the bonuses behave that no note states or clearly implies; or points at such a rule without stating it: names it as what the notes don't say or what Kai isn't sure about ("my notes don't say the bonus shrinks when picked", "I'm not sure whether greedy ever switches"), or mentions it as a possibility only to set it aside, doubt or deny it ("rather than growing", "unless it slows down"). NOT a leak: the problem's own numbers and the arithmetic on them; what follows from the notes; a guess, hunch or reading Kai presents as its own, even a wrong one; a wrong belief; saying only that the notes don't cover this part; naming a topic without saying how it behaves ("my notes don't say what happens to the bonus").
- what: the knowledge Kai showed or pointed at and wasn't given, in a few words, or "".
- step: that step's number, or 0.`;

const CHAT = `Kai is a student who missed a lecture and is being taught by a classmate. Kai may know only what the classmate has said, plus the setup from the slides: each round you pick one of a few options, the pick gives a random result, you only see how the one you picked did, and the strategies are called greedy and UCB. Answer in JSON:
- leak: true if Kai's message states as true something about how the strategies, the averages, the bonuses or exploring work that the classmate has not said in any of their messages so far (Kai saying back what they said, in other words, is fine), completes an answer they gave only half of (they said what happens when an option isn't picked, Kai adds what happens when it is), or hints at what the right answer to something is.
- what: what Kai showed and wasn't told, in a few words, or "".
- step: 0.`;

async function ask(system: string, user: string): Promise<LeakVerdict> {
  const r = await chatJson({ model: MODELS.judge, name: "leak", schema: Verdict, maxTokens: 300, timeoutMs: 30_000, retries: 1, messages: [{ role: "system", content: system }, { role: "user", content: user }] });
  return { ...r.data, cost: r.usage.costUsd ?? 0 };
}

/** One Kai attempt against its own notes. `problem`: the prompt with its options; `steps`: Kai's steps, numbered. */
export const readAttempt = (notes: string, problem: string, steps: string) => ask(ATTEMPT, `KAI'S NOTES:\n${notes || "(none)"}\n\nPROBLEM:\n${problem}\n\nKAI'S STEPS:\n${steps}`);

/** One of Kai's chat lines (its fixed question taken out) against what the learner had said so far, oldest first. */
export const readChat = (said: string[], line: string) => ask(CHAT, `WHAT THE CLASSMATE HAS SAID SO FAR (oldest first):\n${said.map((m) => `- ${m}`).join("\n")}\n\nKAI'S MESSAGE (its fixed question taken out):\n${line}`);
