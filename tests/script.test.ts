import { describe, expect, it } from "vitest";
import bundleJson from "../topics/bandits/bundle.json";
import scriptJson from "../topics/bandits/script.json";
import { Bundle } from "../content/schema";
import { ScriptFile } from "../content/pack";
import { initialScriptState, readBack, scriptOpening, takeScriptTurn, wroteNow } from "../engine/tutor/script";
import { latest, type State } from "../engine/tutor/state";
import type { Judgement } from "../engine/tutor/judge";
import { tidyReaction, type Reaction, type Turn } from "../engine/tutor/writer";

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

type React = (kind: Reaction, next: string | null, avoid: string[]) => Promise<string>;
async function talk(steps: { message: string; say: Say; elapsedMs?: number }[], start = initialScriptState(bundle, script), react?: React) {
  let state: State = start;
  const history: Turn[] = [{ role: "kai", text: scriptOpening(script) }];
  const out: Awaited<ReturnType<typeof takeScriptTurn>>[] = [];
  for (const s of steps) {
    const r = await takeScriptTurn(bundle, script, { message: s.message, history, state, elapsedMs: s.elapsedMs ?? 60_000 }, { judge: judgeWith(s.say), react: react && ((_b, _s, kind, _h, next, _m, avoid) => react(kind, next, avoid)) });
    history.push({ role: "learner", text: s.message }, { role: "kai", text: r.reply });
    state = r.state;
    out.push(r);
  }
  return out;
}

const long = "Every day you pick one of three cafés for lunch, and each one has good and bad days around its own average that you don't know.";

describe("Kai's fixed teaching questions", () => {
  it("follow the graph, ask about each rule the same way, end with one question, and name no lesson fact", () => {
    expect(Q.map((q) => q.id)).toEqual(["problem", "greedy", "greedy-long", "epsilon", "epsilon-long", "ucb", "ucb-example", "ucb-long", "choose", "anything"]);
    // the three rules get the same "how does it play out" question
    const long = Q.filter((q) => q.id.endsWith("-long")).map((q) => q.text.replace(/greedy|ε-greedy|UCB/, "X").replace(/^And if|^If/, "If"));
    expect(new Set(long).size).toBe(1);
    expect(scriptOpening(script)).toContain(Q[0]!.text);
    for (const q of Q) expect((q.text.match(/\?/g) ?? []).length, q.id).toBe(1);
    for (const q of Q) expect(q.text.trim().endsWith("?"), q.id).toBe(true);
    // nothing that tells the learner what a rule does or what goes wrong
    for (const q of Q) expect(q.text, q.id).not.toMatch(/wrong|stuck|favourite|explor|bonus|average|random|lock/i);
  });

  it("asks them in order, word for word, after Kai's own reaction", async () => {
    const steps = Q.map((_, i) => ({ message: `${long} (${i})`, say: { intent: "explain" as const, facts: [{ fact: "n01.f1", verdict: "correct" as const, quote: "" }] } }));
    const r = await talk(steps, undefined, async () => "Oh, so it's about lunch spots, nice.");
    r.slice(0, -1).forEach((x, i) => {
      expect(x.reply, `after question ${i + 1}`).toBe(`Oh, so it's about lunch spots, nice. ${Q[i + 1]!.text}`);
      expect(x.trace.script).toMatchObject({ asked: Q[i]!.id, next: Q[i + 1]!.id, sayMore: false, reaction: "answered" });
      expect(x.done).toBe(false);
    });
    // after the last one Kai wraps up and reads its notes back
    const last = r.at(-1)!;
    expect(last.done).toBe(true);
    expect(last.trace.move.type).toBe("wrapUp");
    expect(last.trace.readyReason).toBe("script");
    expect(last.trace.script.reaction).toBe("end");
    expect(last.reply).toContain(script.lines.ready);
    expect(last.reply).toContain("• ");
  });

  it("offline, repeats back what Kai wrote down in the learner's words", async () => {
    const r = await talk([{ message: long, say: { intent: "explain", facts: [{ fact: "n01.f1", verdict: "correct", quote: "" }] } }]);
    expect(r[0]!.reply).toBe(`Okay, I wrote down: “${long.replace(/\.$/, "")}”. ${Q[1]!.text}`);
  });

  it("gives the writer the fixed question, and keeps a reaction that names an untaught lesson term out", async () => {
    const seen: (string | null)[] = [];
    const r = await talk([{ message: long, say: { intent: "explain" } }], undefined, async (_k, next, avoid) => (seen.push(next), avoid.length ? "Got it, I like the lunch example." : "So that's like UCB with a bonus."));
    expect(seen[0]).toBe(Q[1]!.text);
    expect(r[0]!.trace.leaked).toEqual(expect.arrayContaining(["bonus"]));
    expect(r[0]!.trace.drafts).toHaveLength(2);
    expect(r[0]!.reply).toBe(`Got it, I like the lunch example. ${Q[1]!.text}`);
    // twice: a fixed line instead
    const r2 = await talk([{ message: long, say: { intent: "explain" } }], undefined, async () => "So that's like UCB with a bonus.");
    expect(r2[0]!.trace.fallback).toBe(true);
    expect(r2[0]!.reply).toBe(`${script.lines.wroteNothing} ${Q[1]!.text}`);
  });

  it("keeps logging what the learner taught in Kai's notebook, as before", async () => {
    const start: State = { ...initialScriptState(bundle, script), script: { at: 1, more: false, again: 0, skipped: [], back: false } };
    const r = await talk(
      [
        { message: "greedy always takes the best average so far and switches when another overtakes", say: { intent: "answer", facts: [{ fact: "n05.f1", verdict: "correct", quote: "" }] } },
        { message: "nothing goes wrong, the averages correct themselves over time", say: { intent: "answer", misconceptions: [{ node: "n06", quote: "nothing goes wrong, the averages correct themselves over time", belief: "self-correcting" }] } },
      ],
      start,
    );
    const st = r.at(-1)!.state;
    expect(latest(st).get("n05.f1")).toMatchObject({ verdict: "correct", words: "greedy always takes the best average so far and switches when another overtakes" });
    expect(st.misconceptions).toHaveLength(1);
    // the misconception is written down and repeated like anything else: Kai doesn't judge
    expect(r[1]!.reply).toContain("the averages correct themselves over time");
  });

  it("asks once to say more after a short answer to a question that wants an explanation", async () => {
    const r = await talk([
      { message: "choosing places to eat", say: { intent: "answer", facts: [{ fact: "n01.f1", verdict: "partial", quote: "" }] } },
      { message: "lunch spots", say: { intent: "answer" } },
    ]);
    expect(r[0]!.reply).toBe(`Okay, I wrote down: “choosing places to eat”. ${script.lines.sayMore}`);
    expect(r[0]!.trace.script.sayMore).toBe(true);
    expect(r[0]!.state.script).toMatchObject({ at: 0, more: true });
    // only once: the next short answer moves on
    expect(r[1]!.reply.endsWith(Q[1]!.text)).toBe(true);
    expect(r[1]!.reply).toContain(script.lines.wroteNothing);
  });

  it("moves on after a short no to the last \"anything else\" question", async () => {
    const start: State = { ...initialScriptState(bundle, script), script: { at: Q.length - 1, more: false, again: 0, skipped: [], back: false } };
    const r = await talk([{ message: "no", say: { intent: "answer" } }], start);
    expect(r[0]!.done).toBe(true);
  });

  it("re-asks once after a question to Kai or a reply that isn't an answer, then moves on", async () => {
    const r = await talk([
      { message: "what do you think it is?", say: { intent: "ask_kai" } },
      { message: "lol", say: { intent: "off_topic" } },
    ]);
    expect(r[0]!.reply).toBe(`${script.lines.askedKai} ${Q[0]!.text}`);
    expect(r[0]!.state.script).toMatchObject({ at: 0, again: 1 });
    expect(r[0]!.trace.script).toMatchObject({ asked: Q[0]!.id, next: Q[0]!.id, reaction: "askedKai" });
    // the second time it moves on, so nobody gets stuck
    expect(r[1]!.reply.endsWith(Q[1]!.text)).toBe(true);
    expect(r[1]!.state.script!.skipped).toEqual([0]);
  });

  it("comes back once to the questions left unanswered, after the last one", async () => {
    const start: State = { ...initialScriptState(bundle, script), script: { at: Q.length - 2, more: false, again: 0, skipped: [1], back: false } };
    const r = await talk(
      [
        { message: "idk", say: { intent: "unsure" } },
        { message: "no", say: { intent: "answer" } },
        { message: "still no idea", say: { intent: "unsure" } },
        { message: "no idea either", say: { intent: "unsure" } },
      ],
      start,
    );
    expect(r[0]!.reply).toBe(`${script.lines.dontKnow} ${Q.at(-1)!.text}`);
    // after the last question: the skipped ones, in order, each once, with the same words
    expect(r[1]!.reply.endsWith(`${script.lines.back} ${Q[1]!.text}`)).toBe(true);
    expect(r[1]!.trace.script).toMatchObject({ next: Q[1]!.id, back: true });
    expect(r[2]!.reply.endsWith(`${script.lines.back} ${Q.at(-2)!.text}`)).toBe(true);
    // not again: Kai wraps up
    expect(r[3]!.done).toBe(true);
  });

  it("doesn't come back to an unanswered \"anything else?\"", async () => {
    const start: State = { ...initialScriptState(bundle, script), script: { at: Q.length - 1, more: false, again: 0, skipped: [], back: false } };
    const r = await talk([{ message: "dunno", say: { intent: "unsure" } }], start);
    expect(r[0]!.done).toBe(true);
  });

  it("wraps up at the first message after the time is up, without asking for more", async () => {
    const r = await talk([{ message: "ok so you pick a lunch place", say: { intent: "answer", facts: [{ fact: "n01.f1", verdict: "partial", quote: "" }] }, elapsedMs: script.minutes * 60_000 + 1 }]);
    expect(r[0]!.done).toBe(true);
    expect(r[0]!.trace.readyReason).toBe("time");
    expect(r[0]!.reply).not.toContain(script.lines.sayMore);
    expect(r[0]!.reply.startsWith("Okay, I wrote down: “ok so you pick a lunch place”.")).toBe(true);
  });

  it("follows each question's idea, so Kai's mind and the help card know what Kai is asking about", async () => {
    const r = await talk(Q.slice(0, 4).map(() => ({ message: long, say: { intent: "explain" as const } })));
    expect(r.map((x) => x.state.focus)).toEqual(["n05", "n06", "n07", "n07"]);
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

  it("keeps a reaction to two sentences with no question of its own", () => {
    expect(tidyReaction('Kai: "Oh **nice**, so you go to the café you like best. That makes sense! Wait, what about the others? I see."')).toBe("Oh nice, so you go to the café you like best. That makes sense!");
    expect(tidyReaction("oh, so it is about choosing stuff")).toBe("Oh, so it is about choosing stuff.");
  });
});
