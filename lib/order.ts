// The final test's order for one learner: form by form in the order the server sent them (a pilot takes both), and
// within a form the items to choose first, then the number items, each part shuffled with a seed from the session, so
// a reload shows the same order and every learner gets their own (position effects such as tiredness spread over the
// items instead of always hitting the last ones). Shared with the tests.

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

/** Item ids in the order one learner sees them, form by form: the items to choose (shuffled), then the number items
 * (shuffled). One form gives the same order as before forms were grouped. */
export function testOrder(items: { id: string; kind: string; form?: string }[], seed: number): string[] {
  const forms = [...new Set(items.map((q) => q.form ?? ""))];
  return forms.flatMap((f, k) => {
    const mine = items.filter((q) => (q.form ?? "") === f);
    const part = (number: boolean, salt: number) => shuffled(mine.filter((q) => (q.kind === "number") === number).map((q) => q.id), seed + salt);
    return [...part(false, 2 * k), ...part(true, 2 * k + 1)];
  });
}

/**
 * The test in the learner's order, in sections: form by form (a pilot's two forms are parts 1 and 2: `group`), and
 * within a form the items to choose, then the number items. Each entry keeps the item's index in the session's list
 * (`i`), which is where its answer lives and how the server grades it. Without an order (older sessions): list order.
 */
export function testParts<T extends { id: string; kind: string; form?: string }>(items: T[], order: string[] | null | undefined) {
  const at = new Map(items.map((q, i) => [q.id, i]));
  const seq = (order?.length === items.length ? order : items.map((q) => q.id)).map((id) => ({ q: items[at.get(id)!]!, i: at.get(id)! }));
  const forms = [...new Set(seq.map((x) => x.q.form ?? ""))];
  const out: { title: string; start: number; group: number; list: { q: T; i: number }[] }[] = [];
  let start = 0;
  forms.forEach((f, g) => {
    const mine = seq.filter((x) => (x.q.form ?? "") === f);
    const choose = mine.filter((x) => x.q.kind !== "number");
    const work = mine.filter((x) => x.q.kind === "number");
    const both = choose.length > 0 && work.length > 0;
    for (const [list, what, k] of [[choose, "choose an answer", 1], [work, "work out a number", 2]] as const) {
      if (!list.length) continue;
      // several forms: "Part 1 of 2" (with the kind when a form has both); one form: by kind, or no heading
      const title = forms.length > 1 ? `Part ${g + 1} of ${forms.length}${both ? `: ${what}` : ""}` : both ? `Part ${k}: ${what}` : "";
      out.push({ title, start, group: g, list: [...list] });
      start += list.length;
    }
  });
  return out;
}
