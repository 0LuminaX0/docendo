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

  // the lesson slice (topic.yaml `lesson`): which nodes, which goal, which parts of the videos
  const lesson = topic.lesson;
  const byId = new Map(graph.nodes.map((n) => [n.id, n]));
  if (lesson) {
    for (const id of lesson.scope) if (!byId.has(id)) throw new Error(`lesson.scope: unknown node ${id}`);
    for (const id of lesson.scope) for (const need of byId.get(id)!.needs) if (!lesson.scope.includes(need)) throw new Error(`lesson.scope: ${id} needs ${need}, which is not in the lesson`);
    for (const s of lesson.segments) {
      const v = videos.find((x) => x.id === s.video);
      if (!v) throw new Error(`lesson.segments: ${s.video} is not a learner video`);
      if (s.start >= s.end || (v.durationSec && s.end > v.durationSec + 1)) throw new Error(`lesson.segments: bad range ${s.video} ${s.start}-${s.end}`);
    }
  }
  const inScope = (id: string) => !lesson || lesson.scope.includes(id);
  // a passage counts as watched if it overlaps a lesson segment by 10 s or more
  const watched = (r: { video: string; start: number; end: number }) =>
    !lesson || lesson.segments.some((s) => s.video === r.video && Math.min(s.end, r.end) - Math.max(s.start, r.start) >= 10);
  const clip = (r: { video: string; start: number; end: number }) => {
    if (!lesson) return r;
    const s = lesson.segments.find((x) => x.video === r.video && Math.min(x.end, r.end) - Math.max(x.start, r.start) >= 10)!;
    return { video: r.video, start: Math.max(s.start, r.start), end: Math.min(s.end, r.end) };
  };
  const timeOf = (chunkId: string) => {
    const x = loc.get(chunkId);
    return x && x.loc.kind === "time" ? { video: x.sourceId, start: x.loc.start, end: x.loc.end } : null;
  };

  // every idea of the graph: the lesson's, and around them the ones this lesson doesn't teach, so Kai's mind shows the
  // topic's whole tree and a learner who explains one anyway gets it noted (bonus). Kai never asks about those and
  // they never count: no goals, nothing required or teachable, no help.
  const nodes = graph.nodes
    .map((n) => {
      if (!inScope(n.id))
        return { ...n, inLesson: false, goals: [], facts: n.facts.map((f) => ({ ...f, required: false, teachable: false })), help: [] };
      const where = [...new Set(n.facts.flatMap((f) => coverage.facts[f.id]?.where ?? []))];
      const help = where
        .map(timeOf)
        .filter((x): x is { video: string; start: number; end: number } => !!x && watched(x))
        .map(clip)
        .sort((a, b) => videos.findIndex((v) => v.id === a.video) - videos.findIndex((v) => v.id === b.video) || a.start - b.start);
      return {
        ...n,
        inLesson: true,
        goals: lesson ? [lesson.goal.id] : n.goals,
        facts: n.facts.map((f) => {
          const d = coverage.facts[f.id];
          const covered = d?.status === "covered" ? (d.where ?? []).some((c) => { const t = timeOf(c); return !!t && watched(t); }) : !!d?.accepted;
          return { ...f, required: f.required && !lesson?.optional.includes(f.id), teachable: n.kind === "core" && covered };
        }),
        help,
      };
    });
  // the other ideas' terms are now in the bundle's own nodes (forbiddenTerms covers them); kept for older bundles
  const outOfScopeTerms: string[] = [];

  const bundle: Bundle = Bundle.parse({
    topic: topic.slug,
    title: topic.title,
    hash: graphHash(graph),
    builtAt: new Date().toISOString(),
    goals: lesson ? [lesson.goal] : topic.goals,
    videos,
    segments: (lesson?.segments ?? []).map((s) => ({ ...s, videoId: videos.find((v) => v.id === s.video)!.videoId })),
    nodes,
    outOfScopeTerms,
    questions,
  });
  const out = join(p.dir, "bundle.json");
  await writeJson(out, bundle);
  const teachable = nodes.flatMap((n) => n.facts.filter((f) => f.teachable && f.required));
  const lessonNodes = nodes.filter((n) => n.inLesson).length;
  const watchSec = lesson ? lesson.segments.reduce((a, x) => a + x.end - x.start, 0) : videos.reduce((a, v) => a + (v.durationSec ?? 0), 0);
  console.log(`bundle  ${out}:  ${lessonNodes} lesson ideas (${nodes.length} with the ones around them), ${teachable.length} teachable required facts, ${Math.floor(watchSec / 60)}:${String(Math.round(watchSec % 60)).padStart(2, "0")} of video`);
}
