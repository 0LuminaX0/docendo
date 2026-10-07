import type { Chunk } from "../schema";
import { decodeEntities, splitWords, squash } from "./text";

/**
 * Split an HTML page into chunks at h2/h3 headings that carry an id, so every
 * chunk can link to `url#anchor`. Text before the first such heading gets the
 * anchor "top".
 */
export function webChunks(sourceId: string, html: string): Chunk[] {
  const body = html
    .replace(/<(script|style|nav|footer|header|aside|noscript)[\s\S]*?<\/\1>/gi, " ")
    .replace(/<!--[\s\S]*?-->/g, " ");
  const heading = /<h([23])([^>]*)>([\s\S]*?)<\/h\1>/gi;
  const sections: { anchor: string; heading: string; html: string }[] = [];
  let last = 0;
  let cur = { anchor: "top", heading: "Top" };
  for (const m of body.matchAll(heading)) {
    const id = /\bid="([^"]+)"/.exec(m[2] ?? "")?.[1] ?? /\bid="([^"]+)"/.exec(m[3] ?? "")?.[1];
    if (!id) continue;
    sections.push({ ...cur, html: body.slice(last, m.index) });
    cur = { anchor: id, heading: squash(decodeEntities(stripTags(m[3] ?? ""))) };
    last = (m.index ?? 0) + m[0].length;
  }
  sections.push({ ...cur, html: body.slice(last) });

  const chunks: Chunk[] = [];
  for (const s of sections) {
    const text = squash(decodeEntities(stripTags(s.html.replace(/<\/(p|li|div|h\d|tr)>/gi, ". "))))
      .replace(/(\.\s*){2,}/g, ". ");
    if (text.split(" ").length < 15) continue;
    for (const piece of splitWords(text)) {
      chunks.push({
        id: `${sourceId}#${chunks.length}`,
        sourceId,
        loc: { kind: "anchor", anchor: s.anchor, heading: s.heading },
        text: piece,
      });
    }
  }
  return chunks;
}

const stripTags = (s: string) => s.replace(/<[^>]+>/g, " ");
