import { readdir } from "node:fs/promises";
import { join } from "node:path";
import { ChunkFile, Graph, type Chunk, type Location, type Locations, type Topic } from "./schema";
import { readJson, topicPaths, writeJson } from "./paths";
import { graphHash } from "./hash";

// Locate proposes candidates; it does not decide coverage. BM25 over the fact's
// words plus the node's label and terms, top 3 chunks per source. On the bandits
// transcripts this found the right passage in the top 3 for 19 of 26 facts;
// a small embedding model (bge-small) did worse (16), so it was dropped.
// Whether a fact is really covered is decided by `verify` (LLM) or a reviewer,
// and stored in coverage.json.

export const METHOD = "bm25 (fact + node label + terms), top 3 per source; candidates only";
const PER_SOURCE = 3;

const STOP = new Set(
  "a an the and or but of to in on at for from by with as is are was were be been being it its this that these those you your we our they their i me my he she his her them so if then than not no do does did can could would should will just only also more most very much many any each every one two which what who whom how why when where there here about into over after before up down out all same other such own too again".split(" "),
);

export function stem(w: string): string {
  if (w.length > 5 && w.endsWith("ing")) return w.slice(0, -3);
  if (w.length > 4 && w.endsWith("ed")) return w.slice(0, -2);
  if (w.length > 4 && w.endsWith("es")) return w.slice(0, -2);
  if (w.length > 3 && w.endsWith("s") && !w.endsWith("ss")) return w.slice(0, -1);
  return w;
}

export function tokens(text: string): string[] {
  return text
    .normalize("NFKC")
    .toLowerCase()
    .replace(/ε/g, " epsilon ")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .split(" ")
    .filter((w) => w.length > 1 && !STOP.has(w))
    .map(stem);
}

type Indexed = { chunk: Chunk; tf: Map<string, number>; len: number };

export function buildIndex(chunks: Chunk[]) {
  const docs: Indexed[] = chunks.map((chunk) => {
    const toks = tokens(chunk.text);
    const tf = new Map<string, number>();
    for (const t of toks) tf.set(t, (tf.get(t) ?? 0) + 1);
    return { chunk, tf, len: toks.length };
  });
  const df = new Map<string, number>();
  for (const d of docs) for (const t of d.tf.keys()) df.set(t, (df.get(t) ?? 0) + 1);
  const N = docs.length;
  const avgLen = docs.reduce((a, d) => a + d.len, 0) / Math.max(1, N);
  const idf = (t: string) => Math.log(1 + (N - (df.get(t) ?? 0) + 0.5) / ((df.get(t) ?? 0) + 0.5));
  return { docs, idf, avgLen };
}

export function rank(index: ReturnType<typeof buildIndex>, query: string[]) {
  const k1 = 1.2;
  const b = 0.75;
  const q = [...new Set(query)];
  const qWeight = q.reduce((a, t) => a + index.idf(t), 0) || 1;
  return index.docs
    .map((d) => {
      let score = 0;
      let covered = 0;
      for (const t of q) {
        const f = d.tf.get(t) ?? 0;
        if (!f) continue;
        covered += index.idf(t);
        score += index.idf(t) * ((f * (k1 + 1)) / (f + k1 * (1 - b + (b * d.len) / index.avgLen)));
      }
      return { doc: d, score, coverage: covered / qWeight };
    })
    .filter((r) => r.score > 0)
    .sort((a, b) => b.score - a.score);
}

/** A ~28-word window of the chunk around the densest run of query words. */
export function snippet(text: string, query: string[]): string {
  const words = text.split(/\s+/);
  const q = new Set(query);
  const hit = words.map((w) => (q.has(stem(w.toLowerCase().replace(/[^\p{L}\p{N}]/gu, ""))) ? 1 : 0));
  const W = 28;
  let best = 0;
  let bestAt = 0;
  for (let i = 0; i < Math.max(1, words.length - W + 1); i++) {
    const s = hit.slice(i, i + W).reduce<number>((a, x) => a + x, 0);
    if (s > best) [best, bestAt] = [s, i];
  }
  const part = words.slice(bestAt, bestAt + W).join(" ");
  return `${bestAt > 0 ? "… " : ""}${part}${bestAt + W < words.length ? " …" : ""}`;
}

export async function runLocate(topic: Topic) {
  const p = topicPaths(topic.slug);
  const graph = await readJson(p.graphDraft, Graph);
  const files = (await readdir(p.chunks)).filter((f) => f.endsWith(".json"));
  const chunks: Chunk[] = [];
  for (const f of files) {
    const file = await readJson(join(p.chunks, f), ChunkFile);
    if (topic.sources.some((s) => s.id === file.sourceId)) chunks.push(...file.chunks);
  }
  const role = new Map(topic.sources.map((s) => [s.id, s.role]));
  const index = buildIndex(chunks);

  const facts: Record<string, Location[]> = {};
  let found = 0;
  let total = 0;
  for (const node of graph.nodes) {
    for (const fact of node.facts) {
      total++;
      // the fact's own words, plus the node's terms and label (they name the idea)
      const query = tokens([fact.text, node.label, ...node.lexicon].join(" "));
      const ranked = rank(index, query);
      const perSource = new Map<string, number>();
      const locs: Location[] = [];
      for (const r of ranked) {
        const sid = r.doc.chunk.sourceId;
        if ((perSource.get(sid) ?? 0) >= PER_SOURCE) continue;
        perSource.set(sid, (perSource.get(sid) ?? 0) + 1);
        locs.push({
          chunkId: r.doc.chunk.id,
          sourceId: sid,
          role: role.get(sid) ?? "reference",
          loc: r.doc.chunk.loc,
          score: Math.round(r.score * 100) / 100,
          snippet: snippet(r.doc.chunk.text, query),
        });
      }
      // learner-facing places first, then by score
      locs.sort((a, b) => (a.role === b.role ? b.score - a.score : a.role === "learner" ? -1 : 1));
      facts[fact.id] = locs;
      if (locs.length) found++;
    }
  }

  const out: Locations = { method: METHOD, createdAt: new Date().toISOString(), graphHash: graphHash(graph), facts };
  await writeJson(p.locations, out);
  const learner = Object.values(facts).filter((l) => l.some((x) => x.role === "learner")).length;
  console.log(`locate  ${total} facts, candidates for ${found}, of which ${learner} in a learner-facing source  →  ${p.locations}`);
}
