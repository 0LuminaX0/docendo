// Compare models for Kai's teaching chat (judge and writer) on one scripted conversation.
//   pnpm eval:chat --models google/gemini-2.5-flash,anthropic/claude-haiku-5.5
//   pnpm eval:chat --models anthropic/claude-haiku-5.5+google/gemini-3.5-flash-lite   (judge+writer)
// The same learner messages go to each model pair (judge and writer set to the same model); the output
// shows Kai's replies, the judge's verdicts and misconceptions, and time and cost. Costs real credits.

import { readFileSync } from "node:fs";
for (const f of [".env", ".env.local"]) {
  try {
    process.loadEnvFile?.(f);
  } catch {
    // no file
  }
}
const { Bundle } = await import("../content/schema");
const { initialState } = await import("../engine/tutor/state");
const { takeTurn, opening } = await import("../engine/tutor/turn");
const { llmJudge } = await import("../engine/tutor/judge");
const { llmWrite } = await import("../engine/tutor/writer");
const { MODELS } = await import("../engine/llm");

const args = process.argv.slice(2);
const models = (args.includes("--models") ? args[args.indexOf("--models") + 1]! : `${MODELS.judge}`).split(",");
const bundle = Bundle.parse(JSON.parse(readFileSync("topics/bandits/bundle.json", "utf8")));

const SCRIPT = [
  "So imagine you go out to eat every night and there are a few restaurants. You don't know which one is best, you only find out by eating there.",
  "Each visit gives you some happiness and it's random, so one bad night doesn't mean the place is bad. You keep an average for each restaurant.",
  "Greedy just picks the restaurant with the best average so far, every time.",
  "idk",
  "when you explore you always go to the restaurant you visited the least",
  "What do you think greedy does if the best restaurant had one bad first night?",
];

for (const model of models) {
  const [judge, writer] = model.includes("+") ? model.split("+") : [model, model];
  (MODELS as { judge: string; writer: string }).judge = judge!;
  (MODELS as { judge: string; writer: string }).writer = writer!;
  let cost = 0;
  let ms = 0;
  const onCall = (c: { ms: number; usage: { costUsd?: number } }) => ((cost += c.usage.costUsd ?? 0), (ms += c.ms));
  let state = initialState(bundle);
  const history: { role: "kai" | "learner"; text: string }[] = [{ role: "kai", text: opening(bundle, state) }];
  console.log(`\n===== ${model}\nKai: ${history[0]!.text}`);
  for (const message of SCRIPT) {
    const r = await takeTurn(bundle, { message, history, state, elapsedMs: 60_000 }, { judge: (b, m, kai) => llmJudge(b, m, kai, onCall), write: (b, s, mv, h, mood, avoid) => llmWrite(b, s, mv, h, avoid, mood, onCall) });
    history.push({ role: "learner", text: message }, { role: "kai", text: r.reply });
    state = r.state;
    const t = r.trace;
    console.log(`\nYou: ${message}\n  judge: ${t.intent}; ${t.judged.map((v) => `${v.fact}:${v.verdict}`).join(" ") || "no facts"}${t.misconceptions.length ? `; misconception: ${t.misconceptions.map((m) => `${m.node} "${m.quote}"`).join("; ")}` : ""}${t.leaked.length ? `; leaked ${t.leaked.join(",")}` : ""}\n  move: ${t.move.type}${t.move.closure ? ` (${t.move.closure})` : ""}\nKai (${r.mood}): ${r.reply}`);
  }
  console.log(`\n${model}: model time ${(ms / 1000).toFixed(1)} s over ${SCRIPT.length} turns, cost $${cost.toFixed(4)}`);
}
