import { z } from "zod";

// ---------- topic.yaml ----------

export const Goal = z.object({
  id: z.string().regex(/^LG\d+$/),
  level: z.string(), // Bloom level, e.g. "Apply"
  text: z.string().min(10),
});
export type Goal = z.infer<typeof Goal>;

const SourceBase = z.object({
  id: z.string().regex(/^[a-z0-9][a-z0-9-]*$/),
  title: z.string(),
  // learner: what participants watch or read; reference: only feeds the graph and the fact checks
  role: z.enum(["learner", "reference"]),
});

export const Source = z.discriminatedUnion("kind", [
  SourceBase.extend({
    kind: z.literal("youtube"),
    videoId: z.string().regex(/^[\w-]{11}$/),
    durationSec: z.number().int().positive().optional(), // shown on the watch page
  }),
  SourceBase.extend({
    kind: z.literal("pdf"),
    url: z.url(),
    // 1-based PDF page range to keep, inclusive
    pages: z.tuple([z.number().int().positive(), z.number().int().positive()]),
    // printed page = pdf page + pageOffset (books usually have front matter)
    pageOffset: z.number().int().default(0),
  }),
  SourceBase.extend({
    kind: z.literal("web"),
    url: z.url(),
  }),
]);
export type Source = z.infer<typeof Source>;

export const Topic = z.object({
  slug: z.string().regex(/^[a-z0-9-]+$/),
  title: z.string(),
  audience: z.string(),
  goals: z.array(Goal).min(1),
  nodeBudget: z.object({ min: z.number().int(), max: z.number().int() }),
  sources: z.array(Source).min(1),
});
export type Topic = z.infer<typeof Topic>;

// ---------- chunks (ingest output) ----------

export const Loc = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("time"), start: z.number(), end: z.number() }), // seconds
  z.object({ kind: z.literal("page"), page: z.number().int(), section: z.string().optional() }), // printed page
  z.object({ kind: z.literal("anchor"), anchor: z.string(), heading: z.string() }),
]);
export type Loc = z.infer<typeof Loc>;

export const Chunk = z.object({
  id: z.string(), // `${sourceId}#${n}`
  sourceId: z.string(),
  loc: Loc,
  text: z.string(),
});
export type Chunk = z.infer<typeof Chunk>;

export const ChunkFile = z.object({
  sourceId: z.string(),
  fetchedAt: z.string(),
  origin: z.string(), // url or file the text came from
  chunks: z.array(Chunk),
});
export type ChunkFile = z.infer<typeof ChunkFile>;

// ---------- graph ----------

const NodeId = z.string().regex(/^(n\d{2}|b\d)$/);
export const FactId = z.string().regex(/^(n\d{2}|b\d)\.f\d$/);

export const Fact = z.object({
  id: FactId,
  text: z.string().min(10),
  required: z.boolean(),
  // Kai's question for this fact, in a novice's voice. Answering it explains the
  // fact, but it must not contain the answer. Shown to the learner only once asked.
  ask: z.string().min(10).optional(),
});
export type Fact = z.infer<typeof Fact>;

export const Misconception = z.object({
  id: z.string().regex(/^m_[a-z0-9_]+$/),
  says: z.string(), // how Kai voices it, novice wording
  truth: z.string(), // what is actually the case (never shown to Kai's writer)
});
export type Misconception = z.infer<typeof Misconception>;

export const Probes = z.object({
  // asked when Kai moves to this node; may use only terms of the node's ancestors
  open: z.string().min(10),
  // asked to deepen once the node is explained; may also use the node's own terms
  why: z.string().min(10),
  whatIf: z.string().min(10),
  compute: z.string().min(10),
});

export const Node = z.object({
  id: NodeId,
  label: z.string(),
  kind: z.enum(["core", "branch"]),
  needs: z.array(NodeId),
  goals: z.array(z.string().regex(/^LG\d+$/)),
  facts: z.array(Fact).min(2).max(4),
  // terms Kai may not use before this node is in its notebook (lower case, matched as words)
  lexicon: z.array(z.string().min(1)),
  misconception: Misconception.nullable(),
  probes: Probes,
});
export type Node = z.infer<typeof Node>;

export const Graph = z.object({
  topic: z.string(),
  draftedBy: z.string(), // model id, or "manual: <who>"
  draftedAt: z.string(),
  goals: z.array(Goal),
  nodes: z.array(Node),
});
export type Graph = z.infer<typeof Graph>;

// ---------- question bank ----------

export const Questions = z.object({
  // asked once when the learner teaches a fact that matches a misconception
  contradictions: z.array(
    z.object({ misconception: z.string(), node: NodeId, question: z.string() }),
  ),
  // asked when every node of a goal is solid
  goalChecks: z.array(z.object({ goal: z.string(), question: z.string(), expects: z.string() })),
  // Kai's exam: one per goal, answered from the notebook
  exam: z.array(z.object({ goal: z.string(), question: z.string(), reference: z.string() })),
  // fixed lines the module can fall back on; they name no lesson content
  fallbacks: z.object({
    dontKnow: z.array(z.string()).min(1),
    listen: z.array(z.string()).min(1),
    wrapUp: z.array(z.string()).min(1),
  }),
});
export type Questions = z.infer<typeof Questions>;

// ---------- locate output ----------

export const Location = z.object({
  chunkId: z.string(),
  sourceId: z.string(),
  role: z.enum(["learner", "reference"]),
  loc: Loc,
  score: z.number(),
  snippet: z.string(),
});
export type Location = z.infer<typeof Location>;

export const Locations = z.object({
  method: z.string(),
  createdAt: z.string(),
  graphHash: z.string(),
  facts: z.record(z.string(), z.array(Location)),
});
export type Locations = z.infer<typeof Locations>;

// ---------- coverage decisions (verify output, or written by a reviewer) ----------

export const CoverageDecision = z.object({
  status: z.enum(["covered", "partial", "absent"]),
  // chunk ids in learner-facing sources that state the fact
  where: z.array(z.string()),
  note: z.string().optional(),
  // set when the team consciously keeps a required fact the learner source doesn't cover
  accepted: z.string().optional(),
});
export type CoverageDecision = z.infer<typeof CoverageDecision>;

export const Coverage = z.object({
  decidedBy: z.string(), // model id, or "manual: <who>"
  decidedAt: z.string(),
  graphHash: z.string(),
  facts: z.record(z.string(), CoverageDecision),
});
export type Coverage = z.infer<typeof Coverage>;

// ---------- frozen graph (what the engine reads) ----------

export const FrozenGraph = Graph.extend({
  hash: z.string(),
  frozenAt: z.string(),
  sources: z.array(Source),
  // per node: where the learner-facing source covers it (for the help card), in lesson order
  where: z.record(z.string(), z.array(z.object({ sourceId: z.string(), loc: Loc }))),
});
export type FrozenGraph = z.infer<typeof FrozenGraph>;

// ---------- app bundle (what the web app reads) ----------

export const BundleFact = z.object({ id: z.string(), text: z.string(), required: z.boolean(), teachable: z.boolean(), ask: z.string().optional() });
export const BundleNode = z.object({
  id: z.string(),
  label: z.string(),
  kind: z.enum(["core", "branch"]),
  needs: z.array(z.string()),
  goals: z.array(z.string()),
  facts: z.array(BundleFact),
  lexicon: z.array(z.string()),
  misconception: z.object({ id: z.string(), says: z.string(), truth: z.string() }).nullable(),
  probes: z.object({ open: z.string(), why: z.string(), whatIf: z.string(), compute: z.string() }),
  // where the learner-facing videos cover this node (seconds), for the help card
  help: z.array(z.object({ video: z.string(), start: z.number(), end: z.number() })),
});
export const Bundle = z.object({
  topic: z.string(),
  title: z.string(),
  hash: z.string(),
  builtAt: z.string(),
  goals: z.array(z.object({ id: z.string(), level: z.string(), text: z.string() })),
  videos: z.array(z.object({ id: z.string(), videoId: z.string(), title: z.string(), durationSec: z.number().optional() })),
  nodes: z.array(BundleNode),
  questions: Questions,
});
export type Bundle = z.infer<typeof Bundle>;
