import { describe, expect, it } from "vitest";
import bundleJson from "../topics/bandits/bundle.json";
import scriptJson from "../topics/bandits/script.json";
// the same questions with their per-fact follow-ups (the pack's until 2026-11-12): the engine still supports them
import followJson from "../topics/bandits/stash/script-2026-11-05-follow-ups.json";
import { Bundle } from "../content/schema";
import { ScriptFile } from "../content/pack";
import { initialScriptState, readBack, scriptOpening, takeScriptTurn, wroteNow } from "../engine/tutor/script";
import { latest, type State } from "../engine/tutor/state";
import type { Judgement } from "../engine/tutor/judge";
import { tidyReaction, type Reaction, type Turn } from "../engine/tutor/writer";
import { hasTerm } from "../content/terms";

const bundle = Bundle.parse(bundleJson);
const script = ScriptFile.parse(scriptJson);
const withFollow = ScriptFile.parse(followJson);
const Q = script.questions;
const byId = (id: string) => Q.find((q) => q.id === id)!;
const follow = (id: string, fact: string) => withFollow.questions.find((q) => q.id === id)!.follow.find((f) => f.fact === fact)!.text;

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
async function talk(steps: { message: string; say: Say; elapsedMs?: number }[], start = initialScriptState(bundle, script), react?: React, sc = script) {
  let state: State = start;
  const history: Turn[] = [{ role: "kai", text: scriptOpening(sc) }];
  const out: Awaited<ReturnType<typeof takeScriptTurn>>[] = [];
  for (const s of steps) {
    const r = await takeScriptTurn(bundle, sc, { message: s.message, history, state, elapsedMs: s.elapsedMs ?? 60_000 }, { judge: judgeWith(s.say), react: react && ((_b, _s, kind, _h, next, _m, avoid) => react(kind, next, avoid)) });
    history.push({ role: "learner", text: s.message }, { role: "kai", text: r.reply });
    state = r.state;
    out.push(r);
  }
  return out;
}
const asks = (r: { reply: string }, text: string) => r.reply.endsWith(text);
const at = (i: number, sc = script): State => ({ ...initialScriptState(bundle, sc), script: { ...initialScriptState(bundle, sc).script!, at: i } });
const UCB = Q.findIndex((q) => q.id === "ucb");
const GREEDY = Q.findIndex((q) => q.id === "greedy");
// a question's place in another version of the questions (the stashed one with follow-ups still opens with the setup)
const ix = (sc: typeof script, id: string) => sc.questions.findIndex((q) => q.id === id);
const msg = "Every round it takes whichever option has the best average at that moment, and switches when another gets ahead.";

describe("Kai's teaching questions", () => {
  it("are built on the graph: in its order, each for teachable facts, saying nothing they ask about", () => {
    // six since 2026-11-16: the reason to explore is asked with where greedy ends up (the study's time: 7 to 10 messages)
    expect(Q.map((q) => q.id)).toEqual(["greedy", "greedy-long", "ucb", "ucb-why", "ucb-long", "anything"]);
    expect(script.maxFollowUps).toBe(3);
    const teachable = new Set(bundle.nodes.flatMap((n) => n.facts.filter((f) => f.required && f.teachable && f.assume).map((f) => f.id)));
    // every teachable fact has a question (and the two why-questions ask for a reason the lesson gives), and every
    // follow-up is for one of its question's facts
    const targets = new Set(Q.flatMap((q) => q.targets));
    for (const f of teachable) expect(targets.has(f), f).toBe(true);
    // the two reasons have no beginner's assumption: no practice problem needs them (the setup, n01.f1 and n01.f2, is
    // background Kai knows from the slides since 2026-11-12: no question asks for it)
    expect([...targets].filter((f) => !teachable.has(f))).toEqual(["n08.f1", "n11.f4"]);
    expect(Q.some((q) => q.targets.some((f) => f.startsWith("n01.")))).toBe(false);
    for (const q of Q) for (const f of q.follow) expect(q.targets, q.id).toContain(f.fact);
    // every teachable fact a question is there for has a follow-up (back since 2026-11-16: without them, what a learner
    // left out or said vaguely was never asked for by name, and two developers who knew the topic reached 2 of 7 facts)
    // and only for the facts the practice problems need (the study's time; lock-in has none: every prompt for it
    // would hand the learner the unlucky start)
    expect(Q.flatMap((q) => q.follow.map((f) => f.fact))).toEqual(["n05.f1", "n11.f1", "n12.f1", "n12.f2"]);
    // one question each, never saying what a rule does or what goes wrong (the stashed follow-ups included)
    for (const t of [...Q.map((q) => q.text), ...withFollow.questions.flatMap((q) => q.follow.map((f) => f.text))]) {
      expect(t.trim().endsWith("?"), t).toBe(true);
      expect(t, t).not.toMatch(/wrong|stuck|lock|unlucky|badly|average|highest|shrink|grow|fixed|included|favourite|\bc\b|\bor (?:does|stay|is)/i);
    }
    // the main questions don't even say that a rule picks at random (a follow-up may, after the learner's answer)
    for (const q of Q) expect(q.text, q.id).not.toMatch(/random/i);
    expect(scriptOpening(script)).toContain(Q[0]!.text);
  });

  it("goes through the questions in order, the fixed text word for word after Kai's own reaction", async () => {
    // each answer teaches its question's facts
    const facts = ["n05.f1", "n06.f1 n08.f1", "n11.f1", "n11.f4", "n12.f1 n12.f2", ""];
    const asked = Q;
    const r = await talk(facts.map((f) => ({ message: msg, say: f ? ok(...f.split(" ")) : { intent: "answer" } })), undefined, async () => "Oh, I see.");
    r.slice(0, -1).forEach((x, i) => {
      expect(x.reply, `after ${asked[i]!.id}`).toBe(`Oh, I see. ${asked[i + 1]!.text}`);
      expect(x.trace.script).toMatchObject({ asked: asked[i]!.id, next: asked[i + 1]!.id, probe: null });
    });
    const last = r.at(-1)!;
    expect(last.done).toBe(true);
    expect(last.trace.readyReason).toBe("script");
    expect(last.reply).toContain(script.lines.ready);
  });

  it("skips a question whose facts the learner has already taught", async () => {
    // lock-in and the reason to explore both given while answering the greedy question: "where does it end up?" is skipped
    const r = await talk([{ message: msg, say: ok("n05.f1", "n06.f1", "n08.f1") }], at(GREEDY));
    expect(asks(r[0]!, byId("ucb").text)).toBe(true);
    expect(r[0]!.trace.script.covered).toEqual(["greedy-long"]);
    // only lock-in: the question is asked as it stands (it has no follow-up: every prompt for lock-in gives the point away)
    const half = await talk([{ message: msg, say: ok("n05.f1", "n06.f1") }], at(GREEDY));
    expect(asks(half[0]!, byId("greedy-long").text)).toBe(true);
    // everything in one message: straight to "anything else?"
    const all = await talk([{ message: msg, say: ok("n01.f1", "n01.f2", "n05.f1", "n06.f1", "n08.f1", "n11.f1", "n11.f4", "n12.f1", "n12.f2") }]);
    expect(asks(all[0]!, byId("anything").text)).toBe(true);
  });

  it("asks its follow-up after a vague or partial answer, once, then moves on", async () => {
    // "the best one" leaves greedy's rule vague: Kai asks how greedy chooses in later rounds; vague again, it moves on
    const r = await talk([{ message: "it picks the best one", say: vague("n05.f1") }, { message: "the best one, like I said", say: vague("n05.f1") }], at(GREEDY));
    expect(asks(r[0]!, byId("greedy").follow[0]!.text)).toBe(true);
    expect(r[0]!.trace.script).toMatchObject({ probe: "n05.f1", next: "greedy" });
    expect(latest(r[0]!.state).get("n05.f1")?.verdict).toBe("partial");
    expect(asks(r[1]!, byId("greedy-long").text)).toBe(true);
    expect(r[1]!.trace.script).toMatchObject({ probe: null, next: "greedy-long" });
    // UCB over many rounds answered without the bonus facts: each gets its follow-up, then "anything else?"
    const e = await talk([{ message: "the bonus keeps changing", say: { intent: "answer", termsUsed: ["bonus"] } }, { message: "it gets smaller", say: ok("n12.f1") }, { message: "no idea", say: { intent: "unsure" } }], at(Q.findIndex((q) => q.id === "ucb-long")));
    expect(asks(e[0]!, byId("ucb-long").follow[0]!.text)).toBe(true);
    expect(asks(e[1]!, byId("ucb-long").follow[1]!.text)).toBe(true);
    expect(asks(e[2]!, byId("anything").text)).toBe(true);
    // a short answer that taught the fact gets no follow-up
    const ok1 = await talk([{ message: msg, say: ok("n05.f1") }], at(GREEDY));
    expect(asks(ok1[0]!, byId("greedy-long").text)).toBe(true);
    expect(ok1[0]!.trace.script.probe).toBe(null);
  });

  // the engine's follow-ups, on the stashed questions that have them
  it("with follow-ups, opens a question the learner has already started on with its follow-up on what is still missing", async () => {
    // "is there a reason to pick what doesn't look best?" answered with UCB, vaguely: Kai doesn't ask how UCB decides,
    // but which option it goes for in the end
    const F = withFollow.questions;
    const r = await talk([{ message: "yes, to learn more, UCB does that with some extra for options it hasn't tried much", say: { intent: "answer", facts: [{ fact: "n08.f1", verdict: "correct", quote: "" }, { fact: "n11.f1", verdict: "partial", quote: "" }] } }], at(F.findIndex((q) => q.id === "explore"), withFollow), undefined, withFollow);
    expect(asks(r[0]!, follow("ucb", "n11.f1"))).toBe(true);
    expect(r[0]!.trace.script).toMatchObject({ next: "ucb", probe: "n11.f1" });
    // answered: on to the next question
    const r2 = await talk([{ message: "the one with the highest average plus bonus", say: ok("n11.f1") }], r[0]!.state, undefined, withFollow);
    expect(asks(r2[0]!, F.find((q) => q.id === "ucb-why")!.text)).toBe(true);
  });

  it("with follow-ups, asks one only for a fact still missing (or only vaguely taught), once, and never after a short complete answer", async () => {
    const F = withFollow.questions;
    const short = await talk([{ message: "best average each round, switches when overtaken", say: ok("n05.f1") }], at(ix(withFollow, "greedy"), withFollow), undefined, withFollow);
    expect(asks(short[0]!, F.find((q) => q.id === "greedy-long")!.text)).toBe(true);
    const r = await talk(
      [
        { message: "it picks the best one", say: vague("n05.f1") },
        { message: "hm, the best one I think", say: vague("n05.f1") },
      ],
      at(ix(withFollow, "greedy"), withFollow),
      undefined,
      withFollow,
    );
    expect(asks(r[0]!, follow("greedy", "n05.f1"))).toBe(true);
    expect(r[0]!.trace.script).toMatchObject({ probe: "n05.f1", next: "greedy" });
    // only once: then on to the next question
    expect(asks(r[1]!, F.find((q) => q.id === "greedy-long")!.text)).toBe(true);
    // two facts missing: one follow-up each, in the file's order
    const e = await talk(
      [
        { message: "the bonus keeps changing", say: { intent: "answer", termsUsed: ["bonus"] } },
        { message: "it gets smaller", say: ok("n12.f1") },
        { message: "it grows, slower and slower", say: ok("n12.f2") },
      ],
      at(F.findIndex((q) => q.id === "ucb-long"), withFollow),
      undefined,
      withFollow,
    );
    expect(asks(e[0]!, follow("ucb-long", "n12.f1"))).toBe(true);
    expect(asks(e[1]!, follow("ucb-long", "n12.f2"))).toBe(true);
    expect(asks(e[2]!, byId("anything").text)).toBe(true);
  });

  it("asks at most maxFollowUps follow-ups a session (the study's time), then moves on without them", async () => {
    // vague on every fact with a follow-up: three follow-ups, the fourth question gets none
    const v = (f: string, m = "something vague") => ({ message: m, say: vague(f) });
    const r = await talk([v("n05.f1"), v("n05.f1"), v("n06.f1"), v("n11.f1", "a bonus thing"), v("n11.f1", "a bonus thing"), v("n11.f4", "a bonus"), v("n12.f1", "the bonus"), v("n12.f1", "the bonus")]);
    expect(asks(r[0]!, byId("greedy").follow[0]!.text)).toBe(true); // 1
    expect(asks(r[3]!, byId("ucb").follow[0]!.text)).toBe(true); // 2
    expect(asks(r[6]!, byId("ucb-long").follow[0]!.text)).toBe(true); // 3
    expect(r[6]!.state.script!.asked).toBe(3);
    expect(asks(r[7]!, byId("anything").text)).toBe(true); // the second bonus fact gets no follow-up: the budget is spent
    expect(r[7]!.trace.script.probe).toBe(null);
    // ten messages at most: six questions, three follow-ups, "anything else?" once more
    expect(Q.length + script.maxFollowUps! + byId("anything").again!.max).toBe(10);
  });

  it("asks its follow-up once after a wrong belief too, believing it; a right answer then retires the belief", async () => {
    const said = "it sticks with the best one forever and never switches";
    const wrong = { intent: "answer" as const, facts: [], misconceptions: [{ node: "n05", fact: "n05.f1", quote: said, belief: "never switches" }] };
    const r = await talk([{ message: said, say: wrong }, { message: msg, say: ok("n05.f1") }], at(GREEDY));
    expect(asks(r[0]!, byId("greedy").follow[0]!.text)).toBe(true);
    expect(r[0]!.state.misconceptions).toHaveLength(1);
    expect(asks(r[1]!, byId("greedy-long").text)).toBe(true);
    expect(latest(r[1]!.state).get("n05.f1")?.verdict).toBe("correct");
    // the belief stated again instead: Kai still believes it and moves on (the whole question isn't asked again either)
    const twice = await talk([{ message: said, say: wrong }, { message: said, say: wrong }], at(GREEDY));
    expect(asks(twice[1]!, byId("greedy-long").text)).toBe(true);
    expect(twice[1]!.state.misconceptions!.every((m) => m.fact === "n05.f1")).toBe(true);
    expect(latest(twice[1]!.state).get("n05.f1")).toBeUndefined();
  });

  it("asks nothing that names a lesson term the learner hasn't used: the bonus question waits for the bonus", async () => {
    // UCB explained without its rule credited: its follow-up first (it names no term), then the bonus question waits
    const r = await talk([{ message: "it picks whichever looks best", say: { intent: "answer" } }, { message: "not sure", say: { intent: "unsure" } }], at(UCB));
    expect(asks(r[0]!, byId("ucb").follow[0]!.text)).toBe(true);
    // both bonus questions wait (since 2026-11-16 "how does that play out?" asks about the bonus itself): "anything else?"
    expect(r[1]!.trace.script.gated).toEqual(["ucb-why", "ucb-long"]);
    expect(r[1]!.trace.script.covered).toEqual([]);
    expect(asks(r[1]!, byId("anything").text)).toBe(true);
    // with follow-ups: the one on UCB's rule comes first; those of "how does that play out?", about the bonus, wait too
    const f = await talk([{ message: "it picks whichever looks best", say: { intent: "answer" } }, { message: "not sure", say: { intent: "unsure" } }, { message: "it tries all of them in turn I think", say: { intent: "answer" } }], at(ix(withFollow, "ucb"), withFollow), undefined, withFollow);
    expect(asks(f[0]!, follow("ucb", "n11.f1"))).toBe(true);
    expect(f[1]!.trace.script.gated).toEqual(["ucb-why", "ucb-size"]); // the stashed questions still ask what sets the bonus
    expect(asks(f[1]!, withFollow.questions.find((q) => q.id === "ucb-long")!.text)).toBe(true);
    expect(asks(f[2]!, byId("anything").text)).toBe(true);
    // with UCB's rule taught, they are asked
    const b = await talk([{ message: "score is average plus a bonus, it takes the highest score", say: ok("n11.f1") }], at(UCB));
    expect(asks(b[0]!, byId("ucb-why").text)).toBe(true);
    expect(hasTerm(byId("ucb-why").text, "bonus")).toBe(true);
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

  it("asks \"anything else?\" again while the answers give Kai something new, once (the study's time), and ends on a no", async () => {
    const last = at(Q.length - 1);
    const again = byId("anything").again!.text;
    const r = await talk(
      [
        { message: "oh and greedy switches when another average overtakes the favourite", say: ok("n05.f1") },
        { message: "and every pick shrinks its own bonus", say: ok("n12.f1") },
      ],
      last,
    );
    expect(asks(r[0]!, again)).toBe(true);
    expect(r[1]!.done).toBe(true); // once at most
    const no = await talk([{ message: "oh and greedy switches when another average overtakes the favourite", say: ok("n05.f1") }, { message: "no, that's all", say: { intent: "answer" } }], last);
    expect(asks(no[0]!, again)).toBe(true);
    expect(no[1]!.done).toBe(true); // nothing new: done
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
    const r = await talk([{ message: msg, say: ok("n05.f1") }, { message: msg, say: ok("n06.f1") }], at(GREEDY));
    expect(r.map((x) => x.state.focus)).toEqual(["n06", "n11"]);
  });

  it("gives the writer the question that follows, and keeps a reaction that names an untaught lesson term out", async () => {
    const seen: (string | null)[] = [];
    const r = await talk([{ message: msg, say: ok("n05.f1") }], at(GREEDY), async (_k, next, avoid) => (seen.push(next), avoid.length ? "Got it." : "So that's like a bonus thing."));
    expect(seen[0]).toBe(byId("greedy-long").text);
    expect(r[0]!.trace.leaked).toEqual(expect.arrayContaining(["bonus"]));
    expect(r[0]!.reply).toBe(`Got it. ${byId("greedy-long").text}`);
    // the rules' names are no leak: Kai knows them from the slides
    const n = await talk([{ message: msg, say: ok("n05.f1") }], at(GREEDY), async () => "So unlike UCB, greedy just takes the best one.");
    expect(n[0]!.trace.leaked).toEqual([]);
  });

  it("keeps a reaction that completes half an answer out: it would answer the follow-up asked next (2026-11-17)", async () => {
    const LONG = Q.findIndex((q) => q.id === "ucb-long");
    const start: State = { ...at(LONG), usedTerms: ["bonus", "UCB"] };
    const half = "The bonus of an option that isn't picked keeps growing over time.";
    const say: Say = { intent: "answer", facts: [{ fact: "n12.f2", verdict: "partial", quote: "" }] };
    const seen: string[][] = [];
    const r = await talk([{ message: half, say }], start, async (_k, _n, avoid) => (seen.push(avoid), avoid.length ? "Oh, so it keeps growing while it waits." : "Oh, so it grows while it waits, and shrinks once it's picked."));
    expect(seen[1]).toEqual(["shrinks"]);
    expect(r[0]!.trace.leaked).toEqual(["shrinks"]);
    expect(r[0]!.reply).toMatch(/^Oh, so it keeps growing while it waits\. /);
    // the follow-up on the fact it would have answered
    expect(r[0]!.trace.script.probe).toBe("n12.f1");
    // both drafts add it: the fixed line instead
    const f = await talk([{ message: half, say }], start, async () => "Okay, it grows while it waits and drops once picked.");
    expect(f[0]!.trace.fallback).toBe(true);
    expect(f[0]!.reply).not.toMatch(/drop|shrink/);
    // saying back what they said, in other words of the same kind, is fine
    const e = await talk([{ message: half, say }], start, async () => "Ah, so a waiting option's bonus rises.");
    expect(e[0]!.trace.leaked).toEqual([]);
    // greedy's rule: "the highest" and "each round" only if the learner said so (Kai's own question may have)
    const g = await talk([{ message: "It goes with the best one.", say: vague("n05.f1") }], at(GREEDY), async () => "Hm, so it takes the highest average.");
    expect(g[0]!.trace.leaked).toEqual(["highest"]);
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
    const old: State = { ...initialScriptState(bundle, script), script: { at: 9, more: false, again: 0, skipped: [8], back: false, probe: null, probed: [], covered: [], repeats: 0 } };
    const r = await talk([{ message: msg, say: ok("n05.f1") }], old);
    // greedy's rule is answered now: the first question not yet answered is where greedy ends up
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
    expect(r[0]!.trace.script.gated).toEqual(["ucb-why", "ucb-long"]);
    expect(r[0]!.state.script!.skipped).toContain(Q.findIndex((q) => q.id === "ucb-why"));
    // later the bonus comes up (UCB's rule taught): after the last question, the waiting one is asked
    const later = await talk([{ message: "oh and UCB's score is the average plus a bonus, it picks the highest", say: ok("n11.f1") }], { ...r[0]!.state, script: { ...r[0]!.state.script!, at: Q.length - 1 } });
    expect(asks(later[0]!, `${script.lines.back} ${byId("ucb-why").text}`)).toBe(true);
  });
});
