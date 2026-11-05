import { describe, expect, it } from "vitest";
import bundleJson from "../topics/bandits/bundle.json";
import scriptJson from "../topics/bandits/script.json";
import { Bundle } from "../content/schema";
import { ScriptFile } from "../content/pack";
import { initialScriptState, readBack, scriptOpening, takeScriptTurn, wroteNow } from "../engine/tutor/script";
import { latest, type State } from "../engine/tutor/state";
import type { Judgement } from "../engine/tutor/judge";
import { tidyReaction, type Reaction, type Turn } from "../engine/tutor/writer";
import { hasTerm } from "../content/terms";

const bundle = Bundle.parse(bundleJson);
const script = ScriptFile.parse(scriptJson);
const Q = script.questions;
const byId = (id: string) => Q.find((q) => q.id === id)!;
const follow = (id: string, fact: string) => byId(id).follow.find((f) => f.fact === fact)!.text;

// a judge that returns what each test says, quoting the learner's message
type Say = Partial<Judgement> & { intent: Judgement["intent"] };
const judgeWith = (say: Say) => async (_b: Bundle, message: string): Promise<Judgement> => ({
  facts: [],
  misconceptions: [],
  termsUsed: [],
  ...say,
  ...(say.facts ? { facts: say.facts.map((f) => ({ ...f, quote: f.quote || message })) } : {}),
});
const ok = (...facts: string[]): Say => ({ intent: "answer", facts: facts.map((fact) => ({ fact, verdict: "correct" as const, quote: "" })) });
const vague = (...facts: string[]): Say => ({ intent: "answer", facts: facts.map((fact) => ({ fact, verdict: "partial" as const, quote: "" })) });

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
const asks = (r: { reply: string }, text: string) => r.reply.endsWith(text);
const at = (i: number): State => ({ ...initialScriptState(bundle, script), script: { ...initialScriptState(bundle, script).script!, at: i } });
const UCB = Q.findIndex((q) => q.id === "ucb");
const msg = "Every round it takes whichever option has the best average at that moment, and switches when another gets ahead.";

describe("Kai's teaching questions", () => {
  it("are built on the graph: in its order, each for teachable facts, with a follow-up per fact, saying nothing they ask about", () => {
    expect(Q.map((q) => q.id)).toEqual(["greedy", "greedy-long", "explore", "epsilon", "ucb", "ucb-why", "ucb-size", "ucb-long", "compare", "anything"]);
    const teachable = new Set(bundle.nodes.flatMap((n) => n.facts.filter((f) => f.required && f.teachable && f.assume).map((f) => f.id)));
    // every teachable fact has a question (and the two why-questions ask for a reason the lesson gives), and every
    // follow-up is for one of its question's facts
    const targets = new Set(Q.flatMap((q) => q.targets));
    for (const f of teachable) expect(targets.has(f), f).toBe(true);
    expect([...targets].filter((f) => !teachable.has(f))).toEqual(["n08.f1", "n11.f4"]);
    for (const q of Q) for (const f of q.follow) expect(q.targets, q.id).toContain(f.fact);
    // one question each, never saying what a rule does or what goes wrong
    for (const t of [...Q.map((q) => q.text), ...Q.flatMap((q) => q.follow.map((f) => f.text))]) {
      expect(t.trim().endsWith("?"), t).toBe(true);
      expect(t, t).not.toMatch(/wrong|stuck|lock|unlucky|badly|average|highest|shrink|grow|fixed|included|favourite|\bc\b|\bor (?:does|stay|is)/i);
    }
    // the main questions don't even say that a rule picks at random (a follow-up may, after the learner's answer)
    for (const q of Q) expect(q.text, q.id).not.toMatch(/random/i);
    expect(scriptOpening(script)).toContain(Q[0]!.text);
  });

  it("goes through the questions in order, the fixed text word for word after Kai's own reaction", async () => {
    // each answer teaches its question's facts, so the comparison (whose facts are taught by then) is skipped
    const facts = ["n05.f1", "n06.f1", "n08.f1", "n07.f1 n07.f2", "n11.f1", "n11.f4", "n11.f2", "n12.f1 n12.f2", ""];
    const asked = Q.filter((q) => q.id !== "compare");
    const r = await talk(facts.map((f) => ({ message: msg, say: f ? ok(...f.split(" ")) : { intent: "answer" } })), undefined, async () => "Oh, I see.");
    r.slice(0, -1).forEach((x, i) => {
      expect(x.reply, `after ${asked[i]!.id}`).toBe(`Oh, I see. ${asked[i + 1]!.text}`);
      expect(x.trace.script).toMatchObject({ asked: asked[i]!.id, next: asked[i + 1]!.id, probe: null });
    });
    expect(r.at(-2)!.trace.script.covered).toEqual(["compare"]);
    const last = r.at(-1)!;
    expect(last.done).toBe(true);
    expect(last.trace.readyReason).toBe("script");
    expect(last.reply).toContain(script.lines.ready);
  });

  it("skips a question whose facts the learner has already taught", async () => {
    // lock-in explained while answering the greedy question: "where does it end up?" is skipped
    const r = await talk([{ message: msg, say: ok("n05.f1", "n06.f1") }]);
    expect(asks(r[0]!, byId("explore").text)).toBe(true);
    expect(r[0]!.trace.script.covered).toEqual(["greedy-long"]);
    // everything in one message: straight to "anything else?"
    const all = await talk([{ message: msg, say: ok("n05.f1", "n06.f1", "n08.f1", "n07.f1", "n07.f2", "n11.f1", "n11.f4", "n11.f2", "n12.f1", "n12.f2") }]);
    expect(asks(all[0]!, byId("anything").text)).toBe(true);
  });

  it("opens a question the learner has already started on with its follow-up on what is still missing", async () => {
    // "is there a reason to pick what doesn't look best?" answered with ε-greedy's random picks, vaguely: Kai doesn't
    // ask how ε-greedy decides, but which options its random pick can land on
    const r = await talk([{ message: "yes, epsilon greedy sometimes picks something random to learn more", say: { intent: "answer", facts: [{ fact: "n08.f1", verdict: "correct", quote: "" }, { fact: "n07.f1", verdict: "partial", quote: "" }] } }], at(Q.findIndex((q) => q.id === "explore")));
    expect(asks(r[0]!, follow("epsilon", "n07.f2"))).toBe(true);
    expect(r[0]!.trace.script).toMatchObject({ next: "epsilon", probe: "n07.f2" });
    // then the other follow-up, and on
    const r2 = await talk([{ message: "any of them", say: ok("n07.f2") }, { message: "always the same", say: ok("n07.f1") }], r[0]!.state);
    expect(asks(r2[0]!, follow("epsilon", "n07.f1"))).toBe(true);
    expect(asks(r2[1]!, byId("ucb").text)).toBe(true);
  });

  it("asks a follow-up only for a fact still missing (or only vaguely taught), once, and never after a short complete answer", async () => {
    const short = await talk([{ message: "best average each round, switches when overtaken", say: ok("n05.f1") }]);
    expect(asks(short[0]!, byId("greedy-long").text)).toBe(true);
    const r = await talk([
      { message: "it picks the best one", say: vague("n05.f1") },
      { message: "hm, the best one I think", say: vague("n05.f1") },
    ]);
    expect(asks(r[0]!, follow("greedy", "n05.f1"))).toBe(true);
    expect(r[0]!.trace.script).toMatchObject({ probe: "n05.f1", next: "greedy" });
    // only once: then on to the next question
    expect(asks(r[1]!, byId("greedy-long").text)).toBe(true);
    // two facts missing: one follow-up each, in the file's order
    const e = await talk(
      [
        { message: "it sometimes picks at random", say: { intent: "answer" } },
        { message: "any of them", say: ok("n07.f2") },
        { message: "yes, same rate", say: ok("n07.f1") },
      ],
      at(Q.findIndex((q) => q.id === "epsilon")),
    );
    expect(asks(e[0]!, follow("epsilon", "n07.f2"))).toBe(true);
    expect(asks(e[1]!, follow("epsilon", "n07.f1"))).toBe(true);
    expect(asks(e[2]!, byId("ucb").text)).toBe(true);
  });

  it("doesn't ask again about a fact the learner answered wrongly: Kai believes it", async () => {
    const said = "it sticks with the best one forever and never switches";
    const r = await talk([{ message: said, say: { intent: "answer", facts: [], misconceptions: [{ node: "n05", fact: "n05.f1", quote: said, belief: "never switches" }] } }]);
    expect(asks(r[0]!, byId("greedy-long").text)).toBe(true);
    expect(r[0]!.state.misconceptions).toHaveLength(1);
  });

  it("asks nothing that names a lesson term the learner hasn't used: the bonus questions wait for the bonus", async () => {
    // UCB explained without its rule credited: its follow-up, then the two bonus questions wait
    const r = await talk([{ message: "it picks whichever looks best", say: { intent: "answer" } }, { message: "not sure", say: { intent: "unsure" } }], at(UCB));
    expect(asks(r[0]!, follow("ucb", "n11.f1"))).toBe(true);
    expect(r[1]!.trace.script.gated).toEqual(["ucb-why", "ucb-size"]);
    expect(r[1]!.trace.script.covered).toEqual([]);
    // "how does that play out?" names no term, so it is asked; its follow-ups, about the bonus, are not
    expect(asks(r[1]!, byId("ucb-long").text)).toBe(true);
    const more = await talk([{ message: "it tries all of them in turn I think", say: { intent: "answer" } }], { ...r[1]!.state });
    expect(asks(more[0]!, byId("compare").text)).toBe(true);
    // with UCB's rule taught, they are asked
    const b = await talk([{ message: "score is average plus a bonus, it takes the highest score", say: ok("n11.f1") }], at(UCB));
    expect(asks(b[0]!, byId("ucb-why").text)).toBe(true);
    for (const id of ["ucb-why", "ucb-size"]) expect(hasTerm(byId(id).text, "bonus"), id).toBe(true);
  });

  it("re-asks once after a question to Kai or a reply that isn't an answer, then moves on; that one comes back at the end", async () => {
    const r = await talk([
      { message: "what do you think it does?", say: { intent: "ask_kai" } },
      { message: "lol", say: { intent: "off_topic" } },
    ]);
    expect(r[0]!.reply).toBe(`${script.lines.askedKai} ${Q[0]!.text}`);
    expect(r[0]!.state.script).toMatchObject({ at: 0, again: 1 });
    expect(asks(r[1]!, Q[1]!.text)).toBe(true);
    expect(r[1]!.state.script!.skipped).toEqual([0]);
  });

  it("doesn't come back to a question answered with \"I don't know\"", async () => {
    const r = await talk([{ message: "no idea", say: { intent: "unsure" } }]);
    expect(r[0]!.reply).toBe(`${script.lines.dontKnow} ${Q[1]!.text}`);
    expect(r[0]!.state.script!.skipped).toEqual([]);
  });

  it("comes back once to a question that got no answer, after the last one, if its facts are still missing", async () => {
    const start: State = { ...at(Q.length - 1), script: { ...at(Q.length - 1).script!, skipped: [0] } };
    const r = await talk([{ message: "no, that's all", say: { intent: "answer" } }, { message: "still nothing", say: { intent: "unsure" } }], start);
    expect(r[0]!.reply.endsWith(`${script.lines.back} ${Q[0]!.text}`)).toBe(true);
    expect(r[0]!.trace.script).toMatchObject({ next: Q[0]!.id, back: true });
    expect(r[1]!.done).toBe(true);
  });

  it("keeps logging what the learner taught in Kai's notebook, and repeats it back offline", async () => {
    const r = await talk([{ message: msg, say: ok("n05.f1") }]);
    expect(latest(r[0]!.state).get("n05.f1")).toMatchObject({ verdict: "correct", words: msg });
    expect(r[0]!.reply.startsWith("Okay, I wrote down: “")).toBe(true);
  });

  it("wraps up at the first message after the time is up", async () => {
    const r = await talk([{ message: msg, say: ok("n05.f1"), elapsedMs: script.minutes * 60_000 + 1 }]);
    expect(r[0]!.done).toBe(true);
    expect(r[0]!.trace.readyReason).toBe("time");
  });

  it("follows each question's idea, so Kai's mind and the help card know what Kai is asking about", async () => {
    const r = await talk([{ message: msg, say: ok("n05.f1") }, { message: msg, say: ok("n06.f1") }]);
    expect(r.map((x) => x.state.focus)).toEqual(["n06", "n08"]);
  });

  it("gives the writer the question that follows, and keeps a reaction that names an untaught lesson term out", async () => {
    const seen: (string | null)[] = [];
    const r = await talk([{ message: msg, say: ok("n05.f1") }], undefined, async (_k, next, avoid) => (seen.push(next), avoid.length ? "Got it." : "So that's like a bonus thing."));
    expect(seen[0]).toBe(byId("greedy-long").text);
    expect(r[0]!.trace.leaked).toEqual(expect.arrayContaining(["bonus"]));
    expect(r[0]!.reply).toBe(`Got it. ${byId("greedy-long").text}`);
    // the rules' names are no leak: Kai knows them from the slides
    const n = await talk([{ message: msg, say: ok("n05.f1") }], undefined, async () => "So unlike UCB, greedy just takes the best one.");
    expect(n[0]!.trace.leaked).toEqual([]);
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

  it("keeps a reaction to two sentences with no question of its own, decimals intact, a long echo cut", () => {
    expect(tidyReaction('Kai: "Oh **nice**, so you go to the café you like best. That makes sense! Wait, what about the others? I see."')).toBe("Oh nice, so you go to the café you like best. That makes sense!");
    expect(tidyReaction("oh, so it is about choosing stuff")).toBe("Oh, so it is about choosing stuff.");
    expect(tidyReaction("Oh, it explores 0.1 of the time. Got it.")).toBe("Oh, it explores 0.1 of the time. Got it.");
    const long = "Right, it tries each option once at the start and then sticks with whichever option has the best average reward and keeps picking it forever. And it never switches at all, whatever happens later in the game.";
    expect(tidyReaction(long)).toBe(`${long.split(". ")[0]}.`);
  });

  it("carries on from a state saved under an earlier version of the questions, from the first question not yet answered", async () => {
    // the 2026-11-03 script had ten questions: a session at its ninth, with its eighth waiting at the back
    const old: State = { ...initialScriptState(bundle, script), script: { at: 9, more: false, again: 0, skipped: [8], back: false, probe: null, probed: [], covered: [] } };
    const r = await talk([{ message: msg, say: ok("n05.f1") }], old);
    expect(asks(r[0]!, byId("greedy-long").text)).toBe(true);
    expect(r[0]!.trace.script).toMatchObject({ restart: true, next: "greedy-long" });
    expect(r[0]!.state.script!.ids).toBe(Q.map((q) => q.id).join(" "));
    // and from then on it is a session of this version
    const r2 = await talk([{ message: msg, say: ok("n06.f1") }], r[0]!.state);
    expect(r2[0]!.trace.script.restart).toBe(false);
  });

  it("keeps a question that waits for a term at the back, and asks it if the learner uses the term later", async () => {
    // UCB answered without the bonus: the bonus questions wait
    const r = await talk([{ message: "it picks whichever looks best", say: { intent: "unsure" } }], at(UCB));
    expect(r[0]!.trace.script.gated).toEqual(["ucb-why", "ucb-size"]);
    expect(r[0]!.state.script!.skipped).toContain(Q.findIndex((q) => q.id === "ucb-why"));
    // later the bonus comes up (UCB's rule taught): after the last question, the waiting one is asked
    const later = await talk([{ message: "oh and UCB's score is the average plus a bonus, it picks the highest", say: ok("n11.f1") }], { ...r[0]!.state, script: { ...r[0]!.state.script!, at: Q.length - 1 } });
    expect(asks(later[0]!, `${script.lines.back} ${byId("ucb-why").text}`)).toBe(true);
  });
});
