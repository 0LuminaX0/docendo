import { readdir } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";
import { chatJson, MODELS } from "../engine/llm";
import { ChunkFile, Coverage, Graph, Locations, type Chunk, type Topic } from "./schema";
import { existsSync, readJson, topicPaths, writeJson } from "./paths";
import { graphHash } from "./hash";
import { formatLoc } from "./format";

// Decide, per fact, whether the learner-facing source states it. One call per
// node, over the locate candidates from learner-facing sources. Existing
// decisions (e.g. a reviewer's) are kept unless --force.

const Reply = z.object({
  facts: z.array(
    z.object({
      fact: z.string(),
      status: z.enum(["covered", "partial", "absent"]),
      where: z.array(z.string()),
      note: z.string(),
    }),
  ),
});

const SYSTEM = `You check whether a lesson states given facts. For each fact, look only at the numbered passages.
- covered: a passage states the fact (in any wording; auto-generated captions have no punctuation and spell symbols out, e.g. "natural log of t").
- partial: a passage states part of it, or only implies it.
- absent: no passage states it.
"where" lists the ids of the passages that state it (empty when absent). "note" is one short sentence on what is missing, or empty.`;

export async function runVerify(topic: Topic, { force = false } = {}) {
  const p = topicPaths(topic.slug);
  const graph = await readJson(p.graphDraft, Graph);
  const locations = await readJson(p.locations, Locations);
  const existing = existsSync(p.coverage) ? await readJson(p.coverage, Coverage) : undefined;

  const learnerIds = new Set(topic.sources.filter((s) => s.role === "learner").map((s) => s.id));
  const chunks = new Map<string, Chunk>();
  for (const f of (await readdir(p.chunks)).filter((x) => x.endsWith(".json"))) {
    const file = await readJson(join(p.chunks, f), ChunkFile);
    if (learnerIds.has(file.sourceId)) for (const c of file.chunks) chunks.set(c.id, c);
  }

  const facts = { ...(existing?.facts ?? {}) };
  let asked = 0;
  for (const node of graph.nodes.filter((n) => n.kind === "core")) {
    const todo = node.facts.filter((f) => force || !facts[f.id]);
    if (!todo.length) continue;
    const ids = new Set(todo.flatMap((f) => (locations.facts[f.id] ?? []).filter((l) => l.role === "learner").map((l) => l.chunkId)));
    const passages = [...ids].map((id) => chunks.get(id)).filter((c): c is Chunk => !!c);
    const r = await chatJson({
      model: MODELS.verify,
      name: "coverage",
      schema: Reply,
      messages: [
        { role: "system", content: SYSTEM },
        {
          role: "user",
          content:
            `Facts:\n${todo.map((f) => `${f.id}: ${f.text}`).join("\n")}\n\nPassages:\n` +
            passages.map((c) => `[${c.id}, ${formatLoc(c.loc)}] ${c.text}`).join("\n"),
        },
      ],
    });
    asked++;
    for (const d of r.data.facts) {
      if (!todo.some((f) => f.id === d.fact)) continue;
      facts[d.fact] = {
        status: d.status,
        where: d.where.filter((w) => chunks.has(w)),
        ...(d.note ? { note: d.note } : {}),
      };
    }
    process.stdout.write(`\rverify  ${asked} nodes checked`);
  }
  const out: Coverage = {
    decidedBy: existing && !force ? `${existing.decidedBy}; gaps filled by ${MODELS.verify}` : MODELS.verify,
    decidedAt: new Date().toISOString().slice(0, 10),
    graphHash: graphHash(graph),
    facts,
  };
  await writeJson(p.coverage, out);
  const n = Object.values(facts);
  console.log(
    `\nverify  covered ${n.filter((d) => d.status === "covered").length}, partial ${n.filter((d) => d.status === "partial").length}, absent ${n.filter((d) => d.status === "absent").length}  →  ${p.coverage}`,
  );
}
