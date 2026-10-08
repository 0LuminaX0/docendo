import "server-only";
import { z } from "zod";
import coverageJson from "../../topics/bandits/coverage.json";
import introChunks from "../../topics/bandits/sources/chunks/mab-intro.json";
import dmlChunks from "../../topics/bandits/sources/chunks/mab-dml.json";
import { bundle } from "./content";

// Where in the lesson a fact is explained: the transcript passages that cover
// it (coverage.json), kept only where they fall inside the lesson's segments.
// Used for the practice hint ("rewatch the part that explains this").

const Chunk = z.object({ id: z.string(), loc: z.object({ start: z.number(), end: z.number() }) });
const chunkTimes = new Map<string, { video: string; start: number; end: number }>();
for (const [video, file] of [["mab-intro", introChunks], ["mab-dml", dmlChunks]] as const)
  for (const c of z.object({ chunks: z.array(Chunk) }).parse(file).chunks) chunkTimes.set(c.id, { video, ...c.loc });
const coverage = z.object({ facts: z.record(z.string(), z.object({ where: z.array(z.string()).optional() }).passthrough()) }).parse(coverageJson).facts;

export type Moment = { video: string; videoId: string; start: number; end: number; part: string };

/** Up to `max` lesson moments that explain these facts, in the order the facts are given. */
export function momentsFor(factIds: string[], max = 2): Moment[] {
  const out: Moment[] = [];
  for (const f of factIds) {
    for (const cid of coverage[f]?.where ?? []) {
      const c = chunkTimes.get(cid);
      if (!c) continue;
      const seg = bundle.segments.length ? bundle.segments.find((s) => s.video === c.video && Math.min(s.end, c.end) - Math.max(s.start, c.start) >= 10) : null;
      if (bundle.segments.length && !seg) continue;
      const m = { video: c.video, videoId: bundle.videos.find((v) => v.id === c.video)?.videoId ?? "", start: Math.max(seg?.start ?? 0, c.start), end: Math.min(seg?.end ?? c.end, c.end), part: seg?.title ?? "" };
      if (!out.some((o) => o.video === m.video && Math.abs(o.start - m.start) < 20)) out.push(m);
      break; // the first passage per fact is enough
    }
    if (out.length >= max) break;
  }
  return out;
}
