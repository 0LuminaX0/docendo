// A small seeded simulation of greedy and UCB with the lesson's formula, so the tests recompute the numbers behind
// items that describe a long run (P8's gaps, V21's logs) instead of trusting them. The same seed gives the same run on
// every machine.

/** mulberry32: a small seeded generator of numbers in [0, 1). */
export function seeded(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * The rounds (1-based) in which a rule picked option `watch`, over `rounds` rounds. Each option is tried once first;
 * then greedy takes the highest average, and UCB the highest average + √(ln t / n), the lesson's formula (no c), t the
 * round number. A pick scores the option's true average plus normal noise (sd `sd`), kept between 0 and 1. Ties go
 * to the first option.
 */
export function picksOf(rule: "greedy" | "ucb", means: number[], rounds: number, seed: number, watch: number, sd = 0.25): number[] {
  const rand = seeded(seed);
  const gauss = () => Math.sqrt(-2 * Math.log(1 - rand())) * Math.cos(2 * Math.PI * rand());
  const k = means.length;
  const n: number[] = new Array(k).fill(0);
  const sum: number[] = new Array(k).fill(0);
  const out: number[] = [];
  for (let t = 1; t <= rounds; t++) {
    let a = t - 1;
    if (t > k) {
      const lt = Math.log(t);
      let best = -Infinity;
      for (let i = 0; i < k; i++) {
        const s = sum[i]! / n[i]! + (rule === "ucb" ? Math.sqrt(lt / n[i]!) : 0);
        if (s > best) {
          best = s;
          a = i;
        }
      }
    }
    const r = Math.min(1, Math.max(0, means[a]! + sd * gauss()));
    n[a] = n[a]! + 1;
    sum[a] = sum[a]! + r;
    if (a === watch) out.push(t);
  }
  return out;
}

/** The gaps between picks whose later pick falls within 40% of round `at` (the pace "around round at"). */
export function gapsAround(picks: number[], at: number): number[] {
  const gaps: number[] = [];
  for (let i = 1; i < picks.length; i++) if (picks[i]! >= at * 0.6 && picks[i]! <= at * 1.4) gaps.push(picks[i]! - picks[i - 1]!);
  return gaps;
}

export const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
