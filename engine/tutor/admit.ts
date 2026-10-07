import type { Bundle } from "../../content/schema";
import { hasTerm } from "../../content/terms";
import { latest, type State } from "./state";

/**
 * Term stage of `admit`: lesson terms Kai may not use yet. A term is allowed
 * once its node has any notebook entry, or once the learner has used it.
 * (The claim stage, an LLM check of each statement against the notebook, is
 * left out of the MVP to keep each turn at two model calls.)
 */
export function forbiddenTerms(bundle: Bundle, state: State, draft: string): string[] {
  const touched = new Set([...latest(state).keys()].map((f) => f.split(".")[0]));
  const used = new Set(state.usedTerms.map((t) => t.toLowerCase()));
  const hits: string[] = [];
  for (const n of bundle.nodes) {
    if (touched.has(n.id)) continue;
    for (const t of n.lexicon) if (!used.has(t.toLowerCase()) && hasTerm(draft, t)) hits.push(t);
  }
  return [...new Set(hits)];
}
