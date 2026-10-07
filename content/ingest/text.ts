// Small text helpers shared by the ingest adapters.

const ENTITIES: Record<string, string> = {
  amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", "#39": "'",
};

export function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+|#39);/gi, (m, e: string) => {
    if (e[0] === "#") {
      const code = e[1] === "x" || e[1] === "X" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : m;
    }
    return ENTITIES[e.toLowerCase()] ?? m;
  });
}

export function squash(s: string): string {
  return s.replace(/\s+/g, " ").trim();
}

export function wordCount(s: string): number {
  return s.split(/\s+/).filter(Boolean).length;
}

/**
 * Split running text into pieces of roughly `target` words, preferring to cut
 * after a sentence end. Never returns an empty piece.
 */
export function splitWords(text: string, target = 180, max = 260): string[] {
  const sentences = squash(text).split(/(?<=[.!?])\s+(?=[A-Z(“"])/);
  const out: string[] = [];
  let cur: string[] = [];
  let n = 0;
  const flush = () => {
    if (cur.length) out.push(cur.join(" "));
    cur = [];
    n = 0;
  };
  for (const s of sentences) {
    const w = wordCount(s);
    if (w > max) {
      // a run-on "sentence" (e.g. a formula block): hard-split it
      flush();
      const words = s.split(/\s+/);
      for (let i = 0; i < words.length; i += target) out.push(words.slice(i, i + target).join(" "));
      continue;
    }
    if (n + w > target && n > 0) flush();
    cur.push(s);
    n += w;
  }
  flush();
  return out.filter((p) => p.trim().length > 0);
}
