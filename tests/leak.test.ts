import { beforeEach, describe, expect, it, vi } from "vitest";

// The solver's model, replaced: each test queues the replies it should give (the last one repeats), and every prompt
// it was sent is kept. The judge's check whether a note says a caveat's point ("covers") answers `covers` and is kept
// apart: it is told the point, the model writing Kai's steps never is
const replies: unknown[] = [];
const prompts: string[] = [];
const judged: string[] = [];
let covers = { quote: "", why: "", says: false };
vi.mock("../engine/llm", async (original) => {
  const real = await original<typeof import("../engine/llm")>();
  return {
    ...real,
    chatJson: vi.fn(async (opts: { name: string; messages: { content: string }[] }) => {
      const text = opts.messages.map((m) => m.content).join("\n");
      if (opts.name === "covers") return (judged.push(text), { data: covers, usage: { promptTokens: 0, completionTokens: 0 }, ms: 1 });
      prompts.push(text);
      const data = replies.length > 1 ? replies.shift() : replies[0];
      return { data, usage: { promptTokens: 0, completionTokens: 0 }, ms: 1 };
    }),
  };
});

import bundleJson from "../topics/bandits/bundle.json";
import practiceJson from "../topics/bandits/practice.json";
import { Bundle } from "../content/schema";
import { PracticeFile, caveatsOf } from "../content/practice";
import { initialState, type State } from "../engine/tutor/state";
import { backstopLeak, caveatFor, gapNamed, gate, offlineSolve, pointLeak, solve } from "../engine/tutor/solve";

const bundle = Bundle.parse(bundleJson);
const practice = PracticeFile.parse(practiceJson);
const item = (id: string) => practice.items.find((p) => p.id === id)!;
const p8 = item("p8");

// Session 5 of the team's tests (2026-11-17): UCB and both bonus facts credited, the growth without the slowing
const session5: State = {
  ...initialState(bundle),
  turn: 5,
  notebook: [
    { fact: "n05.f1", verdict: "correct", words: "Think it picks the favourite every round and changes arms when the favourite changes. Favourite is the arm with the highest estimated mean.", turn: 1 },
    { fact: "n08.f1", verdict: "correct", words: "yes, exploration", turn: 2 },
    { fact: "n11.f1", verdict: "correct", words: "It picks the arm with the highest estimated mean plus bonus, where the bonus grows with the number of rounds, when the option is not picked.", turn: 3 },
    { fact: "n12.f2", verdict: "correct", words: "It picks the arm with the highest estimated mean plus bonus, where the bonus grows with the number of rounds, when the option is not picked.", turn: 3 },
    { fact: "n12.f2", verdict: "correct", words: "It shrinks when it is picked and grows otherwise.", turn: 4 },
    { fact: "n12.f1", verdict: "correct", words: "It shrinks.", turn: 5 },
  ],
};

// Kai's first try at P8 in that session, word for word: the steady reading, with the slowing named as missing
const leaking = {
  steps: [
    { text: "My notes say UCB picks the arm with the highest estimated mean plus a bonus, and that the bonus grows with the number of rounds while an option isn't picked. Jazz is clearly the least liked, so its mean stays low and it only gets picked when its bonus has built up enough to beat the favourite.", notes: [3] },
    { text: "My notes also say the bonus shrinks when an option is picked and grows otherwise. So after each Jazz play its bonus drops, and it has to build back up again before Jazz is chosen once more. My notes don't say that this build-up gets slower over time, so I take it at a steady pace, catching up in about the same time as before.", notes: [4] },
    { text: "Taking that steady pace, Jazz should still come back about once every 100 hours at hour 50,000, just as it did around hour 1,000. So it is not played more often and does not stop, and the answer is that it is played about once every 100 hours.", notes: [] },
  ],
  answer: "1",
};
// the same reading, as the rules want it: its own understanding, nothing about what the notes leave out
const clean = {
  steps: [
    { text: "UCB plays the playlist with the highest score, its average plus its bonus, and Jazz's average is low, so it only gets played when its bonus has built up enough.", notes: [3] },
    { text: "After each play Jazz's bonus drops, and while it isn't played its bonus grows back at a steady pace, so it catches up in about the same time as before.", notes: [4] },
    { text: "So UCB keeps playing Jazz about once every 100 hours, as it did around hour 1,000.", notes: [] },
  ],
  answer: "1",
};
const said = (s: { steps: { text: string }[] }) => s.steps.map((x) => x.text).join(" ");

beforeEach(() => {
  replies.length = 0;
  prompts.length = 0;
  judged.length = 0;
  covers = { quote: "", why: "", says: false };
});

describe("Kai never hands the learner the point it misreads (2026-11-17)", () => {
  it("brings session 5's notebook to P8's backstop", () => {
    expect(gate(p8, session5).canBeRight).toBe(true);
    expect(caveatFor(practice.items, p8, session5, 1)?.id).toBe("slowing");
  });

  it("finds session 5's leak, and nothing in the wordings Kai is meant to use", () => {
    const steps = leaking.steps;
    expect(pointLeak(p8, session5, steps, true)).toMatch(/leave out/);
    expect(pointLeak(p8, session5, steps, false)).toMatch(/slowing/);
    // with the slowing in the notes, saying it is following them
    const taught: State = { ...session5, notebook: [...session5.notebook, { fact: "n12.f2", verdict: "correct", words: "the bonus keeps growing but slower and slower", turn: 6 }] };
    expect(pointLeak(p8, taught, steps, false)).toBeNull();
    expect(pointLeak(p8, session5, clean.steps, true)).toBeNull();
    // every planted misreading and opening, as the offline attempt writes them
    for (const p of practice.items)
      for (const c of caveatsOf(p)) expect(pointLeak(p, session5, [{ text: c.misreading, notes: [] }, { text: c.opening ?? "", notes: [] }], true), `${p.id} ${c.id ?? ""}`).toBeNull();
    // and every offline attempt at P8, whatever the notebook
    const partial: State = { ...session5, notebook: session5.notebook.map((e) => (e.fact === "n12.f2" ? { ...e, verdict: "partial" as const } : e)) };
    const empty = initialState(bundle);
    const noBonus: State = { ...session5, notebook: session5.notebook.filter((e) => !e.fact.startsWith("n12")) };
    for (const s of [session5, partial, empty, noBonus]) {
      const o = offlineSolve(bundle, p8, s, caveatFor(practice.items, p8, s, 1));
      if (!o.correct) expect(pointLeak(p8, s, o.steps, !!o.caveat), said(o)).toBeNull();
    }
    // the same rule on P7: a misreading that names greedy's switch as missing
    expect(pointLeak(item("p7"), session5, [{ text: "My notes don't mention greedy switching, so it sticks with B.", notes: [] }], true)).toMatch(/leave out/);
  });

  it("sets aside a reply that names the point, and shows the next clean one or the offline attempt", async () => {
    // every reply leaks: three tries set aside, then the offline attempt, which names nothing
    replies.push(leaking);
    const errors: string[] = [];
    const off = await solve(bundle, p8, session5, { demo: false, caveat: caveatFor(practice.items, p8, session5, 1), onError: (e) => errors.push(String(e)) });
    expect(errors).toHaveLength(3);
    expect(errors.every((e) => e.includes("leak:"))).toBe(true);
    expect([off.by, off.answer, off.correct, off.caveat]).toEqual(["offline", "A", false, "misread"]);
    expect(said(off)).not.toMatch(/slow|don't say|don't cover/i);
    // the first reply leaks, the second doesn't: the second is shown
    replies.length = 0;
    replies.push(leaking, clean);
    const second = await solve(bundle, p8, session5, { demo: false, caveat: caveatFor(practice.items, p8, session5, 1) });
    expect([second.by, second.answer, second.caveat]).toEqual(["model", "A", "misread"]);
    expect(said(second)).toBe(said(clean));
    // the solver is told not to name another reading or what its notes leave out, and is never told the point itself
    expect(prompts.at(-1)).toMatch(/Never mention any other reading, and never say what your notes don't say or leave out/);
    expect(prompts.at(-1)).not.toContain(caveatsOf(p8)[0]!.about);
  });

  it("never tells the model writing Kai's steps any caveat's point (2026-11-17)", async () => {
    // every caveat of every problem, in play: the prompt carries the misreading, never the point it misreads
    replies.push(clean);
    const all: State = { ...session5, notebook: [...session5.notebook, { fact: "n06.f1", verdict: "correct", words: "greedy can get stuck on an option that looks worse than it is", turn: 6 }] };
    for (const p of practice.items)
      for (const c of caveatsOf(p)) {
        prompts.length = 0;
        await solve(bundle, p, all, { demo: false, caveat: c }).catch(() => undefined);
        expect(prompts.length, `${p.id} ${c.id ?? ""}`).toBeGreaterThan(0);
        for (const x of prompts) {
          expect(x, `${p.id} ${c.id ?? ""}`).not.toContain(c.about);
          expect(x).toContain(c.misreading);
        }
      }
  });

  it("finds the slowing however it is put, and Kai's notes leaving things out however that is put", () => {
    const step = (text: string) => [{ text, notes: [] }];
    for (const t of [
      "the bonus grows more slowly as time goes on",
      "the bonus keeps growing, but by less each hour",
      "each extra hour adds a bit less to the bonus",
      "the increases get smaller over time",
      "the gaps between plays get longer",
      "it takes longer to catch up at hour 50,000",
      "with diminishing returns",
      "the bonus grows but at a decreasing rate",
      "the bonus rises quickly at first and then barely",
      "it grows by smaller and smaller amounts",
      "the bonus grows sub-linearly, like a square root",
      "the rate at which the bonus grows drops over time",
    ])
      expect(pointLeak(p8, session5, step(t), false), t).toMatch(/slowing/);
    for (const t of [
      "My notes say nothing about how fast it grows",
      "There's no mention in my notes of greedy switching",
      "I don't see anything in my notes about switching",
      "My notes don't really say whether greedy compares again",
      "My notes have nothing on whether the pace changes",
      "my notes aren't clear on whether greedy re-checks",
      "My notes only talk about the first days",
      "I wasn't told whether greedy can switch",
      "Whether greedy switches later isn't in my notes",
    ])
      expect(pointLeak(item("p7"), session5, step(t), true), t).toMatch(/leave out/);
  });

  it("sets aside an attempt at another problem, right or wrong, that states the slowing while the notes leave it open", async () => {
    const p2 = item("p2");
    const right = {
      steps: [
        { text: "Dialogues was picked, so its bonus shrinks and its score falls.", notes: [5] },
        { text: "Flashcards and Listening weren't picked, so their bonuses grow, though more slowly as the rounds go on.", notes: [4] },
        { text: "So Dialogues' score falls and the other two rise slightly.", notes: [] },
      ],
      answer: "1",
    };
    const plain = { ...right, steps: right.steps.map((x, i) => (i === 1 ? { ...x, text: "Flashcards and Listening weren't picked, so their bonuses grow a little." } : x)) };
    replies.push(right, plain);
    const errors: string[] = [];
    const s = await solve(bundle, p2, session5, { demo: false, items: practice.items, onError: (e) => errors.push(String(e)) });
    expect(errors[0]).toMatch(/leak:.*p8's slowing/);
    expect([s.by, s.correct]).toEqual(["model", true]);
    expect(said(s)).not.toMatch(/slow/i);
    // taught: saying it is following the notes
    const taught: State = { ...session5, notebook: [...session5.notebook, { fact: "n12.f2", verdict: "correct", words: "the bonus keeps growing but slower and slower", turn: 6 }] };
    expect(backstopLeak(practice.items, p2, taught, right.steps)).toBeNull();
    expect(backstopLeak(practice.items, p2, session5, right.steps)).toMatch(/slowing/);
    // and nothing the offline attempt writes at another problem states it (pnpm content validate checks the same)
    for (const p of practice.items.filter((x) => x.id !== "p8"))
      for (const st of [session5, initialState(bundle)]) expect(backstopLeak(practice.items, p, st, offlineSolve(bundle, p, st, caveatFor(practice.items, p, st, 0)).steps), p.id).toBeNull();
  });

  it("holds the backstop when the caller passes no caveat (a page from before a deploy)", async () => {
    replies.push(clean);
    const s = await solve(bundle, p8, session5, { demo: false });
    expect([s.answer, s.caveat, s.caveatId]).toEqual(["A", "misread", "slowing"]);
    const d = await solve(bundle, p8, session5, { demo: true });
    expect([d.answer, d.caveat, d.by]).toEqual(["A", "misread", "offline"]);
    expect(said(d)).not.toMatch(/slow/i);
  });

  it("sets aside a guess that states the slowing (the vague reading, gate shut)", async () => {
    const vague: State = { ...session5, notebook: session5.notebook.map((e) => (e.fact === "n12.f2" ? { ...e, verdict: "partial" as const } : e)) };
    expect(gate(p8, vague).canBeRight).toBe(false);
    replies.push({ ...clean, steps: [...clean.steps.slice(0, 2), { text: "Unless the growth slows down later, which my notes don't say, it stays about once every 100 hours.", notes: [] }] }, clean);
    const errors: string[] = [];
    const s = await solve(bundle, p8, vague, { demo: false, onError: (e) => errors.push(String(e)) });
    expect(errors[0]).toMatch(/leak:.*slowing/);
    expect([s.by, s.answer]).toEqual(["model", "A"]);
  });
});

describe("no wrong attempt names what its notes don't give it (2026-11-17)", () => {
  const p7 = item("p7");
  const p2 = item("p2");
  const given = (p: typeof p7, s: State) => `${p.prompt} ${s.notebook.map((e) => e.words).join(" ")}`;
  const empty = initialState(bundle);

  it("finds a gap named by what it lacks, and passes a gap only acknowledged", () => {
    const leaks: [typeof p7, string][] = [
      // a local session (2026-11-05) and the team's report (2026-11-17)
      [p7, "Day 4 gives B a 5, but my notes don't say greedy ever changes its choice after the trials, so I'll assume it keeps B."],
      [p2, "I don't have in my notes that the bonus shrinks, so I will guess it grows."],
      [p2, "I'm not sure whether a picked option's bonus shrinks, so I'd guess every bonus stays put."],
      [p2, "I'd guess the bonus of Flashcards just stays put rather than growing."],
      [p7, "My notes don't say a bad day makes greedy switch."],
      [p8, "My notes don't say how big the bonuses are or how quickly they shrink."],
      // naming the topic points too: "picked" is the very difference a guess that every bonus shrinks misses
      [p2, "My notes don't say what happens to a bonus when its option is picked, so this is my own guess."],
      [p2, "My notes say nothing about how these bonuses change."],
    ];
    for (const [p, t] of leaks) expect(gapNamed(t, given(p, empty)), t).not.toBeNull();
    const fine: [typeof p7, string][] = [
      [p2, "My notes don't cover this part, so I'd guess every bonus just shrinks as the rounds go by, picked or not."],
      [p2, "My notes don't cover this part."],
      [p8, "I don't have anything from the lecture to work with here, so I'll keep it simple."],
      [p7, "My notes say “greedy picks the best”, but I'm not sure how that applies here. I'd guess greedy just goes with whichever looks best after the first tries and stays with it."],
      [p2, "UCB picked Dialogues instead of Flashcards."],
    ];
    for (const [p, t] of fine) expect(gapNamed(t, given(p, empty)), t).toBeNull();
    // what the notes say is Kai's own: "my notes only say “…”" quotes them
    const vague: State = { ...empty, notebook: [{ fact: "n12.f1", verdict: "partial", words: "the bonus changes when you pick something", turn: 1 }] };
    expect(gapNamed("My notes only say “the bonus changes when you pick something”. The way I picture it, the bonus grows at a steady pace.", given(p2, vague))).toBeNull();
  });

  it("lets Kai say its notes back, but not use their words to name the gap", () => {
    const picked = "every time you pick an option its bonus gets smaller, picking the others doesn't make it smaller";
    const k = `${p2.prompt} ${picked}`;
    expect(gapNamed("My notes don't cover what happens to the bonus of an option that isn't picked.", k, picked)).not.toBeNull();
    expect(gapNamed("My notes just say every time you pick an option its bonus gets smaller.", k, picked)).toBeNull();
    // nor which options it concerns: the ones not picked
    expect(gapNamed("My notes don't cover this part for Flashcards and Listening.", k, picked)).not.toBeNull();
  });

  it("never names one in the offline attempt, whatever the notebook", () => {
    const wrongly: State = { ...session5, misconceptions: [{ node: "n05", fact: "n05.f1", words: "greedy picks the best one after the first tries and then always stays with it", turn: 6 }] };
    const thin: State = { ...empty, turn: 1, notebook: [{ fact: "n12.f2", verdict: "partial", words: "the bonus of an option you don't pick grows over time", turn: 1 }] };
    for (const p of practice.items)
      for (const s of [empty, thin, wrongly, session5]) {
        const o = offlineSolve(bundle, p, s, caveatFor(practice.items, p, s, 0));
        if (!o.correct) expect(gapNamed(said(o), given(p, s)), `${p.id}: ${said(o)}`).toBeNull();
      }
  });

  it("sets aside a guess that names its gap, shows the next clean try, and tells the model not to", async () => {
    const naming = { steps: [{ text: "My notes don't say greedy ever changes its choice after the trials.", notes: [] }, { text: "I'd guess greedy just goes with whichever looks best after the first tries and stays with it, so it keeps B.", notes: [] }], answer: "1" };
    const plain = { steps: [{ text: "My notes don't cover this part.", notes: [] }, { text: "I'd guess greedy just goes with whichever looks best after the first tries and stays with it, so it keeps B.", notes: [] }], answer: "1" };
    replies.push(naming, plain);
    const errors: string[] = [];
    const s = await solve(bundle, p7, empty, { demo: false, onError: (e) => errors.push(String(e)) });
    expect(errors[0]).toMatch(/leak:.*named what its notes don't give it/);
    expect([s.by, s.answer, said(s)]).toEqual(["model", "A", said(plain)]);
    expect(prompts[0]).toMatch(/never say what they don't say/);
    // every try names it: the offline attempt's fixed wording
    replies.length = 0;
    replies.push(naming);
    const off = await solve(bundle, p7, empty, { demo: false });
    expect([off.by, off.answer]).toEqual(["offline", "A"]);
    expect(said(off)).not.toMatch(/switch|chang/i);
  });

  it("sets aside a misconception's attempt that names its gap", async () => {
    const wrongly: State = { ...empty, turn: 1, misconceptions: [{ node: "n05", fact: "n05.f1", words: "greedy picks the best one after the first tries and then always stays with it", turn: 1 }] };
    replies.push({ steps: [{ text: "My notes say greedy stays with the best one after the first tries, and they don't say a bad day makes it switch.", notes: [1] }, { text: "So greedy keeps B.", notes: [] }], answer: "1" }, { steps: [{ text: "My notes say greedy stays with the best one after the first tries.", notes: [1] }, { text: "B won the trials, so greedy keeps B.", notes: [] }], answer: "1" });
    const errors: string[] = [];
    const s = await solve(bundle, p7, wrongly, { demo: false, onError: (e) => errors.push(String(e)) });
    expect(errors[0]).toMatch(/leak:/);
    expect([s.by, s.answer]).toEqual(["model", "A"]);
    expect(said(s)).not.toMatch(/switch/);
  });

  it("takes the key with a caveat in play only when the judge finds the point in a note", async () => {
    // P8 right from session 5's notes, which don't say the slowing (the eval's caveat case, 2026-11-17)
    const right = { steps: [{ text: "Each time Jazz is played its bonus shrinks, and it grows back while it isn't.", notes: [4] }, { text: "Jazz keeps getting picked, so its bonus keeps shrinking and it takes longer to win again each time: far less often.", notes: [] }], answer: "3" };
    replies.push(right, clean);
    const errors: string[] = [];
    const s = await solve(bundle, p8, session5, { demo: false, caveat: caveatFor(practice.items, p8, session5, 1), onError: (e) => errors.push(String(e)) });
    expect(errors[0]).toMatch(/leak: right with slowing's point, which no note says/);
    expect([s.answer, s.correct, s.caveat]).toEqual(["A", false, "misread"]);
    // the judge is told the point and reads the notes; the model writing Kai's steps never sees the point
    expect(judged[0]).toContain(caveatsOf(p8)[0]!.about);
    expect(prompts.every((x) => !x.includes(caveatsOf(p8)[0]!.about))).toBe(true);
    // a note that says it in other words: the key stands, as "covered"
    replies.length = 0;
    replies.push(right);
    covers = { quote: "It shrinks when it is picked and grows otherwise", why: "", says: true };
    const ok = await solve(bundle, p8, session5, { demo: false, caveat: caveatFor(practice.items, p8, session5, 1) });
    expect([ok.answer, ok.correct, ok.caveat]).toEqual(["C", true, "covered"]);
    // a yes whose quote is in no note is a no
    replies.length = 0;
    replies.push(right, clean);
    covers = { quote: "the bonus grows ever more slowly", why: "", says: true };
    const made = await solve(bundle, p8, session5, { demo: false, caveat: caveatFor(practice.items, p8, session5, 1) });
    expect([made.answer, made.caveat]).toEqual(["A", "misread"]);
  });
});
