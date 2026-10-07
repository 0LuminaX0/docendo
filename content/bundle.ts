import { existsSync } from "node:fs";
import { readdir } from "node:fs/promises";
import { join } from "node:path";
import { Bundle, ChunkFile, Coverage, Graph, Questions, type Loc, type Topic } from "./schema";
import { readJson, topicPaths, writeJson } from "./paths";
import { graphHash } from "./hash";

// bundle.json: everything the web app needs about a topic, in one file.
// A fact is "teachable" when the learner-facing source covers it (coverage.json);
// Kai only waits for teachable facts before it feels ready.



export async function runBundle(topic: Topic) {
  const p = topicPaths(topic.slug);
  const graph = await readJson(existsSync(p.graph) ? p.graph : p.graphDraft, Graph);
  const coverage = await readJson(p.coverage, Coverage);
  const questions = await readJson(p.questions, Questions);

  const videos = topic.sources
    .filter((s) => s.role === "learner" && s.kind === "youtube")
    .map((s) => (s.kind === "youtube" ? { id: s.id, videoId: s.videoId, title: s.title, durationSec: s.durationSec } : { id: s.id, videoId: "", title: s.title }));
  if (!videos.length) throw new Error("the app needs at least one learner-facing YouTube source");

  const loc = new Map<string, { sourceId: string; loc: Loc }>();
  for (const f of (await readdir(p.chunks)).filter((x) => x.endsWith(".json"))) {
    const file = await readJson(join(p.chunks, f), ChunkFile);
    for (const c of file.chunks) loc.set(c.id, { sourceId: c.sourceId, loc: c.loc });
  }

  const nodes = graph.nodes.map((n) => {
    const where = [...new Set(n.facts.flatMap((f) => coverage.facts[f.id]?.where ?? []))];
    const help = where
      .map((id) => loc.get(id))
      .filter((x): x is { sourceId: string; loc: Extract<Loc, { kind: "time" }> } => !!x && x.loc.kind === "time")
      .map((x) => ({ video: x.sourceId, start: x.loc.start, end: x.loc.end }))
      .sort((a, b) => videos.findIndex((v) => v.id === a.video) - videos.findIndex((v) => v.id === b.video) || a.start - b.start);
    return {
      ...n,
      facts: n.facts.map((f) => {
        const d = coverage.facts[f.id];
        return { ...f, teachable: n.kind === "core" && (d?.status === "covered" || !!d?.accepted) };
      }),
      help,
    };
  });

  const bundle: Bundle = Bundle.parse({
    topic: topic.slug,
    title: topic.title,
    hash: graphHash(graph),
    builtAt: new Date().toISOString(),
    goals: topic.goals,
    videos,
    nodes,
    questions,
  });
  const out = join(p.dir, "bundle.json");
  await writeJson(out, bundle);
  const teachable = nodes.flatMap((n) => n.facts.filter((f) => f.teachable && f.required));
  console.log(`bundle  ${out}  ·  ${nodes.length} nodes, ${teachable.length} teachable required facts, ${videos.length} videos`);
}
