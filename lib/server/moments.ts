import "server-only";
import { z } from "zod";
import type { Bundle } from "../../content/schema";
import type { LessonPart } from "../settings";

// Where in the lesson a fact is explained: the transcript passages that cover it (a pack's coverage.json), kept only
// where they fall inside the lesson's parts (from the settings, so an edited lesson is respected). Used for the
// practice hint ("rewatch the part that explains this") and to check the teaching help. One set per topic pack.

const Chunk = z.object({ id: z.string(), loc: z.object({ start: z.number(), end: z.number() }) });
const Coverage = z.object({ facts: z.record(z.string(), z.object({ where: z.array(z.string()).optional() }).passthrough()) });

export type Moment = { video: string; videoId: string; start: number; end: number; part: string };

export function makeMoments(bundle: Bundle, coverageJson: unknown, chunks: Record<string, unknown>) {
  const chunkTimes = new Map<string, { video: string; start: number; end: number }>();
  for (const [video, file] of Object.entries(chunks)) for (const c of z.object({ chunks: z.array(Chunk) }).parse(file).chunks) chunkTimes.set(c.id, { video, ...c.loc });
  const coverage = Coverage.parse(coverageJson).facts;

  /** The lesson part (from the settings) a passage of a known video falls in, by at least 10 s. */
  function partFor(parts: LessonPart[], video: string, start: number, end: number) {
    const videoId = bundle.videos.find((v) => v.id === video)?.videoId;
    return parts.find((p) => p.videoId === videoId && Math.min(p.end, end) - Math.max(p.start, start) >= 10) ?? null;
  }

  /** Up to `max` lesson moments that explain these facts, in the order the facts are given. */
  function momentsFor(factIds: string[], parts: LessonPart[], max = 2): Moment[] {
    const out: Moment[] = [];
    for (const f of factIds) {
      for (const cid of coverage[f]?.where ?? []) {
        const c = chunkTimes.get(cid);
        if (!c) continue;
        const seg = partFor(parts, c.video, c.start, c.end);
        if (!seg) continue;
        const m = { video: c.video, videoId: seg.videoId, start: Math.max(seg.start, c.start), end: Math.min(seg.end, c.end), part: seg.title };
        if (!out.some((o) => o.video === m.video && Math.abs(o.start - m.start) < 20)) out.push(m);
        break; // the first passage per fact is enough
      }
      if (out.length >= max) break;
    }
    return out;
  }

  /** Kai's help card (a moment of the lesson for the current question), only if it lies in the lesson as set up. */
  function helpInLesson(help: { video: string; start: number; end: number } | null, parts: LessonPart[]) {
    if (!help) return null;
    const p = partFor(parts, help.video, help.start, help.end);
    return p ? { ...help, start: Math.max(p.start, help.start), end: Math.min(p.end, help.end) } : null;
  }

  /** How much of the lesson's help survives an edit of the parts: facts with a Rewatch moment, ideas with a help card. */
  function lessonCoverage(parts: LessonPart[]) {
    const facts = bundle.nodes.filter((n) => n.inLesson !== false).flatMap((n) => n.facts.filter((f) => f.required && f.teachable));
    const ideas = bundle.nodes.filter((n) => n.inLesson !== false && n.help.length);
    return {
      facts: facts.filter((f) => momentsFor([f.id], parts, 1).length > 0).length,
      factsTotal: facts.length,
      ideas: ideas.filter((n) => helpInLesson(n.help[0] ?? null, parts)).length,
      ideasTotal: ideas.length,
      unknownVideos: parts.filter((p) => !bundle.videos.some((v) => v.videoId === p.videoId)).map((p) => p.videoId),
    };
  }

  return { momentsFor, helpInLesson, lessonCoverage };
}
