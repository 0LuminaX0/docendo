import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { parse as parseYaml } from "yaml";
import { ancestors, hasTerm, termsIn } from "../content/terms";
import { checkGraph } from "../content/validate";
import { Coverage, Graph, Questions, Topic, type Node } from "../content/schema";
import { cueChunks, parseTimedText, parseVtt } from "../content/ingest/youtube";
import { detectSection, pdfChunks } from "../content/ingest/pdf";
import { webChunks } from "../content/ingest/web";
import { splitWords } from "../content/ingest/text";
import { buildIndex, rank, tokens } from "../content/authoring/locate";
import { layout } from "../content/authoring/review";
import { graphHash } from "../content/hash";

// ---------- fixtures ----------

const topic: Topic = Topic.parse({
  slug: "t",
  title: "T",
  audience: "students",
  goals: [{ id: "LG1", level: "Apply", text: "Compute the thing correctly." }],
  nodeBudget: { min: 2, max: 3 },
  sources: [{ id: "vid", kind: "youtube", role: "learner", title: "V", videoId: "e3L4VocZnnQ" }],
});

const node = (id: string, needs: string[], lexicon: string[], extra: Partial<Node> = {}): Node => ({
  id,
  label: id,
  kind: "core",
  needs,
  goals: ["LG1"],
  facts: [
    { id: `${id}.f1`, text: "A fact that is long enough.", required: true, ask: "A question that is long enough?" },
    { id: `${id}.f2`, text: "Another fact long enough.", required: false },
  ],
  lexicon,
  misconception: null,
  probes: { open: "What happens next here?", why: "Why is that so?", whatIf: "What if it changes?", compute: "What is two plus two?" },
  ...extra,
});

const graph = (nodes: Node[]): Graph => ({ topic: "t", draftedBy: "test", draftedAt: "2026-10-06", goals: topic.goals, nodes });

// ---------- terms ----------

describe("terms", () => {
  it("matches whole words and phrases, case-insensitively", () => {
    expect(hasTerm("So that's REGRET then?", "regret")).toBe(true);
    expect(hasTerm("regrettable", "regret")).toBe(false);
    expect(hasTerm("the upper   confidence bound", "upper confidence bound")).toBe(true);
    expect(hasTerm("alarm", "arm")).toBe(false);
  });
  it("handles symbols such as ε", () => {
    expect(hasTerm("with ε = 0.1", "ε")).toBe(true);
    expect(hasTerm("ε-greedy", "ε")).toBe(true);
    expect(hasTerm("what about α", "ε")).toBe(false);
  });
  it("finds ancestors transitively", () => {
    const g = graph([node("n01", [], ["a"]), node("n02", ["n01"], ["b"]), node("n03", ["n02"], ["c"])]);
    expect([...ancestors(g, "n03")].sort()).toEqual(["n01", "n02"]);
    expect(termsIn("a and c", g.nodes).map((h) => h.node)).toEqual(["n01", "n03"]);
  });
});

// ---------- validator ----------

describe("checkGraph", () => {
  const errors = (g: Graph, opts = {}) => checkGraph(topic, g, opts).filter((i) => i.level === "error").map((i) => i.msg);

  it("accepts a small valid graph", () => {
    expect(errors(graph([node("n01", [], ["alpha"]), node("n02", ["n01"], ["beta"])]))).toEqual([]);
  });

  it("requires a question per required fact, using only the prerequisites' terms", () => {
    const n02 = node("n02", ["n01"], ["beta"]);
    const noAsk = { ...n02, facts: n02.facts.map((f) => ({ ...f, ask: undefined })) };
    expect(errors(graph([node("n01", [], ["alpha"]), noAsk])).join()).toMatch(/no question/);
    const leaky = { ...n02, facts: n02.facts.map((f) => (f.required ? { ...f, ask: "Is beta the same as gamma here?" } : f)) };
    const n03 = node("n03", ["n02"], ["gamma"]);
    expect(errors(graph([node("n01", [], ["alpha"]), leaky, n03])).join()).toMatch(/"gamma" from n03/);
    const ok = { ...n02, facts: n02.facts.map((f) => (f.required ? { ...f, ask: "Is that like alpha, then?" } : f)) };
    expect(errors(graph([node("n01", [], ["alpha"]), ok]))).toEqual([]);
  });

  it("finds cycles", () => {
    const g = graph([node("n01", ["n02"], ["alpha"]), node("n02", ["n01"], ["beta"])]);
    expect(errors(g).some((m) => m.startsWith("cycle"))).toBe(true);
  });

  it("rejects an open probe that names the node's own idea", () => {
    const n2 = node("n02", ["n01"], ["beta"], {
      probes: { open: "So what is beta?", why: "Why beta?", whatIf: "What if not?", compute: "Two plus two?" },
    });
    const msgs = errors(graph([node("n01", [], ["alpha"]), n2]));
    expect(msgs.some((m) => m.includes('open probe uses "beta"'))).toBe(true);
    expect(msgs.some((m) => m.includes("why probe"))).toBe(false); // own terms are fine once explained
  });

  it("rejects a deepen probe that names an idea that is not a prerequisite", () => {
    const n2 = node("n02", ["n01"], ["beta"], {
      probes: { open: "What next?", why: "Is this like gamma?", whatIf: "What if not?", compute: "Two plus two?" },
    });
    const msgs = errors(graph([node("n01", [], ["alpha"]), n2, node("n03", ["n01"], ["gamma"])]));
    expect(msgs.some((m) => m.includes('why probe uses "gamma"'))).toBe(true);
  });

  it("checks fact ids, budget and goals", () => {
    const bad = node("n01", [], ["alpha"]);
    bad.facts[1]!.id = "n01.f7";
    const msgs = errors(graph([bad]));
    expect(msgs.some((m) => m.includes("should have id n01.f2"))).toBe(true);
    expect(msgs.some((m) => m.includes("budget"))).toBe(true);
  });

  it("warns when a required fact is missing from the learner source, unless accepted", () => {
    const g = graph([node("n01", [], ["alpha"]), node("n02", ["n01"], ["beta"])]);
    const coverage: Coverage = {
      decidedBy: "test",
      decidedAt: "2026-10-06",
      graphHash: graphHash(g),
      facts: {
        "n01.f1": { status: "absent", where: [] },
        "n01.f2": { status: "covered", where: ["vid#0"] },
        "n02.f1": { status: "absent", where: [], accepted: "taught through Kai's questions" },
        "n02.f2": { status: "partial", where: ["vid#1"] },
      },
    };
    const issues = checkGraph(topic, g, { coverage });
    expect(issues.map((i) => i.where)).toEqual(["n01.f1"]);
    expect(checkGraph(topic, g, { coverage, strict: true })[0]!.level).toBe("error");
  });
});

// ---------- ingest ----------

describe("youtube captions", () => {
  it("parses format 3 with word tags and skips [Music]", () => {
    const xml = `<timedtext format="3"><body><p t="0" d="3520">[Music]</p><p t="1680" d="3200"><s>hey</s><s t="240"> everyone</s></p><p t="5000" d="2000">it&amp;#39;s here</p></body></timedtext>`;
    expect(parseTimedText(xml)).toEqual([
      { start: 1.68, end: 4.88, text: "hey everyone" },
      { start: 5, end: 7, text: "it's here" },
    ]);
  });
  it("parses format 1", () => {
    expect(parseTimedText(`<transcript><text start="1.5" dur="2">a &amp; b</text></transcript>`)).toEqual([{ start: 1.5, end: 3.5, text: "a & b" }]);
  });
  it("parses WebVTT", () => {
    const vtt = "WEBVTT\n\n00:00:01.000 --> 00:00:03.500\nhello there\n\n00:01:02.000 --> 00:01:04.000\nsecond line";
    expect(parseVtt(vtt)).toEqual([
      { start: 1, end: 3.5, text: "hello there" },
      { start: 62, end: 64, text: "second line" },
    ]);
  });
  it("groups cues into ~30 s chunks with exact times", () => {
    const cues = Array.from({ length: 20 }, (_, i) => ({ start: i * 5, end: i * 5 + 5, text: `w${i}` }));
    const chunks = cueChunks("v", cues, 30);
    expect(chunks[0]!.loc).toEqual({ kind: "time", start: 0, end: 30 });
    expect(chunks.map((c) => c.id)).toEqual(["v#0", "v#1", "v#2", "v#3"]);
    expect(chunks.map((c) => c.text).join(" ").split(" ")).toHaveLength(20);
  });
});

describe("pdf chunks", () => {
  it("detects numbered section headings but not numbers", () => {
    expect(detectSection("2.4 Incremental Implementation")).toBe("2.4 Incremental Implementation");
    expect(detectSection("0.5 0.3 0.2")).toBeUndefined();
    expect(detectSection("2.3. The 10-armed Testbed 29")).toBeUndefined(); // running header
  });
  it("drops running headers, splits at headings and stamps printed pages", () => {
    const lines = [
      { page: 47, text: "2.1 A k-armed Bandit Problem" },
      { page: 47, text: "Consider the following learning problem." },
      { page: 48, text: "26 Chapter 2: Multi-armed Bandits" },
      { page: 48, text: "The objective is to maximize total reward." },
      { page: 49, text: "2.2 Action-value Methods" },
      { page: 49, text: "We begin by looking at methods for estimating values." },
    ];
    const chunks = pdfChunks("sb", lines, -22);
    expect(chunks).toHaveLength(2);
    expect(chunks[0]!.loc).toEqual({ kind: "page", page: 25, section: "2.1 A k-armed Bandit Problem" });
    expect(chunks[0]!.text).not.toContain("Chapter 2");
    expect(chunks[1]!.loc).toEqual({ kind: "page", page: 27, section: "2.2 Action-value Methods" });
  });
});

describe("web chunks", () => {
  it("splits at headings with ids", () => {
    const words = (n: number) => Array.from({ length: n }, (_, i) => `word${i}`).join(" ");
    const html = `<html><script>var x=1</script><body><p>${words(20)}</p><h2 id="regret">Regret</h2><p>${words(30)}</p><h3>No id</h3><p>${words(5)}</p></body></html>`;
    const chunks = webChunks("w", html);
    expect(chunks.map((c) => c.loc)).toEqual([
      { kind: "anchor", anchor: "top", heading: "Top" },
      { kind: "anchor", anchor: "regret", heading: "Regret" },
    ]);
    expect(chunks.some((c) => c.text.includes("var x"))).toBe(false);
  });
  it("splitWords keeps pieces near the target size", () => {
    const text = Array.from({ length: 50 }, (_, i) => `Sentence number ${i} has six words.`).join(" ");
    const pieces = splitWords(text, 60, 100);
    expect(pieces.length).toBeGreaterThan(3);
    for (const p of pieces) expect(p.split(" ").length).toBeLessThanOrEqual(66);
  });
});

// ---------- locate ----------

describe("locate", () => {
  it("normalises ε and simple plurals", () => {
    expect(tokens("ε-greedy restaurants")).toEqual(["epsilon", "greedy", "restaurant"]);
  });
  it("ranks the passage that shares rare words first", () => {
    const mk = (id: string, text: string) => ({ id, sourceId: "s", loc: { kind: "time" as const, start: 0, end: 1 }, text });
    const index = buildIndex([
      mk("a", "we go to the restaurant every night and eat"),
      mk("b", "the regret is the difference between the optimal happiness and ours"),
      mk("c", "subscribe for more videos every week"),
    ]);
    expect(rank(index, tokens("regret difference optimal"))[0]!.doc.chunk.id).toBe("b");
  });
});

// ---------- review layout ----------

describe("layout", () => {
  it("puts every node to the right of its prerequisites", () => {
    const nodes = [node("n01", [], ["a"]), node("n02", ["n01"], ["b"]), node("n03", ["n01", "n02"], ["c"]), node("n04", ["n01"], ["d"])];
    const { pos } = layout(nodes);
    for (const n of nodes) for (const p of n.needs) expect(pos[n.id]!.x).toBeGreaterThan(pos[p]!.x);
  });
});

// ---------- the real bandits topic ----------

describe("topics/bandits", () => {
  const dir = new URL("../topics/bandits/", import.meta.url);
  const t = Topic.parse(parseYaml(readFileSync(new URL("topic.yaml", dir), "utf8")));
  const g = Graph.parse(JSON.parse(readFileSync(new URL("graph.draft.json", dir), "utf8")));
  const q = Questions.parse(JSON.parse(readFileSync(new URL("questions.json", dir), "utf8")));

  it("has no validation errors", () => {
    expect(checkGraph(t, g, { questions: q }).filter((i) => i.level === "error")).toEqual([]);
  });
  it("keeps the agreed node ids", () => {
    const core = g.nodes.filter((n) => n.kind === "core").map((n) => n.id);
    for (let i = 1; i <= 14; i++) expect(core).toContain(`n${String(i).padStart(2, "0")}`);
  });
});

// ---------- graph layout on the real lesson graph ----------

import { BOX_H, BOX_W } from "../content/layout";

describe("layout of the bandits graph", () => {
  const g = Graph.parse(JSON.parse(readFileSync(new URL("../topics/bandits/graph.draft.json", import.meta.url), "utf8")));
  const L = layout(g.nodes);

  it("has at most 2 crossings between columns", () => {
    expect(L.crossings).toBeLessThanOrEqual(2);
  });

  it("routes every edge from its source box to its target box", () => {
    for (const n of g.nodes)
      for (const need of n.needs) {
        const pts = L.routes[`${need}>${n.id}`]!;
        expect(pts[0]).toEqual({ x: L.pos[need]!.x + BOX_W, y: L.pos[need]!.y + BOX_H / 2 });
        expect(pts[pts.length - 1]!.x).toBe(L.pos[n.id]!.x - 1);
      }
  });

  it("never runs an edge through another box", () => {
    for (const [key, pts] of Object.entries(L.routes)) {
      const [from, to] = key.split(">");
      for (const p of pts)
        for (const n of g.nodes) {
          if (n.id === from || n.id === to) continue;
          const b = L.pos[n.id]!;
          const inside = p.x > b.x && p.x < b.x + BOX_W && p.y > b.y && p.y < b.y + BOX_H;
          expect(inside, `${key} passes through ${n.id}`).toBe(false);
        }
    }
  });

  it("keeps boxes on whole grid rows and never overlapping", () => {
    const seen = new Set<string>();
    for (const n of g.nodes) {
      const p = L.pos[n.id]!;
      expect(((p.y - 20) / 64) % 1).toBe(0);
      const k = `${p.x},${p.y}`;
      expect(seen.has(k)).toBe(false);
      seen.add(k);
    }
  });
});
