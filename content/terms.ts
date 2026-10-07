import type { Graph, Node } from "./schema";

// Shared by the validator now and by the graph module's `admit` later.

const norm = (s: string) => s.normalize("NFKC").toLowerCase();

/** True if `term` occurs in `text` as a whole word or phrase (case-insensitive, Unicode-aware). */
export function hasTerm(text: string, term: string): boolean {
  const t = norm(term).replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/\s+/g, "\\s+");
  return new RegExp(`(?<![\\p{L}\\p{N}])${t}(?![\\p{L}\\p{N}])`, "u").test(norm(text));
}

/** Lexicon terms from `nodes` that appear in `text`. */
export function termsIn(text: string, nodes: Iterable<Node>): { node: string; term: string }[] {
  const hits: { node: string; term: string }[] = [];
  for (const n of nodes) for (const term of n.lexicon) if (hasTerm(text, term)) hits.push({ node: n.id, term });
  return hits;
}

/** All prerequisites of a node, transitively (not including the node itself). */
export function ancestors(graph: Graph, id: string): Set<string> {
  const byId = new Map(graph.nodes.map((n) => [n.id, n]));
  const out = new Set<string>();
  const stack = [...(byId.get(id)?.needs ?? [])];
  while (stack.length) {
    const cur = stack.pop()!;
    if (out.has(cur)) continue;
    out.add(cur);
    stack.push(...(byId.get(cur)?.needs ?? []));
  }
  return out;
}
