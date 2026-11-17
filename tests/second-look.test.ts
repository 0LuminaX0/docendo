import { beforeEach, describe, expect, it, vi } from "vitest";

// The judge's model, replaced: the second look answers `look` (or fails), and every call is kept
let look: unknown = { why: "", verdict: "partial" };
const calls: { name: string; text: string }[] = [];
vi.mock("../engine/llm", async (original) => {
  const real = await original<typeof import("../engine/llm")>();
  return {
    ...real,
    chatJson: vi.fn(async (opts: { name: string; messages: { content: string }[] }) => {
      calls.push({ name: opts.name, text: opts.messages.map((m) => m.content).join("\n") });
      if (look instanceof Error) throw look;
      return { data: look, usage: { promptTokens: 0, completionTokens: 0 }, ms: 1 };
    }),
  };
});

import bundleJson from "../topics/bandits/bundle.json";
import { Bundle } from "../content/schema";
import { secondLook, type Judgement } from "../engine/tutor/judge";

const bundle = Bundle.parse(bundleJson);
const credited = (fact: string, verdict: "correct" | "partial" = "correct"): Judgement => ({ intent: "answer", facts: [{ fact, verdict, quote: "q" }], misconceptions: [], termsUsed: [] });
// pilot session 8 (2026-11-17): the wrong belief restated as a correction, credited as UCB's rule
const s8 = "no the highest bonus is UCB, greedy always picks the best mean";

beforeEach(() => {
  look = { why: "", verdict: "partial" };
  calls.length = 0;
});

describe("the second look at UCB's rule (2026-11-17)", () => {
  it("is asked of UCB's rule only, with that fact alone", async () => {
    expect(bundle.nodes.flatMap((n) => n.facts).filter((f) => f.confirm).map((f) => f.id)).toEqual(["n11.f1"]);
    await secondLook(bundle, s8, "", credited("n11.f1"));
    expect(calls.map((c) => c.name)).toEqual(["second_look"]);
    const ucb = bundle.nodes.flatMap((n) => n.facts).find((f) => f.id === "n11.f1")!;
    expect(calls[0]!.text).toContain(ucb.confirm);
    // no other fact's text or key in view
    for (const f of bundle.nodes.flatMap((n) => n.facts).filter((x) => x.id !== "n11.f1" && x.key)) expect(calls[0]!.text).not.toContain(f.key);
  });

  it("lowers a credit it doesn't confirm to partial, wrong included, and logs why", async () => {
    for (const verdict of ["partial", "wrong"] as const) {
      look = { why: "it says the highest bonus wins", verdict };
      const j = await secondLook(bundle, s8, "", credited("n11.f1"));
      expect(j.facts[0]!.verdict).toBe("partial");
      expect(j.dropped?.[0]?.fact).toMatch(/^n11\.f1 \(correct, the second look: /);
    }
  });

  it("keeps a credit it confirms, and never raises one", async () => {
    look = { why: "", verdict: "correct" };
    expect((await secondLook(bundle, "UCB adds a bonus to each average and picks the highest total", "", credited("n11.f1"))).facts[0]!.verdict).toBe("correct");
    // a partial isn't looked at again
    expect((await secondLook(bundle, "it adds a bonus", "", credited("n11.f1", "partial"))).facts[0]!.verdict).toBe("partial");
    // a fact without `confirm`: no call
    calls.length = 0;
    expect((await secondLook(bundle, "greedy always picks the best average so far", "", credited("n05.f1"))).facts[0]!.verdict).toBe("correct");
    expect(calls).toHaveLength(0);
  });

  it("looks at every teachable fact credited in a correction in practice, only flagged ones while teaching", async () => {
    // eval:sim (2026-11-17): "the other two bonuses just sit there until they're picked" credited as the growing bonus
    const sit = "Only the option you pick gets its bonus shrink, and the other two bonuses just sit there until they're picked.";
    expect((await secondLook(bundle, sit, "", credited("n12.f2"))).facts[0]!.verdict).toBe("correct");
    expect(calls).toHaveLength(0);
    const j = await secondLook(bundle, sit, "", credited("n12.f2"), undefined, true);
    expect(calls.map((c) => c.name)).toEqual(["second_look"]);
    expect(j.facts[0]!.verdict).toBe("partial");
    // a fact that isn't teachable (the given ones, the ideas around the lesson) is left as the judge read it
    calls.length = 0;
    await secondLook(bundle, "you keep the average of each option", "", credited("n03.f1"), undefined, true);
    expect(calls).toHaveLength(0);
  });

  it("counts a failed call as partial: a false credit hands the rule over in practice", async () => {
    look = new Error("timeout");
    const j = await secondLook(bundle, s8, "", credited("n11.f1"));
    expect(j.facts[0]!.verdict).toBe("partial");
    expect(j.dropped?.[0]?.fact).toMatch(/second look failed/);
  });
});
