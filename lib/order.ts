// The final test's order for one learner: choice items first, then the number items, each part shuffled with a
// seed from the session, so a reload shows the same order and every learner gets their own (position effects
// such as tiredness spread over the items instead of always hitting the last ones). Shared with the tests.

/** FNV-1a: a string to a 32-bit seed. */
export function seedOf(text: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 0x01000193);
  return h >>> 0;
}

/** mulberry32: a small seeded random number generator. */
function rng(seed: number) {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function shuffled<T>(xs: T[], seed: number): T[] {
  const out = [...xs];
  const r = rng(seed);
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(r() * (i + 1));
    [out[i], out[j]] = [out[j]!, out[i]!];
  }
  return out;
}

/** Item ids in the order one learner sees them: the choice items (shuffled), then the number items (shuffled). */
export function testOrder(items: { id: string; kind: string }[], seed: number): string[] {
  const part = (kind: string, salt: number) => shuffled(items.filter((q) => (q.kind === "number") === (kind === "number")).map((q) => q.id), seed + salt);
  return [...part("choice", 0), ...part("number", 1)];
}
