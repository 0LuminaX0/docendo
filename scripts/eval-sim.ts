// End-to-end simulation of the teaching step and what it means for practice, with simulated learners.
//   pnpm eval:sim                                every learner once, the pack's script.json
//   pnpm eval:sim --reps 2 --only expert,terse   some learners, twice each
//   pnpm eval:sim --script path/to/script.json   try another set of Kai's questions
//   pnpm eval:sim --solve                        also let Kai solve the practice problems (live solver) from the final
//                                                notebook, and after a wrong answer take one correction from the learner
//   pnpm eval:sim --show                         print every conversation
// Each simulated learner is a model role-playing a student with a fixed knowledge sheet: the lesson's teachable facts
// it knows (in a student's words, never the fact text), the wrong beliefs it holds, and a style (an expert who is
// concise and impatient, a solid student, a terse one, a half-remembering one, a misled one). It talks to the real Kai
// (takeScriptTurn with the live judge and writer) until Kai wraps up, and says after each of Kai's messages whether Kai
// asked about something it had already explained. The report: facts credited against what the learner knows (recall),
// credit for what it doesn't (false credit), wrong beliefs caught, repeated questions, messages and words, and whether
// the practice gate opens exactly where the learner's knowledge suffices (the recursive condition's validity: open
// without the knowledge, Kai is right for nothing; shut with it, Kai fails a learner who taught it well).
// Costs real credits (a learner, judge and writer call per message: about $0.02 a conversation; --solve about $0.03 more).

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { z } from "zod";
for (const f of [".env", ".env.local"]) {
  try {
    process.loadEnvFile?.(f);
  } catch {
    // no file
  }
}
const { Bundle } = await import("../content/schema");
const { ScriptFile } = await import("../content/pack");
const { PracticeFile } = await import("../content/practice");
const { initialScriptState, scriptOpening, takeScriptTurn } = await import("../engine/tutor/script");
const { latest, activeMisconceptions, notesOf } = await import("../engine/tutor/state");
const { applyJudgement } = await import("../engine/tutor/turn");
const { llmJudge } = await import("../engine/tutor/judge");
const { llmReact } = await import("../engine/tutor/writer");
const { gate, solve, alts, beliefFor } = await import("../engine/tutor/solve");
const { checkPractice } = await import("../content/practice");
const { chatJson, MODELS } = await import("../engine/llm");

const args = process.argv.slice(2);
const opt = (name: string) => (args.includes(name) ? args[args.indexOf(name) + 1] : undefined);
const reps = Number(opt("--reps") ?? 1);
const only = opt("--only")?.split(",");
const show = args.includes("--show");
const empty = args.includes("--empty"); // skip teaching: Kai starts practice with an empty notebook (the corrections' test)
const withSolve = args.includes("--solve") || empty;
const LEARNER = opt("--learner") ?? "anthropic/claude-haiku-5.5";
const scriptPath = opt("--script") ?? "topics/bandits/script.json";

const bundle = Bundle.parse(JSON.parse(readFileSync("topics/bandits/bundle.json", "utf8")));
const script = ScriptFile.parse(JSON.parse(readFileSync(scriptPath, "utf8")));
const items = PracticeFile.parse(JSON.parse(readFileSync("topics/bandits/practice.json", "utf8"))).items;
const TEACH = ["n05.f1", "n06.f1", "n07.f1", "n07.f2", "n11.f1", "n11.f2", "n12.f1", "n12.f2"];

// a student's understanding of each teachable fact (not the fact's wording), and of its usual wrong version
const KNOW: Record<string, string> = {
  "n05.f1": "Greedy always takes the option with the highest average so far. After every pick that option's average is updated, and if another option's average overtakes it, greedy switches to that one.",
  "n06.f1": "Greedy can get stuck: if the truly best option has an unlucky first result, its average looks too low, greedy never tries it again, so its average never gets corrected and greedy never finds out.",
  "n07.f1": "ε-greedy explores with a fixed probability ε (like 0.1) in every single round. ε never changes: after thousands of rounds it still explores 10% of the time, exactly like at the start.",
  "n07.f2": "When ε-greedy explores, it picks uniformly at random among ALL the options, the current favourite included, whatever their averages.",
  "n11.f1": "UCB gives every option a score, its average plus a bonus, and always picks the option with the highest score. No randomness.",
  "n11.f2": "How big the bonuses are is set by a constant c chosen in advance (from how much rewards are expected to vary). The bonus doesn't depend on the actual rewards an option gave.",
  "n12.f1": "Each time an option is picked, its own bonus shrinks (its count n goes up). Picking other options doesn't shrink it.",
  "n12.f2": "The bonus has ln t in it (t is the round number), so the bonus of an option nobody picks keeps growing, but more and more slowly, without limit, so every option gets tried again eventually.",
};
const VAGUE: Record<string, string> = {
  "n07.f1": "ε-greedy sometimes picks randomly instead of the best one (you don't remember how often or whether that changes).",
  "n12.f2": "The bonus of an option you don't pick grows over time (you don't remember how fast).",
  "n11.f1": "UCB adds some kind of bonus to the average (you're not sure how it then picks).",
};
const WRONG: Record<string, string> = {
  "n06.f1": "Nothing really goes wrong with greedy in the long run: the averages correct themselves over time, so it finds the best option eventually.",
  "n07.f1": "ε-greedy explores a lot at the start and less and less later, once its averages are reliable.",
  "n07.f2": "When ε-greedy explores, it picks one of the OTHER options, never the current favourite (that would be pointless).",
  "n12.f2": "An option's bonus stays the same while it isn't picked.",
  "n05.f1": "Greedy tries each option once, then sticks with the best one forever and never switches.",
};

type Persona = { id: string; style: string; knows: string[]; vague?: string[]; wrong?: string[] };
const PERSONAS: Persona[] = [
  { id: "expert", knows: TEACH, style: "You are a strong computer-science student who understood the lesson completely. Be precise and concise: one to three sentences, you may use notation like Q + c·sqrt(ln t / n). You explain everything relevant to the question at once. If Kai asks something you have clearly already explained, say so briefly (and repeat it in a few words)." },
  { id: "solid", knows: TEACH.filter((f) => f !== "n11.f2"), style: "You are a solid student. Explain in plain words, two to four sentences, sometimes with a tiny example with numbers." },
  { id: "terse", knows: TEACH, style: "You are busy and type little: answer in ONE short sentence of 6 to 15 words, only what was asked, no examples. If asked to say more, add one more short sentence." },
  { id: "partial", knows: ["n05.f1", "n06.f1"], vague: ["n07.f1", "n12.f2", "n11.f1"], style: "You read the lesson quickly and remember only some of it. Two to three sentences. When asked about something not in your knowledge sheet, say honestly you don't remember." },
  { id: "misled", knows: ["n11.f1", "n12.f1"], wrong: ["n05.f1", "n06.f1", "n07.f1", "n07.f2", "n12.f2"], style: "You are confident and explain in two to three sentences. You believe your wrong beliefs completely and state them as facts when they are relevant." },
  { id: "realistic", knows: ["n05.f1", "n06.f1", "n07.f1", "n07.f2", "n11.f1", "n12.f1"], vague: ["n12.f2"], style: "You are an ordinary student in a lab session, a bit tired. Write like in a chat: lowercase, an occasional typo, one to three sentences. You don't always use the lesson's words: say things like 'the exploration rate', 'the random one', 'the confidence thing', 'the score'. Sometimes you answer only part of the question at first." },
  { id: "rambler", knows: TEACH, style: "You are eager and in a hurry: in your FIRST message, whatever Kai asks, explain everything you know about all three rules in one long paragraph. After that, keep answers to one or two sentences, and say so if Kai asks something you already covered." },
  { id: "chatty", knows: ["n05.f1", "n06.f1", "n07.f1", "n07.f2", "n11.f1", "n11.f2", "n12.f1", "n12.f2"], style: "You are friendly and chatty. Two to three sentences. About every third message, before or instead of answering, ask Kai a question back (\"what do you think?\", \"does that make sense?\") or make a small joke unrelated to the topic; when Kai asks again, answer properly." },
];

const Reply = z.object({ message: z.string(), alreadyAnswered: z.boolean(), confusing: z.boolean() });

function sheet(p: Persona): string {
  const lines = [
    "- The setup: each round you pick one of several options; you only see the reward of the option you picked. Each option's estimate is the average of its rewards so far. Every rule first tries each option once.",
    ...p.knows.map((f) => `- ${KNOW[f]}`),
    ...(p.vague ?? []).map((f) => `- (only vaguely) ${VAGUE[f] ?? KNOW[f]}`),
    ...(p.wrong ?? []).map((f) => `- ${WRONG[f]}`),
  ];
  const unknown = TEACH.filter((f) => !p.knows.includes(f) && !p.vague?.includes(f) && !p.wrong?.includes(f));
  return `${lines.join("\n")}${unknown.length ? `\n\nYou do NOT know or remember anything else (for example ${unknown.length} other details of these rules). If Kai asks about something not covered above, say you're not sure.` : ""}`;
}

async function learnerSays(p: Persona, history: { role: "kai" | "learner"; text: string }[], cost: { usd: number }) {
  const convo = history.map((t) => `${t.role === "kai" ? "Kai" : "You"}: ${t.text}`).join("\n");
  const r = await chatJson({
    model: LEARNER,
    name: "learner",
    schema: Reply,
    temperature: 0.7,
    maxTokens: 2000,
    messages: [
      {
        role: "system",
        content: `You role-play a university student in a study. You have just read a short lesson on multi-armed bandits (greedy, ε-greedy, UCB) and now explain it in a chat to Kai, a classmate who missed it. Use ONLY your knowledge sheet below, never anything else you know about bandits. Don't recite the sheet: say it the way you would in a chat.\n\nYOUR KNOWLEDGE SHEET:\n${sheet(p)}\n\nSTYLE: ${p.style}\n\nReturn JSON: message (your next chat message to Kai), alreadyAnswered (true if Kai's latest question asks about something you clearly already explained earlier in this chat), confusing (true if Kai's latest message is confusing or strange for a student).`,
      },
      { role: "user", content: `The chat so far:\n${convo}\n\nWrite your reply to Kai's last message.` },
    ],
  });
  cost.usd += r.usage.costUsd ?? 0;
  return r.data;
}

type Run = {
  persona: string;
  turns: number;
  words: number;
  repeated: number;
  confusing: number;
  recall: number;
  known: number;
  falseCredit: string[];
  vagueAsCorrect: string[];
  caught: number;
  wrongHeld: number;
  gateRight: number;
  gateFalseOpen: string[];
  gateFalseShut: string[];
  solved?: number;
  openRight?: number;
  openTried?: number;
  solvedAfterFix?: number;
  shouldSolve?: number;
  done: boolean;
  usd: number;
  state?: unknown;
  log: string[];
};

async function simulate(p: Persona): Promise<Run> {
  const cost = { usd: 0 };
  const onCall = (c: { usage: { costUsd?: number } }) => (cost.usd += c.usage.costUsd ?? 0);
  let state = initialScriptState(bundle, script);
  const history: { role: "kai" | "learner"; text: string }[] = [{ role: "kai", text: scriptOpening(script) }];
  const log = [`Kai: ${history[0]!.text}`];
  let words = 0;
  let repeated = 0;
  let confusing = 0;
  let turns = 0;
  for (; turns < 30 && !state.done && !empty; turns++) {
    const said = await learnerSays(p, history, cost);
    if (said.alreadyAnswered) repeated++;
    if (said.confusing) confusing++;
    words += said.message.split(/\s+/).filter(Boolean).length;
    const r = await takeScriptTurn(bundle, script, { message: said.message, history, state, elapsedMs: 0, minutes: Number.POSITIVE_INFINITY }, {
      judge: (b, m, kai) => llmJudge(b, m, kai, onCall),
      react: (b, s, kind, h, next, mood, avoid) => llmReact(b, s, kind, h, next, avoid, mood, onCall),
    });
    history.push({ role: "learner", text: said.message }, { role: "kai", text: r.reply });
    state = r.state;
    log.push(
      `${said.alreadyAnswered ? "[REPEAT] " : ""}${said.confusing ? "[CONFUSING] " : ""}You: ${said.message}`,
      `   judge: ${r.trace.intent}; ${r.trace.judged.map((v) => `${v.fact}:${v.verdict}`).join(" ") || "no facts"}${r.trace.misconceptions.length ? `; wrong: ${r.trace.misconceptions.map((m) => m.node).join(" ")}` : ""}${r.trace.dropped?.length ? `; dropped ${r.trace.dropped.length}` : ""}`,
      `Kai (${r.mood}): ${r.reply}`,
    );
  }
  const nb = latest(state);
  const correct = new Set(TEACH.filter((f) => nb.get(f)?.verdict === "correct"));
  const known = p.knows;
  const recall = known.filter((f) => correct.has(f)).length;
  const falseCredit = [...correct].filter((f) => !known.includes(f) && !(p.vague ?? []).includes(f));
  const vagueAsCorrect = (p.vague ?? []).filter((f) => correct.has(f));
  const wrongIdeas = new Set((p.wrong ?? []).map((f) => f.split(".")[0]));
  const caught = [...wrongIdeas].filter((n) => activeMisconceptions(state).some((m) => m.node === n) || TEACH.some((f) => f.startsWith(`${n}.`) && nb.get(f)?.verdict === "wrong")).length;
  // the gate against the truth: Kai should be able to be right exactly where the learner's knowledge suffices
  let gateRight = 0;
  const gateFalseOpen: string[] = [];
  const gateFalseShut: string[] = [];
  // a need is met by a fact the learner knows, or (where the problem says its vague reading still gets there) one it
  // knows vaguely; a wrong belief about a needed fact shuts it
  const vagueEnough = (it: (typeof items)[number], n: string) => {
    if (!alts(n).some((f) => (p.vague ?? []).includes(f))) return false;
    const b = beliefFor(it, n, "vague");
    return !!b && b.when === "vague" && checkPractice(it, it.kind === "choice" ? b.answer : String(b.answer));
  };
  const truthOpen = (it: (typeof items)[number]) =>
    (it.needs ?? []).every((n) => alts(n).some((f) => known.includes(f)) || vagueEnough(it, n)) && !(it.needs ?? []).some((n) => alts(n).some((f) => (p.wrong ?? []).includes(f)));
  for (const it of items) {
    const open = gate(it, state).canBeRight;
    const truth = truthOpen(it);
    if (open === truth) gateRight++;
    else (open ? gateFalseOpen : gateFalseShut).push(it.id);
  }
  const run: Run = { persona: p.id, turns, words, repeated, confusing, recall, known: known.length, falseCredit, vagueAsCorrect, caught, wrongHeld: wrongIdeas.size, gateRight, gateFalseOpen, gateFalseShut, done: state.done, usd: 0, log };
  if (withSolve) {
    // Kai solves every problem from this notebook; after a wrong answer, the learner corrects it once and Kai retries
    let solved = 0;
    let afterFix = 0;
    let openRight = 0;
    let openTried = 0;
    let s = state;
    for (const it of items) {
      const first = await solve(bundle, it, s, { demo: false, onCall });
      if (first.gate.canBeRight) (openTried++, first.correct ? openRight++ : log.push(`[practice ${it.id}] gate open but Kai wrong (${first.by}), answered ${first.answer}: ${first.steps.map((x) => x.text).join(" | ")}`));
      if (first.correct) {
        solved++;
        continue;
      }
      const options = it.kind === "choice" ? `\nOptions: ${it.options!.map((o, i) => `${"ABCDEF"[i]}) ${o}`).join(" ")}` : "";
      const fix = await learnerSays(
        p,
        [{ role: "kai", text: `I tried this problem: ${it.prompt}${options}\nMy steps: ${first.steps.map((x, i) => `${i + 1}. ${x.text}`).join(" ")}\nMy answer: ${first.answer}. That was wrong. Can you correct me in a sentence or two?` }],
        cost,
      );
      const j = await llmJudge(bundle, fix.message, `${first.steps.map((x) => x.text).join(" ").slice(-600)} (That was Kai's attempt at this problem: ${it.prompt}${options})`, onCall);
      s = applyJudgement(s, j);
      const second = await solve(bundle, it, s, { demo: false, onCall });
      if (second.correct) afterFix++;
      log.push(`[practice ${it.id}] Kai: ${first.answer} (wrong; guess ${first.guess?.replaces ?? "-"}); fix: ${fix.message} → ${j.facts.map((v) => `${v.fact}:${v.verdict}`).join(" ") || "no facts"} → retry ${second.answer} ${second.correct ? "right" : "wrong"}`);
    }
    run.solved = solved;
    run.openRight = openRight;
    run.openTried = openTried;
    run.solvedAfterFix = afterFix;
    run.shouldSolve = items.filter(truthOpen).length;
    void notesOf;
  }
  run.usd = cost.usd;
  run.state = state;
  return run;
}

const personas = PERSONAS.filter((p) => !only || only.includes(p.id));
const runs: Run[] = [];
for (let rep = 0; rep < reps; rep++) runs.push(...(await Promise.all(personas.map((p) => simulate(p).catch((e) => ({ persona: p.id, error: String(e) }) as unknown as Run)))));

const ok = runs.filter((r) => !(r as unknown as { error?: string }).error);
for (const r of runs) if ((r as unknown as { error?: string }).error) console.log(`! ${r.persona}: ${(r as unknown as { error: string }).error}`);
if (show) for (const r of ok) console.log(`\n===== ${r.persona}\n${r.log.join("\n")}`);
const sum = (f: (r: Run) => number) => ok.reduce((a, r) => a + f(r), 0);
console.log(`\nscript ${scriptPath}: ${script.questions.length} questions; learner model ${LEARNER}; ${ok.length} conversations`);
for (const r of ok)
  console.log(
    `  ${r.persona.padEnd(8)} recall ${r.recall}/${r.known}  false credit ${r.falseCredit.join(" ") || "-"}  vague→correct ${r.vagueAsCorrect.join(" ") || "-"}  wrong caught ${r.caught}/${r.wrongHeld}  ` +
      `repeats ${r.repeated}  confusing ${r.confusing}  messages ${r.turns}  words ${r.words}  gate ${r.gateRight}/6${r.gateFalseShut.length ? ` shut:${r.gateFalseShut.join(",")}` : ""}${r.gateFalseOpen.length ? ` open:${r.gateFalseOpen.join(",")}` : ""}` +
      (r.solved !== undefined ? `  Kai solved ${r.solved}+${r.solvedAfterFix}/6 (should ${r.shouldSolve})` : "") +
      `${r.done ? "" : "  NOT DONE"}  $${r.usd.toFixed(3)}`,
  );
console.log(
  `TOTAL recall ${sum((r) => r.recall)}/${sum((r) => r.known)} (${Math.round((100 * sum((r) => r.recall)) / Math.max(1, sum((r) => r.known)))}%), false credit ${sum((r) => r.falseCredit.length)}, vague→correct ${sum((r) => r.vagueAsCorrect.length)}, wrong caught ${sum((r) => r.caught)}/${sum((r) => r.wrongHeld)}, repeats ${sum((r) => r.repeated)}, confusing ${sum((r) => r.confusing)}, messages ${sum((r) => r.turns)}, words ${sum((r) => r.words)}, gate ${sum((r) => r.gateRight)}/${ok.length * 6}` +
    (withSolve ? `, Kai solved ${sum((r) => r.solved ?? 0)} first try + ${sum((r) => r.solvedAfterFix ?? 0)} after a fix (should ${sum((r) => r.shouldSolve ?? 0)}), right when the gate was open ${sum((r) => r.openRight ?? 0)}/${sum((r) => r.openTried ?? 0)}` : "") +
    `, $${sum((r) => r.usd).toFixed(3)}`,
);
mkdirSync("data", { recursive: true });
const out = `data/eval-sim-${new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19)}.json`;
writeFileSync(out, JSON.stringify({ script: scriptPath, runs }, null, 2));
console.log(`saved ${out}`);
