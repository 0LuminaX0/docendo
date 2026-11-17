import { beforeEach, describe, expect, it, vi } from "vitest";

// The solver's model, replaced: each test queues the replies it should give (the last one repeats), and every prompt
// it was sent is kept
const replies: unknown[] = [];
const prompts: string[] = [];
vi.mock("../engine/llm", async (original) => {
  const real = await original<typeof import("../engine/llm")>();
  return {
    ...real,
    chatJson: vi.fn(async (opts: { messages: { content: string }[] }) => {
      prompts.push(opts.messages.map((m) => m.content).join("\n"));
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
import { caveatFor, gate, offlineSolve, pointLeak, solve } from "../engine/tutor/solve";

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
    // the solver is told not to name the point or what its notes leave out
    expect(prompts.at(-1)).toMatch(/never mention it or any reading other than yours, and never say what your notes don't say or leave out/);
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
