import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { Chunk, ChunkFile, Source, Topic } from "../schema";
import { topicPaths, writeJson } from "../paths";
import { pdfChunks, readPdfLines } from "./pdf";
import { webChunks } from "./web";
import { cueChunks, fetchYoutubeCaptions, parseVtt } from "./youtube";

/** Ingest one source into sources/chunks/<id>.json. Raw downloads are cached in sources/raw. */
export async function ingestSource(topic: Topic, source: Source): Promise<ChunkFile> {
  const paths = topicPaths(topic.slug);
  await mkdir(paths.raw, { recursive: true });
  let chunks: Chunk[];
  let origin: string;

  switch (source.kind) {
    case "youtube": {
      const manual = join(paths.raw, `${source.id}.vtt`);
      if (existsSync(manual)) {
        chunks = cueChunks(source.id, parseVtt(await readFile(manual, "utf8")));
        origin = manual;
      } else {
        const { kind, cues } = await fetchYoutubeCaptions(source.videoId);
        chunks = cueChunks(source.id, cues);
        origin = `https://www.youtube.com/watch?v=${source.videoId} (${kind} captions)`;
      }
      break;
    }
    case "pdf": {
      const file = join(paths.raw, `${source.id}.pdf`);
      if (!existsSync(file)) {
        const res = await fetch(source.url);
        if (!res.ok) throw new Error(`${source.id}: download failed with ${res.status}`);
        await writeFile(file, new Uint8Array(await res.arrayBuffer()));
      }
      const lines = await readPdfLines(file, source.pages[0], source.pages[1]);
      chunks = pdfChunks(source.id, lines, source.pageOffset);
      origin = `${source.url} (pdf pages ${source.pages[0]}–${source.pages[1]})`;
      break;
    }
    case "web": {
      const res = await fetch(source.url);
      if (!res.ok) throw new Error(`${source.id}: fetch failed with ${res.status}`);
      chunks = webChunks(source.id, await res.text());
      origin = source.url;
      break;
    }
  }

  if (!chunks.length) throw new Error(`${source.id}: produced no chunks`);
  const file: ChunkFile = { sourceId: source.id, fetchedAt: new Date().toISOString(), origin, chunks };
  await writeJson(paths.chunkFile(source.id), file);
  return file;
}
