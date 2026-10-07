// Tiny tokenizer for the offline judge. Mirrors content/locate.ts without its file I/O.

const STOP = new Set(
  "a an the and or but of to in on at for from by with as is are was were be been it its this that these those you your we they i me my so if then than not no do does can could would should will just only also more most very much many any each every one two which what who how why when where there here about into over after before up down out all same other such own too again".split(" "),
);

const stem = (w: string) =>
  w.length > 5 && w.endsWith("ing") ? w.slice(0, -3) : w.length > 4 && (w.endsWith("ed") || w.endsWith("es")) ? w.slice(0, -2) : w.length > 3 && w.endsWith("s") && !w.endsWith("ss") ? w.slice(0, -1) : w;

export function tokens(text: string): string[] {
  return text
    .normalize("NFKC")
    .toLowerCase()
    .replace(/ε/g, " epsilon ")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .split(" ")
    .filter((w) => w.length > 2 && !STOP.has(w))
    .map(stem);
}

/** Share of `reference`'s distinct words that also appear in `text`. */
export function overlap(reference: string, text: string): number {
  const ref = new Set(tokens(reference));
  if (!ref.size) return 0;
  const got = new Set(tokens(text));
  let n = 0;
  for (const t of ref) if (got.has(t)) n++;
  return n / ref.size;
}

export const wordCount = (s: string) => s.trim().split(/\s+/).filter(Boolean).length;
