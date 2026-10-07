import { readdir } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";
import { chatJson, MODELS } from "../engine/llm";
import { ChunkFile, Graph, Questions, type Chunk, type Topic } from "./schema";
import { existsSync, readJson, topicPaths, writeJson } from "./paths";
import { checkGraph } from "./validate";
import { formatLoc } from "./format";

// The LLM sees plain shapes; ids, patterns and counts are enforced afterwards
// by the real schema and the validator (strict JSON-schema modes reject many
// zod refinements).
const DraftNode = z.object({
  id: z.string(),
  label: z.string(),
  kind: z.enum(["core", "branch"]),
  needs: z.array(z.string()),
  goals: z.array(z.string()),
  facts: z.array(z.object({ id: z.string(), text: z.string(), required: z.boolean() })),
  lexicon: z.array(z.string()),
  misconception: z.object({ id: z.string(), says: z.string(), truth: z.string() }).nullable(),
  probes: z.object({ open: z.string(), why: z.string(), whatIf: z.string(), compute: z.string() }),
});
const DraftGraph = z.object({ nodes: z.array(DraftNode) });

const RULES = `You are building the knowledge graph for a learning-by-teaching study. A learner watches the lesson, then teaches it to an AI student ("Kai") who must know only what it is taught. The graph is used to track what Kai has been taught and what to ask next. Kai never sees the graph.

Rules:
- Core nodes: ids n01, n02, … in lesson order. Branch nodes (extension questions only, no goals): b1, b2, …
- Each node is one idea a learner could explain in a few sentences.
- "needs" lists direct prerequisites. No cycles. Core nodes never need branch nodes.
- Every core node serves at least one goal; every goal is served.
- 2–4 facts per node, ids <node>.f1, <node>.f2, …; at least one "required". A fact is one checkable statement, phrased the way the lesson phrases it, using the lesson's own examples where possible.
- lexicon: lower-case technical terms or symbols that name this idea (e.g. "regret", "ucb", "ε"). Kai is not allowed to use them before the idea is taught. Each term belongs to exactly one node.
- misconception: null, or a common wrong belief about this node. "says" is how a confused student would voice it; "truth" corrects it. id: m_<snake_case>.
- probes are Kai's questions, in a curious novice's voice, short, never containing the answer:
  - open: asked when Kai moves to this idea before it is taught. It may only use terms of the node's prerequisites (transitively), never its own terms.
  - why, whatIf: asked once the idea is explained; may use its own and its prerequisites' terms.
  - compute: a small calculation that can be done without a calculator.
- Facts must come from the sources. Prefer what the learner-facing sources say; use the reference sources for precision.`;

function sourceBlock(chunks: Chunk[]) {
  return chunks.map((c) => `[${c.id} · ${formatLoc(c.loc)}] ${c.text}`).join("\n");
}

export async function runDraft(topic: Topic, { force = false } = {}) {
  const p = topicPaths(topic.slug);
  const learner: Chunk[] = [];
  const reference: Chunk[] = [];
  for (const f of (await readdir(p.chunks)).filter((x) => x.endsWith(".json"))) {
    const file = await readJson(join(p.chunks, f), ChunkFile);
    const src = topic.sources.find((s) => s.id === file.sourceId);
    if (!src) continue;
    (src.role === "learner" ? learner : reference).push(...file.chunks);
  }
  if (!learner.length) throw new Error("no learner-facing chunks: run `pnpm content ingest` first");

  const goals = topic.goals.map((g) => `${g.id} (${g.level}): ${g.text}`).join("\n");
  const user = `Topic: ${topic.title}
Audience: ${topic.audience}
Learning goals:
${goals}
Number of core nodes: between ${topic.nodeBudget.min} and ${topic.nodeBudget.max}. Add 1–3 branch nodes.

LEARNER-FACING SOURCES (what participants watch or read):
${sourceBlock(learner)}

REFERENCE SOURCES (for precision only):
${sourceBlock(reference)}`;

  console.log(`draft   asking ${MODELS.draft} for the graph (${learner.length} learner + ${reference.length} reference chunks)…`);
  const g = await chatJson({
    model: MODELS.draft,
    name: "lesson_graph",
    schema: DraftGraph,
    maxTokens: 16000,
    messages: [
      { role: "system", content: RULES },
      { role: "user", content: user },
    ],
  });
  const graph = Graph.parse({
    topic: topic.slug,
    draftedBy: MODELS.draft,
    draftedAt: new Date().toISOString().slice(0, 10),
    goals: topic.goals,
    nodes: g.data.nodes,
  });

  console.log(`draft   asking for the question bank…`);
  const q = await chatJson({
    model: MODELS.draft,
    name: "question_bank",
    schema: Questions,
    maxTokens: 6000,
    messages: [
      {
        role: "system",
        content: `${RULES}

Now write the question bank for this graph:
- contradictions: one per misconception. Kai asks it, in a novice voice, when the learner teaches the misconception as fact. Its honest answer exposes the error, but it must not state the correction. Only terms of the misconception's node and its prerequisites.
- goalChecks: one per goal; asked when all of the goal's nodes are solid. "expects" is the answer a good teacher would give.
- exam: one per goal; Kai answers it at the end from what it was taught. "reference" is the correct answer.
- fallbacks: short lines that name no lesson content at all (dontKnow, listen, wrapUp).`,
      },
      { role: "user", content: JSON.stringify({ goals: topic.goals, nodes: graph.nodes }) },
    ],
  });

  const target = force || !existsSync(p.graphDraft) ? p.graphDraft : p.graphDraft.replace(".json", ".llm.json");
  const qTarget = force || !existsSync(p.questions) ? p.questions : p.questions.replace(".json", ".llm.json");
  await writeJson(target, graph);
  await writeJson(qTarget, q.data);
  const issues = checkGraph(topic, graph, { questions: q.data });
  console.log(
    `draft   wrote ${target} and ${qTarget}` +
      (target !== p.graphDraft ? " (kept the existing draft; compare and merge by hand, or use --force)" : "") +
      `\n        ${issues.filter((i) => i.level === "error").length} validation errors; run \`pnpm content validate ${topic.slug}\` for details` +
      `\n        tokens: ${g.usage.promptTokens + q.usage.promptTokens} in, ${g.usage.completionTokens + q.usage.completionTokens} out`,
  );
}
