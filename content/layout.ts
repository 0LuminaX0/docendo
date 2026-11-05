import type { Node } from "./schema";

// Layered ("Sugiyama") layout for the lesson graph, shared by the review page
// and the web app. It keeps a strict grid:
//
// 1. Columns: a node sits one column right of its furthest prerequisite; then a
//    node with more links to the right than to the left moves right, up to one
//    column before its nearest follower, so links span as few columns as they can.
// 2. Long edges (spanning several columns) get a waypoint in every column they
//    cross, so they run through the gaps between boxes instead of behind them.
// 3. Row order inside each column: barycenter sweeps plus adjacent swaps,
//    keeping whichever ordering has the fewest crossings.
// 4. Rows: each node lines up with one neighbour (alignment, after Brandes and
//    Köpf), so chains of ideas run on one row; real nodes on whole rows. Then each long edge
//    gets one lane (a whole or half row free of boxes and other lanes in every
//    column it crosses) and keeps it: it changes height only right after its
//    source and right before its target, never on the way (2026-11-05: waypoints
//    placed column by column made long edges step up and down like a ladder).
// 5. Routes: each edge is a list of points (source → waypoints → target).

export const BOX_W = 144;
export const BOX_H = 46;
export const COL_W = 196; // box plus a 52 px gap: room for an edge to curve gently between columns
const LEAD = 12; // px of straight line into a box, so the arrowhead sits on a stretch that points where it does
export const ROW_H = 64;
export const PAD = 20;

type Item = { id: string; real: boolean; layer: number };
export type Point = { x: number; y: number };

export function layout(nodes: Pick<Node, "id" | "needs">[]) {
  const ids = nodes.map((n) => n.id);
  const byId = new Map(nodes.map((n) => [n.id, n]));

  // 1. layers: longest path from the roots
  const layerOf = new Map<string, number>();
  const visit = (id: string): number => {
    const known = layerOf.get(id);
    if (known !== undefined) return known;
    const n = byId.get(id);
    const v = n && n.needs.length ? 1 + Math.max(...n.needs.filter((x) => byId.has(x)).map(visit), -1) : 0;
    layerOf.set(id, v);
    return v;
  };
  ids.forEach(visit);
  // pull a node towards the side with more links: between one column after its last prerequisite and one before its
  // first follower (a few passes; each move only shortens the links in all)
  const followers = new Map<string, string[]>(ids.map((id) => [id, []]));
  for (const n of nodes) for (const need of n.needs) if (byId.has(need)) followers.get(need)!.push(n.id);
  for (let pass = 0; pass < 8; pass++) {
    let moved = false;
    for (const id of [...ids].reverse()) {
      const parents = byId.get(id)!.needs.filter((x) => byId.has(x));
      const kids = followers.get(id)!;
      if (!kids.length || kids.length <= parents.length) continue;
      const hi = Math.min(...kids.map((k) => layerOf.get(k)!)) - 1;
      if (hi > layerOf.get(id)!) (layerOf.set(id, hi), (moved = true));
    }
    for (const id of ids) {
      const parents = byId.get(id)!.needs.filter((x) => byId.has(x));
      if (!parents.length) continue;
      const lo = 1 + Math.max(...parents.map((x) => layerOf.get(x)!));
      const kids = followers.get(id)!;
      // a node with fewer followers than prerequisites goes as far left as its prerequisites allow
      if (kids.length < parents.length && lo < layerOf.get(id)!) (layerOf.set(id, lo), (moved = true));
      if (lo > layerOf.get(id)!) (layerOf.set(id, lo), (moved = true));
    }
    if (!moved) break;
  }
  const layers = Math.max(0, ...layerOf.values()) + 1;

  // 2. waypoints ("dummy" items) for edges that skip columns
  const items = new Map<string, Item>(ids.map((id) => [id, { id, real: true, layer: layerOf.get(id)! }]));
  const chains = new Map<string, string[]>(); // "from>to" -> item ids along the edge, ends included
  const next = new Map<string, Set<string>>(); // adjacency between consecutive layers
  const prev = new Map<string, Set<string>>();
  const link = (a: string, b: string) => {
    (next.get(a) ?? next.set(a, new Set()).get(a)!).add(b);
    (prev.get(b) ?? prev.set(b, new Set()).get(b)!).add(a);
  };
  for (const n of nodes)
    for (const need of n.needs) {
      if (!byId.has(need)) continue;
      const chain = [need];
      for (let l = layerOf.get(need)! + 1; l < layerOf.get(n.id)!; l++) {
        const d = `${need}>${n.id}@${l}`;
        items.set(d, { id: d, real: false, layer: l });
        chain.push(d);
      }
      chain.push(n.id);
      for (let i = 0; i + 1 < chain.length; i++) link(chain[i]!, chain[i + 1]!);
      chains.set(`${need}>${n.id}`, chain);
    }

  // 3. ordering
  let order: string[][] = Array.from({ length: layers }, () => []);
  for (const it of items.values()) order[it.layer]!.push(it.id);
  const fileIndex = (id: string) => ids.indexOf(id.split(">")[0]!) + (id.includes(">") ? 0.5 : 0);
  order.forEach((col) => col.sort((a, b) => fileIndex(a) - fileIndex(b)));

  const position = (ord: string[][]) => {
    const pos = new Map<string, number>();
    ord.forEach((col) => col.forEach((id, i) => pos.set(id, i)));
    return pos;
  };
  const crossingsBetween = (ord: string[][], l: number, pos = position(ord)) => {
    const segs: [number, number][] = [];
    for (const a of ord[l]!) for (const b of next.get(a) ?? []) segs.push([pos.get(a)!, pos.get(b)!]);
    let c = 0;
    for (let i = 0; i < segs.length; i++)
      for (let j = i + 1; j < segs.length; j++) {
        const [a1, b1] = segs[i]!;
        const [a2, b2] = segs[j]!;
        if ((a1 - a2) * (b1 - b2) < 0) c++;
      }
    return c;
  };
  const crossings = (ord: string[][]) => {
    const pos = position(ord);
    let c = 0;
    for (let l = 0; l + 1 < layers; l++) c += crossingsBetween(ord, l, pos);
    return c;
  };
  const sortBy = (col: string[], neighbours: Map<string, Set<string>>, pos: Map<string, number>) => {
    const key = new Map<string, number>();
    col.forEach((id, i) => {
      const ns = [...(neighbours.get(id) ?? [])].map((x) => pos.get(x)!).sort((a, b) => a - b);
      // median of the neighbours' positions; keep the current slot when there are none
      key.set(id, ns.length ? (ns.length % 2 ? ns[(ns.length - 1) / 2]! : (ns[ns.length / 2 - 1]! + ns[ns.length / 2]!) / 2) : i);
    });
    return [...col].sort((a, b) => key.get(a)! - key.get(b)! || col.indexOf(a) - col.indexOf(b));
  };
  const transpose = (ord: string[][]) => {
    let improved = true;
    for (let guard = 0; improved && guard < 20; guard++) {
      improved = false;
      for (let l = 0; l < layers; l++)
        for (let i = 0; i + 1 < ord[l]!.length; i++) {
          const local = () => (l > 0 ? crossingsBetween(ord, l - 1) : 0) + (l + 1 < layers ? crossingsBetween(ord, l) : 0);
          const before = local();
          const col = ord[l]!;
          [col[i], col[i + 1]] = [col[i + 1]!, col[i]!];
          if (local() < before) improved = true;
          else [col[i], col[i + 1]] = [col[i + 1]!, col[i]!];
        }
    }
  };

  let best = order.map((c) => [...c]);
  let bestC = crossings(best);
  for (let iter = 0; iter < 24; iter++) {
    const down = iter % 2 === 0;
    const pos = position(order);
    if (down) for (let l = 1; l < layers; l++) order[l] = sortBy(order[l]!, prev, position(order));
    else for (let l = layers - 2; l >= 0; l--) order[l] = sortBy(order[l]!, next, position(order));
    void pos;
    transpose(order);
    const c = crossings(order);
    if (c < bestC) {
      best = order.map((col) => [...col]);
      bestC = c;
    }
  }
  order = best;

  // 4. rows: alignment (after Brandes and Köpf). Each node lines up with one neighbour in the next column over (the
  // median one, when that keeps the order), so chains of ideas run on one row; long edges' waypoints line up first, so
  // they stay straight. Blocks of lined-up nodes are then packed against the ones above them: real nodes on whole rows,
  // waypoints on half rows. Four directions are tried (aligning with the column before or after, packing from the top
  // or the bottom), and the one with the fewest crossings, then bends, then rows wins. (2026-11-05: pulling each node to
  // its neighbours' average made chains step down half a row per column.)
  const pos0 = position(order);
  const isDummy = (id: string) => !items.get(id)!.real;
  // segments between two waypoints (inner) win: another segment that crosses one may not line up
  const conflicted = new Set<string>();
  for (let l = 0; l + 1 < layers; l++) {
    const segs: [string, string][] = [];
    for (const a of order[l]!) for (const b of next.get(a) ?? []) segs.push([a, b]);
    const inner = segs.filter(([a, b]) => isDummy(a) && isDummy(b));
    for (const [a, b] of segs) {
      if (isDummy(a) && isDummy(b)) continue;
      if (inner.some(([c, d]) => (pos0.get(a)! - pos0.get(c)!) * (pos0.get(b)! - pos0.get(d)!) < 0)) conflicted.add(`${a}|${b}`);
    }
  }
  const sep = (a: string, b: string) => (items.get(a)!.real && items.get(b)!.real ? 1 : 0.5);
  const variant = (ltr: boolean, down: boolean): Map<string, number> => {
    const root = new Map<string, string>([...items.keys()].map((id) => [id, id]));
    const range = ltr ? [...Array(layers).keys()].slice(1) : [...Array(layers).keys()].slice(0, -1).reverse();
    for (const l of range) {
      const col = down ? order[l]! : [...order[l]!].reverse();
      let r = down ? -Infinity : Infinity;
      for (const v of col) {
        const ns = [...((ltr ? prev : next).get(v) ?? [])].sort((x, z) => pos0.get(x)! - pos0.get(z)!);
        if (!ns.length) continue;
        const d = ns.length;
        const ms = d % 2 ? [ns[(d - 1) / 2]!] : [ns[d / 2 - 1]!, ns[d / 2]!];
        for (const u of down ? ms : ms.reverse()) {
          const seg = ltr ? `${u}|${v}` : `${v}|${u}`;
          if (!conflicted.has(seg) && (down ? pos0.get(u)! > r : pos0.get(u)! < r)) {
            root.set(v, root.get(u)!);
            r = pos0.get(u)!;
            break;
          }
        }
      }
    }
    // pack the blocks: each below the ones above it in every column it spans (from the top, or from the bottom)
    const ys = new Map<string, number>(); // per block root
    const hasReal = new Map<string, boolean>();
    for (const [id, rt] of root) if (items.get(id)!.real) hasReal.set(rt, true);
    for (const rt of new Set(root.values())) ys.set(rt, 0);
    const snapB = (rt: string, v: number) => (hasReal.get(rt) ? Math.ceil(v - 1e-9) : Math.ceil(v * 2 - 1e-9) / 2);
    for (let pass = 0, changed = true; changed && pass < items.size + 2; pass++) {
      changed = false;
      for (let l = 0; l < layers; l++) {
        const col = down ? order[l]! : [...order[l]!].reverse();
        for (let i = 1; i < col.length; i++) {
          const a = root.get(col[i - 1]!)!;
          const b = root.get(col[i]!)!;
          if (a === b) continue;
          const want = snapB(b, ys.get(a)! + sep(col[i - 1]!, col[i]!));
          if (want > ys.get(b)!) (ys.set(b, want), (changed = true));
        }
      }
    }
    const out = new Map<string, number>();
    for (const [id, rt] of root) out.set(id, down ? ys.get(rt)! : -ys.get(rt)!);
    return out;
  };
  // how a placement reads: crossings between edges in each gap, then edges that bend, then rows
  const scoreOf = (yy: Map<string, number>) => {
    let cross = 0;
    let bends = 0;
    for (let l = 0; l + 1 < layers; l++) {
      const segs: [number, number][] = [];
      for (const a of order[l]!) for (const b of next.get(a) ?? []) segs.push([yy.get(a)!, yy.get(b)!]);
      for (const [a1, b1] of segs) if (a1 !== b1) bends++;
      for (let i = 0; i < segs.length; i++)
        for (let j = i + 1; j < segs.length; j++) if ((segs[i]![0] - segs[j]![0]) * (segs[i]![1] - segs[j]![1]) < 0) cross++;
    }
    const vals = [...yy.values()];
    return cross * 100 + bends * 3 + (Math.max(...vals) - Math.min(...vals));
  };
  const y = [true, false].flatMap((ltr) => [true, false].map((down) => variant(ltr, down))).reduce((best, v) => (scoreOf(v) < scoreOf(best) ? v : best));
  // one lane per long edge: the free half-row closest to its two ends, the same in every column it crosses (longest
  // edges first: they have the fewest free lanes)
  const half = (v: number) => Math.round(v * 2);
  const blocked = new Map<number, Set<number>>(); // column -> half rows taken by a box
  for (const it of items.values()) if (it.real) (blocked.get(it.layer) ?? blocked.set(it.layer, new Set()).get(it.layer)!).add(half(y.get(it.id)!));
  // only the long edges the alignment left bending on the way (its waypoints on more than one row)
  const long = [...chains.values()].filter((c) => c.length > 2 && new Set(c.slice(1, -1).map((d) => y.get(d))).size > 1).sort((a, b) => b.length - a.length);
  // the straight ones keep their rows: no other lane may take them
  const lanes: { h: number; from: number; to: number }[] = [];
  for (const c of chains.values())
    if (c.length > 2 && !long.includes(c)) lanes.push({ h: half(y.get(c[1]!)!), from: items.get(c[1]!)!.layer, to: items.get(c[c.length - 2]!)!.layer });
  // where every edge runs in each gap between columns (gap l: from column l to l + 1), in half rows: [start, end]
  const inGap = (skip: string[], l: number) => {
    const out: [number, number][] = [];
    for (const chain of chains.values()) {
      if (chain === skip) continue;
      for (let i = 0; i + 1 < chain.length; i++) if (items.get(chain[i]!)!.layer === l) out.push([half(y.get(chain[i]!)!), half(y.get(chain[i + 1]!)!)]);
    }
    return out;
  };
  // how many other edges a lane at h would cross, over the gaps from its source's column to its target's
  const crossingsAt = (chain: string[], h: number, hs: number, ht: number, from: number, to: number) => {
    let c = 0;
    for (let l = from - 1; l <= to; l++) {
      const a: [number, number] = [l === from - 1 ? hs : h, l === to ? ht : h];
      for (const [b1, b2] of inGap(chain, l)) if ((a[0] - b1) * (a[1] - b2) < 0 || (a[0] === b1 && a[1] !== b2 && (a[1] - b2) * (a[0] - b1 || 1) < 0)) c++;
    }
    return c;
  };
  for (const chain of long) {
    const mid = chain.slice(1, -1);
    const from = items.get(mid[0]!)!.layer;
    const to = items.get(mid[mid.length - 1]!)!.layer;
    const hs = half(y.get(chain[0]!)!);
    const ht = half(y.get(chain[chain.length - 1]!)!);
    const all = [...y.values()].map(half);
    let best: number | null = null;
    let bestCost = Infinity;
    for (let h = Math.min(...all) - 2; h <= Math.max(...all) + 2; h++) {
      let free = true;
      for (let l = from; l <= to && free; l++) if (blocked.get(l)?.has(h)) free = false;
      // another lane at this height, over these columns or right next to them (their curves would touch)
      if (free && lanes.some((o) => o.h === h && o.from <= to + 1 && from <= o.to + 1)) free = false;
      if (!free) continue;
      // a crossing costs as much as a detour of two half rows
      const cost = Math.abs(h - hs) + Math.abs(h - ht) + 2 * crossingsAt(chain, h, hs, ht, from, to) + 0.01 * Math.abs(h - hs);
      if (cost < bestCost) (bestCost = cost), (best = h);
    }
    const h = best ?? half(y.get(mid[0]!)!);
    lanes.push({ h, from, to });
    for (const d of mid) y.set(d, h / 2);
  }
  // shift by whole rows only, so boxes stay on the grid even when a waypoint is topmost
  const minY = Math.floor(Math.min(...y.values()));
  for (const [k, v] of y) y.set(k, v - minY);
  const rows = Math.max(...[...items.values()].map((it) => y.get(it.id)! + (it.real ? 1 : 0.5)));

  // 5. pixel positions and routes
  const colX = (l: number) => PAD + l * COL_W;
  const centreY = (id: string) => PAD + y.get(id)! * ROW_H + BOX_H / 2;
  const pos: Record<string, { x: number; y: number }> = {};
  for (const id of ids) pos[id] = { x: colX(items.get(id)!.layer), y: centreY(id) - BOX_H / 2 };
  const routes: Record<string, Point[]> = {};
  for (const [key, chain] of chains) {
    const pts: Point[] = [{ x: colX(items.get(chain[0]!)!.layer) + BOX_W, y: centreY(chain[0]!) }];
    for (const d of chain.slice(1, -1)) {
      const x = colX(items.get(d)!.layer);
      pts.push({ x, y: centreY(d) }, { x: x + BOX_W, y: centreY(d) }); // a straight lane through the column
    }
    const last = chain[chain.length - 1]!;
    pts.push({ x: colX(items.get(last)!.layer) - 1, y: centreY(last) });
    routes[key] = pts;
  }

  return {
    pos,
    routes,
    crossings: bestC,
    width: PAD * 2 + (layers - 1) * COL_W + BOX_W,
    height: PAD * 2 + Math.ceil(rows - 1) * ROW_H + BOX_H,
  };
}

/**
 * SVG path through route points: straight lanes, smooth S-curves between columns. The last curve ends a little
 * before the target box and runs in straight, so the arrowhead (drawn along the path's end) lines up with the line
 * as it is seen arriving, instead of with a curve's last pixel.
 */
export function routePath(pts: Point[]): string {
  let d = `M${pts[0]!.x} ${pts[0]!.y}`;
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1]!;
    const b = pts[i]!;
    if (a.y === b.y) d += ` L${b.x} ${b.y}`;
    else {
      const last = i === pts.length - 1;
      const end = last ? b.x - LEAD : b.x;
      const dx = Math.max(12, (end - a.x) / 2);
      d += ` C${a.x + dx} ${a.y} ${end - dx} ${b.y} ${end} ${b.y}`;
      if (last) d += ` L${b.x} ${b.y}`;
    }
  }
  return d;
}
