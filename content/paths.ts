import { readFile, writeFile, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parse as parseYaml } from "yaml";
import { z } from "zod";
import { Topic } from "./schema";

export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

export function topicPaths(slug: string) {
  const dir = join(ROOT, "topics", slug);
  return {
    dir,
    topic: join(dir, "topic.yaml"),
    raw: join(dir, "sources", "raw"),
    chunks: join(dir, "sources", "chunks"),
    chunkFile: (sourceId: string) => join(dir, "sources", "chunks", `${sourceId}.json`),
    graphDraft: join(dir, "graph.draft.json"),
    graph: join(dir, "graph.json"),
    questions: join(dir, "questions.json"),
    locations: join(dir, "locations.json"),
    coverage: join(dir, "coverage.json"),
    review: join(dir, "review.html"),
  };
}

export async function loadTopic(slug: string): Promise<Topic> {
  const raw = parseYaml(await readFile(topicPaths(slug).topic, "utf8"));
  return Topic.parse(raw);
}

export async function readJson<T extends z.ZodType>(path: string, schema: T): Promise<z.infer<T>> {
  const result = schema.safeParse(JSON.parse(await readFile(path, "utf8")));
  if (!result.success) throw new Error(`${path} does not match its schema:\n${z.prettifyError(result.error)}`);
  return result.data;
}

export async function writeJson(path: string, data: unknown) {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, JSON.stringify(data, null, 2) + "\n");
}

export { existsSync };
