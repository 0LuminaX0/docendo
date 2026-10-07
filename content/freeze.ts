import { readdir } from "node:fs/promises";
import { join } from "node:path";
import { ChunkFile, Coverage, FrozenGraph, Graph, type Loc, type Topic } from "./schema";
import { readJson, topicPaths, writeJson } from "./paths";
import { graphHash } from "./hash";

/** Write graph.json: the draft plus a content hash, the sources, and per-node help locations. Run after strict validation. */
export async function runFreeze(topic: Topic) {
  const p = topicPaths(topic.slug);
  const graph = await readJson(p.graphDraft, Graph);
  const coverage = await readJson(p.coverage, Coverage);

  const loc = new Map<string, { sourceId: string; loc: Loc }>();
  for (const f of (await readdir(p.chunks)).filter((x) => x.endsWith(".json"))) {
    const file = await readJson(join(p.chunks, f), ChunkFile);
    for (const c of file.chunks) loc.set(c.id, { sourceId: c.sourceId, loc: c.loc });
  }
  const order = (id: string) => {
    const [src, n] = id.split("#");
    return topic.sources.findIndex((s) => s.id === src) * 10_000 + Number(n);
  };

  const where: FrozenGraph["where"] = {};
  for (const node of graph.nodes) {
    const ids = [...new Set(node.facts.flatMap((f) => coverage.facts[f.id]?.where ?? []))].sort((a, b) => order(a) - order(b));
    where[node.id] = ids.map((id) => loc.get(id)).filter((x): x is { sourceId: string; loc: Loc } => !!x);
  }

  const frozen: FrozenGraph = {
    ...graph,
    hash: graphHash(graph),
    frozenAt: new Date().toISOString(),
    sources: topic.sources,
    where,
  };
  await writeJson(p.graph, FrozenGraph.parse(frozen));
  console.log(`freeze  ${p.graph}  hash ${frozen.hash}`);
}
