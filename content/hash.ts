import { createHash } from "node:crypto";
import type { Graph } from "./schema";

/** Stable JSON: object keys sorted, so the hash only changes when content changes. */
export function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object")
    return `{${Object.keys(value)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${canonical((value as Record<string, unknown>)[k])}`)
      .join(",")}}`;
  return JSON.stringify(value);
}

/** Hash of the graph's content (goals and nodes), ignoring who drafted it and when. */
export function graphHash(graph: Graph): string {
  return createHash("sha256").update(canonical({ goals: graph.goals, nodes: graph.nodes })).digest("hex").slice(0, 16);
}
