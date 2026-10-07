// Teach Kai in the terminal and see why it says each line.
//   pnpm chat            uses OPENROUTER_API_KEY from .env (real judge and writer)
//   pnpm chat --demo     offline judge and writer, no key needed
// Commands: /mind (node states), /quit

import { createInterface } from "node:readline/promises";
import { stdin, stdout } from "node:process";
import bundleJson from "../topics/bandits/bundle.json";
import { Bundle } from "../content/schema";
import { hasApiKey } from "../engine/llm";
import { initialState, type State } from "../engine/tutor/state";
import { takeTurn, opening, type Deps } from "../engine/tutor/turn";
import { llmJudge, mockJudge } from "../engine/tutor/judge";
import { llmWrite, mockWrite, type Turn } from "../engine/tutor/writer";
import { mindView } from "../engine/tutor/mind";

const bundle = Bundle.parse(bundleJson);
const demo = process.argv.includes("--demo") || !hasApiKey();
const deps: Deps = demo
  ? { judge: async (b, m) => mockJudge(b, m), write: async (b, s, mv, _h, mood) => mockWrite(b, s, mv, mood) }
  : { judge: (b, m, k) => llmJudge(b, m, k), write: (b, s, mv, h, mood, avoid) => llmWrite(b, s, mv, h, avoid, mood) };

const dim = (s: string) => `\x1b[2m${s}\x1b[0m`;
const face = { great: "(^‿^)", okay: "(•‿•)", confused: "(•_•)?", neutral: "(•‿•)" } as const;

let state: State = initialState(bundle);
const history: Turn[] = [{ role: "kai", text: opening(bundle, state) }];
console.log(dim(demo ? "demo mode: offline judge and writer" : "live mode: OpenRouter judge and writer"));
console.log(`\nKai ${face.neutral}  ${history[0]!.text}\n`);

const rl = createInterface({ input: stdin, output: stdout, terminal: stdin.isTTY });
const prompt = () => stdout.write("you  › ");
prompt();
for await (const line of rl) {
  const message = line.trim();
  if (!stdin.isTTY) console.log(message);
  if (!message) {
    prompt();
    continue;
  }
  if (message === "/quit") break;
  if (message === "/mind") {
    const m = mindView(bundle, state);
    console.log(dim(`understanding ${Math.round(m.understanding * 100)}% · ${m.facts.correct}+${m.facts.partial}½ of ${m.facts.total} · ready at ${m.facts.needed}`));
    console.log(dim(m.nodes.map((n) => `${n.focus ? "▶" : " "} ${n.id} ${n.status.padEnd(9)} ${n.correct}/${n.total}`).join("\n")));
    prompt();
    continue;
  }
  const t0 = Date.now();
  const r = await takeTurn(bundle, { message, history, state }, deps);
  history.push({ role: "learner", text: message }, { role: "kai", text: r.reply });
  state = r.state;
  console.log(dim(`  judged: ${r.trace.judged.map((f) => `${f.fact}:${f.verdict}`).join(", ") || "nothing"}`));
  console.log(dim(`  move:   ${r.trace.move.type}${r.trace.move.node ? ` ${r.trace.move.node}` : ""}${r.trace.leaked.length ? ` · leaked ${r.trace.leaked.join(", ")}${r.trace.fallback ? " → fallback" : " → rewritten"}` : ""} · ${Date.now() - t0} ms`));
  console.log(`\nKai ${face[r.mood]}  ${r.reply}\n${dim(`  understanding ${Math.round(r.progress * 100)}% · message ${state.turn}`)}\n`);
  if (r.done) {
    console.log("Kai feels ready. Done.");
    break;
  }
  prompt();
}
rl.close();
