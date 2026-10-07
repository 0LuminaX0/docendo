import { existsSync } from "node:fs";
import { Coverage, Graph, Locations, Questions, type Topic } from "./schema";
import { readJson, topicPaths } from "./paths";
import { ancestors, termsIn } from "./terms";
import { graphHash } from "./hash";

export type Issue = { level: "error" | "warn"; where: string; msg: string };

/**
 * Structural checks on the graph and question bank. Pure, so tests can call it.
 * Without `locations` / `coverage` the matching checks are skipped.
 */
export function checkGraph(
  topic: Topic,
  graph: Graph,
  { questions, locations, coverage, strict = false }: { questions?: Questions; locations?: Locations; coverage?: Coverage; strict?: boolean } = {},
): Issue[] {
  const issues: Issue[] = [];
  const err = (where: string, msg: string) => issues.push({ level: "error", where, msg });
  const warn = (where: string, msg: string) => issues.push({ level: strict ? "error" : "warn", where, msg });

  const byId = new Map(graph.nodes.map((n) => [n.id, n]));
  const goalIds = new Set(topic.goals.map((g) => g.id));

  // ids
  const seen = new Set<string>();
  for (const n of graph.nodes) {
    if (seen.has(n.id)) err(n.id, "duplicate node id");
    seen.add(n.id);
    if (n.kind === "core" !== n.id.startsWith("n")) err(n.id, "core nodes are nNN, branch nodes are bN");
    n.facts.forEach((f, i) => {
      if (f.id !== `${n.id}.f${i + 1}`) err(n.id, `fact ${i + 1} should have id ${n.id}.f${i + 1}, has ${f.id}`);
    });
    if (!n.facts.some((f) => f.required)) err(n.id, "needs at least one required fact");
    for (const need of n.needs) if (!byId.has(need)) err(n.id, `needs unknown node ${need}`);
    for (const g of n.goals) if (!goalIds.has(g)) err(n.id, `unknown goal ${g}`);
    if (n.kind === "core" && n.goals.length === 0) err(n.id, "core node serves no goal");
    if (n.kind === "branch" && n.goals.length > 0) err(n.id, "branch nodes serve no goal");
    if (n.kind === "core" && n.needs.some((x) => byId.get(x)?.kind === "branch")) err(n.id, "core node depends on a branch node");
    if (n.lexicon.length === 0) warn(n.id, "empty lexicon: term leaks for this node can't be caught deterministically");
  }

  // goals from topic match the graph's copy
  for (const g of topic.goals) {
    if (!graph.goals.some((x) => x.id === g.id)) err(g.id, "goal missing from graph.goals");
    if (!graph.nodes.some((n) => n.goals.includes(g.id))) err(g.id, "no node serves this goal");
  }

  // budget
  const core = graph.nodes.filter((n) => n.kind === "core").length;
  if (core < topic.nodeBudget.min || core > topic.nodeBudget.max)
    err("graph", `${core} core nodes, budget is ${topic.nodeBudget.min}–${topic.nodeBudget.max}`);

  // cycles (DFS with colours)
  const colour = new Map<string, 0 | 1 | 2>();
  const visit = (id: string, path: string[]): void => {
    const c = colour.get(id) ?? 0;
    if (c === 1) {
      err(id, `cycle: ${[...path, id].join(" → ")}`);
      return;
    }
    if (c === 2) return;
    colour.set(id, 1);
    for (const x of byId.get(id)?.needs ?? []) visit(x, [...path, id]);
    colour.set(id, 2);
  };
  for (const n of graph.nodes) visit(n.id, []);
  if (!graph.nodes.some((n) => n.needs.length === 0)) err("graph", "no root node (a node with no prerequisites)");

  // lexicon: a term belongs to one node
  const owner = new Map<string, string>();
  for (const n of graph.nodes)
    for (const t of n.lexicon) {
      const k = t.toLowerCase();
      if (owner.has(k) && owner.get(k) !== n.id) warn(n.id, `term "${t}" also in ${owner.get(k)}`);
      owner.set(k, n.id);
    }

  // probes must not name ideas Kai can't know yet:
  // `open` is asked before the node is taught → only ancestors' terms;
  // why / whatIf / compute are asked once it is explained → ancestors' and its own terms.
  for (const n of graph.nodes) {
    const anc = ancestors(graph, n.id);
    const foreign = (allowSelf: boolean) =>
      graph.nodes.filter((m) => !anc.has(m.id) && !(allowSelf && m.id === n.id));
    for (const hit of termsIn(n.probes.open, foreign(false)))
      err(n.id, `open probe uses "${hit.term}" from ${hit.node}, which isn't taught yet when it is asked`);
    for (const key of ["why", "whatIf", "compute"] as const)
      for (const hit of termsIn(n.probes[key], foreign(true)))
        err(n.id, `${key} probe uses "${hit.term}" from ${hit.node}, which is not a prerequisite`);
    for (const f of n.facts) {
      if (f.required && n.kind === "core" && !f.ask) err(f.id, "required fact has no question (ask) for Kai to follow up with");
      // asked while the idea may not be taught yet: only prerequisites' terms
      if (f.ask) for (const hit of termsIn(f.ask, foreign(false))) err(f.id, `question uses "${hit.term}" from ${hit.node}, which may not be taught when it is asked`);
    }
    if (n.misconception) {
      for (const hit of termsIn(n.misconception.says, foreign(true)))
        err(n.id, `misconception line uses "${hit.term}" from ${hit.node}, which is not a prerequisite`);
    }
  }

  // question bank
  if (questions) {
    const mIds = new Map(graph.nodes.flatMap((n) => (n.misconception ? [[n.misconception.id, n.id] as const] : [])));
    for (const c of questions.contradictions) {
      if (mIds.get(c.misconception) !== c.node) err("questions", `contradiction for ${c.misconception} should point at ${mIds.get(c.misconception) ?? "an existing misconception"}`);
      const anc = ancestors(graph, c.node);
      for (const hit of termsIn(c.question, graph.nodes.filter((m) => !anc.has(m.id) && m.id !== c.node)))
        err("questions", `contradiction for ${c.misconception} uses "${hit.term}" from ${hit.node}`);
    }
    for (const id of mIds.keys())
      if (!questions.contradictions.some((c) => c.misconception === id)) warn("questions", `no contradiction question for ${id}`);
    for (const g of topic.goals) {
      if (!questions.goalChecks.some((q) => q.goal === g.id)) err("questions", `no goal check for ${g.id}`);
      if (!questions.exam.some((q) => q.goal === g.id)) err("questions", `no exam question for ${g.id}`);
    }
    const allNodes = graph.nodes;
    for (const [kind, lines] of Object.entries(questions.fallbacks))
      for (const line of lines)
        for (const hit of termsIn(line, allNodes)) err("questions", `fallback (${kind}) "${line}" uses "${hit.term}" from ${hit.node}`);
  }

  // freshness of derived files
  const hash = graphHash(graph);
  if (locations && locations.graphHash !== hash) warn("locations", "locations.json is older than the graph: re-run `pnpm content locate`");
  if (coverage && coverage.graphHash !== hash) warn("coverage", "coverage.json was decided on an older graph: re-check changed facts");

  // coverage of the learner-facing source (decided by verify or a reviewer)
  if (coverage) {
    for (const n of graph.nodes) {
      if (n.kind !== "core") continue;
      for (const f of n.facts) {
        const d = coverage.facts[f.id];
        if (!d) warn(f.id, "coverage not decided yet (run `pnpm content verify` or review it)");
        else if (f.required && d.status === "absent" && !d.accepted)
          warn(f.id, `required fact is not in the learner-facing source${d.note ? ` (${d.note})` : ""}`);
      }
    }
  }

  return issues;
}

export async function runValidate(topic: Topic, { strict }: { strict: boolean }): Promise<boolean> {
  const p = topicPaths(topic.slug);
  const graph = await readJson(p.graphDraft, Graph);
  const questions = existsSync(p.questions) ? await readJson(p.questions, Questions) : undefined;
  const locations = existsSync(p.locations) ? await readJson(p.locations, Locations) : undefined;
  const coverage = existsSync(p.coverage) ? await readJson(p.coverage, Coverage) : undefined;
  const issues = checkGraph(topic, graph, { questions, locations, coverage, strict });

  const errors = issues.filter((i) => i.level === "error");
  const warns = issues.filter((i) => i.level === "warn");
  for (const i of [...errors, ...warns]) console.log(`${i.level === "error" ? "ERROR" : "warn "}  ${i.where.padEnd(10)} ${i.msg}`);
  const core = graph.nodes.filter((n) => n.kind === "core").length;
  console.log(
    `validate  ${core} core + ${graph.nodes.length - core} branch nodes, ${graph.nodes.reduce((a, n) => a + n.facts.length, 0)} facts` +
      `  ·  ${errors.length} errors, ${warns.length} warnings${strict ? " (strict)" : ""}` +
      (questions ? "" : "  ·  no questions.json") +
      (locations ? "" : "  ·  no locations.json (run locate)") +
      (coverage ? "" : "  ·  no coverage.json (run verify)"),
  );
  return errors.length === 0;
}
