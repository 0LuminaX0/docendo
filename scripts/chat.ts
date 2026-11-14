// Teach Kai in the terminal and see why it says each line: the same path as the app (the pack's fixed questions in
// script.json, Kai's reaction before each; the older chosen-question Kai only for a pack without a script).
//   pnpm chat            uses OPENROUTER_API_KEY from .env (real judge and reaction)
//   pnpm chat --demo     offline judge, the script's fixed lines, no key needed
// Commands: /mind (node states), /quit. Piped input works too (one message per line).

import { createInterface } from "node:readline/promises";
import { readFileSync, existsSync } from "node:fs";
import { stdin, stdout } from "node:process";
import bundleJson from "../topics/bandits/bundle.json";
import { Bundle } from "../content/schema";
import { ScriptFile } from "../content/pack";
import { hasApiKey } from "../engine/llm";
import { initialState, type State } from "../engine/tutor/state";
import { takeTurn, opening, type Deps } from "../engine/tutor/turn";
import { initialScriptState, scriptOpening, takeScriptTurn } from "../engine/tutor/script";
import { llmJudge, mockJudge } from "../engine/tutor/judge";
import { llmReact, llmWrite, mockWrite, type Turn } from "../engine/tutor/writer";
import { mindView } from "../engine/tutor/mind";

const bundle = Bundle.parse(bundleJson);
const scriptPath = "topics/bandits/script.json";
const script = existsSync(scriptPath) ? ScriptFile.parse(JSON.parse(readFileSync(scriptPath, "utf8"))) : null;
const demo = process.argv.includes("--demo") || !hasApiKey();
// as the chat route: in demo mode no reaction (the script's fixed lines)
const deps: Deps = demo
  ? { judge: async (b, m) => mockJudge(b, m), write: async (b, s, mv, _h, mood) => mockWrite(b, s, mv, mood) }
  : {
      judge: (b, m, k) => llmJudge(b, m, k),
      write: (b, s, mv, h, mood, avoid) => llmWrite(b, s, mv, h, avoid, mood),
      react: (b, s, kind, h, next, mood, avoid) => llmReact(b, s, kind, h, next, avoid, mood),
    };

const dim = (s: string) => `\x1b[2m${s}\x1b[0m`;
const face = { great: "(^‿^)", okay: "(•‿•)", confused: "(•_•)?", neutral: "(•‿•)" } as const;

let state: State = script ? initialScriptState(bundle, script) : initialState(bundle);
const history: Turn[] = [{ role: "kai", text: script ? scriptOpening(script) : opening(bundle, state) }];
console.log(dim(`${demo ? "demo mode: offline judge" : "live mode: OpenRouter judge"}, ${script ? `Kai's ${script.questions.length} fixed questions (${scriptPath})` : "Kai chooses its questions"}`));
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
    console.log(dim(`understanding ${Math.round(m.understanding * 100)}%, ${m.facts.correct}+${m.facts.partial}½ of ${m.facts.total}, ready at ${m.facts.needed}`));
    console.log(dim(m.nodes.map((n) => `${n.focus ? "▶" : " "} ${n.id} ${n.status.padEnd(9)} ${n.correct}/${n.total}`).join("\n")));
    prompt();
    continue;
  }
  const t0 = Date.now();
  const input = { message, history, state, elapsedMs: 0, minutes: Number.POSITIVE_INFINITY };
  const r = script ? await takeScriptTurn(bundle, script, input, deps) : await takeTurn(bundle, input, deps);
  history.push({ role: "learner", text: message }, { role: "kai", text: r.reply });
  state = r.state;
  const t = r.trace as typeof r.trace & { script?: { reaction: string; next: string | null }; misconceptions?: { node: string; fact?: string | null; quote: string }[]; dropped?: { fact: string; quote: string }[] };
  console.log(dim(`  judged: ${t.intent ?? ""} ${t.judged.map((f) => `${f.fact}:${f.verdict}`).join(", ") || "nothing"}`));
  for (const m of t.misconceptions ?? []) console.log(dim(`  wrong:  ${m.node}${m.fact ? `/${m.fact}` : ""} "${m.quote.slice(0, 120)}"`));
  for (const d of t.dropped ?? []) console.log(dim(`  check:  ${d.fact} ${d.quote.slice(0, 140)}`));
  console.log(dim(`  ${t.script ? `reaction ${t.script.reaction}, next ${t.script.next ?? "-"}` : `move ${t.move.type}${t.move.node ? ` ${t.move.node}` : ""}`}${t.leaked.length ? `, leaked ${t.leaked.join(", ")}${t.fallback ? " → fallback" : " → rewritten"}` : ""}, ${Date.now() - t0} ms`));
  console.log(`\nKai ${face[r.mood]}  ${r.reply}\n${dim(`  understanding ${Math.round(r.progress * 100)}%, message ${state.turn}`)}\n`);
  if (r.done) {
    console.log("Kai feels ready. Done.");
    break;
  }
  prompt();
}
rl.close();
