import { readFile } from "node:fs/promises";
import { getDocumentProxy } from "unpdf";
import type { Chunk } from "../schema";
import { splitWords, squash } from "./text";

export type PdfLine = { page: number; text: string };

/** Read the text of the given 1-based PDF pages as lines, keeping line breaks. */
export async function readPdfLines(file: string, from: number, to: number): Promise<PdfLine[]> {
  const data = new Uint8Array(await readFile(file));
  const pdf = await getDocumentProxy(data);
  const lines: PdfLine[] = [];
  const last = Math.min(to, pdf.numPages);
  for (let p = from; p <= last; p++) {
    const page = await pdf.getPage(p);
    const content = await page.getTextContent();
    let cur = "";
    for (const item of content.items) {
      if (!("str" in item)) continue;
      cur += item.str;
      if (item.hasEOL) {
        lines.push({ page: p, text: cur });
        cur = "";
      }
    }
    if (cur.trim()) lines.push({ page: p, text: cur });
  }
  await pdf.cleanup();
  return lines;
}

// "2.3 The 10-armed Testbed", "1.2 Advanced remarks", but not "0.5 0.3" or "2.3 ."
const SECTION = /^\s*(\d{1,2}\.\d{1,2})\s+([A-Z][A-Za-z0-9 ,:;'’()\-–ε]{2,80})\s*$/;
// running headers and bare page numbers that pdf extraction leaves in the text
const NOISE = [
  /^\s*\d{1,3}\s*$/, // bare page number
  /^\s*\d{1,3}\s+Chapter \d+:/, // "26 Chapter 2: Multi-armed Bandits"
  /^\s*\d+\.\d+\.\s.*\s\d{1,3}\s*$/, // "2.2. Action-value Methods 27"
  /^\s*CHAPTER \d+\.\s/, // Slivkins-style running header
];
const isNoise = (line: string) => NOISE.some((re) => re.test(line));

export function detectSection(line: string): string | undefined {
  const m = SECTION.exec(line);
  return m ? `${m[1]} ${squash(m[2] ?? "")}` : undefined;
}

/**
 * Turn PDF lines into chunks: paragraphs are merged up to ~180 words, never
 * across a section heading, and each chunk is stamped with its printed page
 * (pdf page + offset) and the current section.
 */
export function pdfChunks(sourceId: string, lines: PdfLine[], pageOffset: number): Chunk[] {
  const chunks: Chunk[] = [];
  let section: string | undefined;
  let buf: string[] = [];
  let bufPage = lines[0]?.page ?? 1;

  const flush = () => {
    const text = squash(buf.join(" ").replace(/-\s+(?=[a-z])/g, "")); // join hyphenated line breaks
    buf = [];
    if (!text) return;
    for (const piece of splitWords(text)) {
      chunks.push({
        id: `${sourceId}#${chunks.length}`,
        sourceId,
        loc: { kind: "page", page: bufPage + pageOffset, ...(section ? { section } : {}) },
        text: piece,
      });
    }
  };

  for (const line of lines) {
    if (isNoise(line.text)) continue;
    const heading = detectSection(line.text);
    if (heading) {
      flush();
      section = heading;
      bufPage = line.page;
      continue;
    }
    if (!buf.length) bufPage = line.page;
    // start a new chunk at a page break once the buffer is reasonably full
    if (line.page !== bufPage && buf.join(" ").split(/\s+/).length > 120) {
      flush();
      bufPage = line.page;
    }
    buf.push(line.text);
  }
  flush();
  return chunks;
}
