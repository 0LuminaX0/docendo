import { describe, expect, it } from "vitest";
import bundleJson from "../topics/bandits/bundle.json";
import scriptJson from "../topics/bandits/script.json";
import { Bundle } from "../content/schema";
import { ScriptFile } from "../content/pack";
import { initialScriptState, readBack, scriptOpening, takeScriptTurn, wroteNow } from "../engine/tutor/script";
import { latest, type State } from "../engine/tutor/state";
import type { Judgement } from "../engine/tutor/judge";
import type { Turn } from "../engine/tutor/writer";

const bundle = Bundle.parse(bundleJson);
const script = ScriptFile.parse(scriptJson);
const Q = script.questions;

// a judge that returns what each test says, quoting the learner's message
type Say = Partial<Judgement> & { intent: Judgement["intent"] };
const judgeWith = (say: Say) => async (_b: Bundle, message: string): Promise<Judgement> => ({
  facts: [],
  misconceptions: [],
  termsUsed: [],
  ...say,
  ...(say.facts ? { facts: say.facts.map((f) => ({ ...f, quote: f.quote || message })) } : {}),
});

async function talk(steps: { message: string; say: Say; elapsedMs?: number }[], start = initialScriptState(bundle, script)) {
  let state: State = start;
  const history: Turn[] = [{ role: "kai", text: scriptOpening(script) }];
  const out: Awaited<ReturnType<typeof takeScriptTurn>>[] = [];
  for (const s of steps) {
    const r = await takeScriptTurn(bundle, script, { message: s.message, history, state, elapsedMs: s.elapsedMs ?? 60_000 }, { judge: judgeWith(s.say) });
    history.push({ role: "learner", text: s.message }, { role: "kai", text: r.reply });
    state = r.state;
    out.push(r);
  }
  return out;
}

const long = "Every day you pick one of three cafés for lunch, and each one has good and bad days around its own average that you don't know.";

describe("Kai's fixed teaching questions", () => {
  it("are the team's nine questions, with an \"anything else\" after each rule, and name no lesson fact", () => {
    expect(Q.map((q) => q.id)).toEqual(["problem", "greedy", "greedy-else", "epsilon", "epsilon-else", "ucb", "ucb-else", "other", "anything"]);
    for (const q of Q.filter((x) => x.id.endsWith("-else") || x.id === "anything")) {
      expect(q.text).toMatch(/^Is there anything else I should know/);
      expect(q.sayMore, q.id).toBe(false);
    }
    expect(scriptOpening(script)).toContain(Q[0]!.text);
    // every Kai message ends with one question
    for (const q of Q) expect(q.text.trim().endsWith("?"), q.id).toBe(true);
  });

  it("asks them in order, repeating back what Kai wrote down in the learner's words", async () => {
    const steps = Q.map((_, i) => ({ message: `${long} (${i})`, say: { intent: "explain" as const, facts: [{ fact: "n01.f1", verdict: "correct" as const, quote: "" }] } }));
    const r = await talk(steps);
    r.slice(0, -1).forEach((x, i) => {
      expect(x.reply.startsWith("I wrote down: “"), `after question ${i + 1}`).toBe(true);
      expect(x.reply.endsWith(Q[i + 1]!.text), `asks question ${i + 2}`).toBe(true);
      expect(x.trace.script).toMatchObject({ asked: Q[i]!.id, next: Q[i + 1]!.id, sayMore: false });
      expect(x.done).toBe(false);
    });
    // after the last one Kai wraps up and reads its notes back
    const last = r.at(-1)!;
    expect(last.done).toBe(true);
    expect(last.trace.move.type).toBe("wrapUp");
    expect(last.trace.readyReason).toBe("script");
    expect(last.reply).toContain(script.lines.ready);
    expect(last.reply).toContain("• ");
  });

  it("keeps logging what the learner taught in Kai's notebook, as before", async () => {
    const r = await talk([
      { message: "greedy always takes the best average so far and switches when another overtakes", say: { intent: "answer", facts: [{ fact: "n05.f1", verdict: "correct", quote: "" }] } },
      { message: "it explores less once it knows which one is best", say: { intent: "answer", misconceptions: [{ node: "n07", quote: "it explores less once it knows which one is best", belief: "exploration fades" }] } },
    ]);
    const st = r.at(-1)!.state;
    expect(latest(st).get("n05.f1")).toMatchObject({ verdict: "correct", words: "greedy always takes the best average so far and switches when another overtakes" });
    expect(st.misconceptions).toHaveLength(1);
    // the misconception is written down and repeated like anything else: Kai doesn't judge
    expect(r[1]!.reply).toContain("it explores less once it knows which one is best");
  });

  it("asks once to say more after a short answer to a question that wants an explanation", async () => {
    const r = await talk([
      { message: "choosing places to eat", say: { intent: "answer", facts: [{ fact: "n01.f1", verdict: "partial", quote: "" }] } },
      { message: "lunch spots", say: { intent: "answer" } },
    ]);
    expect(r[0]!.reply).toBe(`I wrote down: “choosing places to eat”. ${script.lines.sayMore}`);
    expect(r[0]!.trace.script.sayMore).toBe(true);
    expect(r[0]!.state.script).toMatchObject({ at: 0, more: true });
    // only once: the next short answer moves on
    expect(r[1]!.reply.endsWith(Q[1]!.text)).toBe(true);
    expect(r[1]!.reply).toContain(script.lines.wroteNothing);
  });

  it("moves on after a short no to an \"anything else\" question", async () => {
    const start: State = { ...initialScriptState(bundle, script), script: { at: 2, more: false, again: 0 } };
    const r = await talk([{ message: "no", say: { intent: "answer" } }], start);
    expect(r[0]!.reply.endsWith(Q[3]!.text)).toBe(true);
  });

  it("moves on after \"I don't know\", and re-asks once after a question to Kai or a reply that isn't an answer", async () => {
    const r = await talk([
      { message: "idk", say: { intent: "unsure" } },
      { message: "what do you think it does?", say: { intent: "ask_kai" } },
      { message: "lol", say: { intent: "off_topic" } },
    ]);
    expect(r[0]!.reply).toBe(`${script.lines.dontKnow} ${Q[1]!.text}`);
    expect(r[1]!.reply).toBe(`${script.lines.askedKai} ${Q[1]!.text}`);
    expect(r[1]!.state.script).toMatchObject({ at: 1, again: 1 });
    // the second time it moves on, so nobody gets stuck
    expect(r[2]!.reply.endsWith(Q[2]!.text)).toBe(true);
  });

  it("wraps up at the first message after the time is up, without asking for more", async () => {
    const r = await talk([{ message: "ok so greedy picks the best", say: { intent: "answer", facts: [{ fact: "n05.f1", verdict: "partial", quote: "" }] }, elapsedMs: script.minutes * 60_000 + 1 }]);
    expect(r[0]!.done).toBe(true);
    expect(r[0]!.trace.readyReason).toBe("time");
    expect(r[0]!.reply).not.toContain(script.lines.sayMore);
    expect(r[0]!.reply.startsWith("I wrote down: “ok so greedy picks the best”.")).toBe(true);
  });

  it("follows each question's idea, so Kai's mind and the help card know what Kai is asking about", async () => {
    const r = await talk(Q.slice(0, 3).map(() => ({ message: long, say: { intent: "explain" as const } })));
    expect(r.map((x) => x.state.focus)).toEqual(["n05", "n05", "n07"]);
  });

  it("writes each note once, the longest of overlapping quotes", () => {
    const s: State = {
      ...initialScriptState(bundle, script),
      turn: 3,
      notebook: [
        { fact: "n11.f1", verdict: "correct", words: "UCB adds a bonus", turn: 3 },
        { fact: "n12.f1", verdict: "correct", words: "UCB adds a bonus that shrinks when you pick it", turn: 3 },
        { fact: "n05.f1", verdict: "correct", words: "an older note", turn: 2 },
      ],
    };
    expect(wroteNow(s)).toEqual(["UCB adds a bonus that shrinks when you pick it"]);
    expect(readBack(script, { ...s, notebook: [] })).toBe(script.lines.readyEmpty);
  });
});
