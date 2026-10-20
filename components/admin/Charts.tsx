// The dashboard's charts: plain SVG drawn on the server (no chart library, nothing extra for the browser to load).
// Direct is blue and recursive violet everywhere, as in the condition pills.

import type { Charts } from "@/lib/analytics";

const STEP_NAME: Record<string, string> = { start: "Started", pretest: "Pretest", watch: "Watched", teach: "Taught Kai", practice: "Practised", test: "Final test", results: "Finished" };

export function Legend() {
  return (
    <span className="ch-legend">
      <i className="ch-d" /> direct <i className="ch-r" /> recursive
    </span>
  );
}

/** Sessions started per day, stacked by condition. */
export function DailyBars({ daily }: { daily: Charts["daily"] }) {
  const W = 560, H = 150, pad = 22;
  const max = Math.max(1, ...daily.map((d) => d.direct + d.recursive));
  const bw = (W - pad) / daily.length;
  const y = (v: number) => ((H - 24) * v) / max;
  return (
    <svg className="ch" viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Sessions started per day, by condition">
      {/* gridlines at whole numbers, each value once (a small maximum would label 1 twice) */}
      {[...new Set([Math.round(max / 2), max])].filter((v) => v > 0).map((v) => (
        <g key={v}>
          <line x1={pad} x2={W} y1={H - 18 - y(v)} y2={H - 18 - y(v)} className="ch-grid" />
          <text x={pad - 6} y={H - 18 - y(v) + 4} className="ch-axis" textAnchor="end">
            {v}
          </text>
        </g>
      ))}
      {daily.map((d, i) => {
        const x = pad + i * bw + bw * 0.18;
        const w = bw * 0.64;
        return (
          <g key={d.day}>
            <title>{`${d.day}: ${d.direct} direct, ${d.recursive} recursive`}</title>
            <rect x={x} y={H - 18 - y(d.direct)} width={w} height={y(d.direct)} rx={2} className="ch-d" />
            <rect x={x} y={H - 18 - y(d.direct) - y(d.recursive)} width={w} height={y(d.recursive)} rx={2} className="ch-r" />
            {(i % 3 === daily.length % 3 || i === daily.length - 1) && (
              <text x={x + w / 2} y={H - 4} className="ch-axis" textAnchor="middle">
                {d.day.slice(8)}.{d.day.slice(5, 7)}
              </text>
            )}
          </g>
        );
      })}
    </svg>
  );
}

/** How far people get, per condition: two bars per step, as a share of those who started. */
export function FunnelPairs({ funnel }: { funnel: Charts["funnel"] }) {
  const top = { direct: funnel[0]?.direct || 1, recursive: funnel[0]?.recursive || 1 };
  return (
    <ol className="ch-funnel">
      {funnel.map((f) => (
        <li key={f.step}>
          <span>{STEP_NAME[f.step] ?? f.step}</span>
          <span className="ch-pair">
            <i className="ch-d" style={{ width: `${(f.direct / top.direct) * 100}%` }} />
            <i className="ch-r" style={{ width: `${(f.recursive / top.recursive) * 100}%` }} />
          </span>
          <b>
            {f.direct} / {f.recursive}
          </b>
        </li>
      ))}
    </ol>
  );
}

/** Final test scores, 0 to the test's length: side by side per score, as shares of each condition, with each mean marked. */
export function ScoreHist({ hist }: { hist: Charts["hist"] }) {
  const W = 560, H = 170, pad = 8, base = H - 22;
  const share = (h: number[]) => {
    const n = h.reduce((a, b) => a + b, 0) || 1;
    return h.map((v) => v / n);
  };
  const d = share(hist.direct), r = share(hist.recursive);
  const max = Math.max(0.05, ...d, ...r);
  const slot = (W - pad * 2) / hist.direct.length;
  const meanOf = (h: number[]) => {
    const n = h.reduce((a, b) => a + b, 0);
    return n ? h.reduce((a, v, i) => a + v * i, 0) / n : null;
  };
  const md = meanOf(hist.direct), mr = meanOf(hist.recursive);
  const xOf = (score: number) => pad + slot * score + slot / 2;
  return (
    <svg className="ch" viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Final test scores by condition">
      <line x1={pad} x2={W - pad} y1={base} y2={base} className="ch-grid" />
      {d.map((v, i) => (
        <g key={i}>
          <title>{`${i} of ${hist.direct.length - 1}: ${hist.direct[i]} direct, ${hist.recursive[i]} recursive`}</title>
          <rect x={pad + slot * i + slot * 0.14} y={base - (v / max) * (base - 14)} width={slot * 0.34} height={(v / max) * (base - 14)} rx={2} className="ch-d" />
          <rect x={pad + slot * i + slot * 0.52} y={base - (r[i]! / max) * (base - 14)} width={slot * 0.34} height={(r[i]! / max) * (base - 14)} rx={2} className="ch-r" />
          <text x={xOf(i)} y={H - 6} className="ch-axis" textAnchor="middle">
            {i}
          </text>
        </g>
      ))}
      {md !== null && <line x1={xOf(md)} x2={xOf(md)} y1={6} y2={base} className="ch-mean ch-d-line" />}
      {mr !== null && <line x1={xOf(mr)} x2={xOf(mr)} y1={6} y2={base} className="ch-mean ch-r-line" />}
    </svg>
  );
}

/** Pretest against final test, one dot per finished session, slightly spread so dots don't hide. */
export function Scatter({ points, preMax = 3, testMax = 10 }: { points: Charts["points"]; preMax?: number; testMax?: number }) {
  const W = 560, H = 200, left = 30, bottom = 22, top = 8, right = 10;
  const x = (v: number) => left + ((W - left - right) * v) / preMax;
  const y = (v: number) => H - bottom - ((H - bottom - top) * v) / testMax;
  const jitter = (s: string, k: number) => {
    let h = 0;
    for (const c of s) h = (h * 31 + c.charCodeAt(0)) | 0;
    return (((h >> k) & 255) / 255 - 0.5) * 0.28;
  };
  return (
    <svg className="ch" viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Pretest score against final test score">
      {[0, Math.round(testMax / 2), testMax].map((v) => (
        <g key={v}>
          <line x1={left} x2={W - right} y1={y(v)} y2={y(v)} className="ch-grid" />
          <text x={left - 8} y={y(v) + 4} className="ch-axis" textAnchor="end">
            {v}
          </text>
        </g>
      ))}
      {Array.from({ length: preMax + 1 }, (_, v) => (
        <text key={v} x={x(v)} y={H - 6} className="ch-axis" textAnchor="middle">
          {v}
        </text>
      ))}
      {points.map((p) => (
        <circle key={p.sid} cx={x(Math.min(preMax, Math.max(0, p.pre + jitter(p.sid, 0))))} cy={y(Math.min(testMax, Math.max(0, p.test + jitter(p.sid, 8) * 2)))} r={4.5} className={p.cond === "recursive" ? "ch-r ch-dot" : "ch-d ch-dot"}>
          <title>{`pretest ${p.pre}, test ${p.test} (${p.cond})`}</title>
        </circle>
      ))}
    </svg>
  );
}

/** Median minutes per chapter, per condition. */
export function MinutesBars({ minutes }: { minutes: Charts["minutes"] }) {
  const max = Math.max(1, ...minutes.flatMap((m) => [m.direct ?? 0, m.recursive ?? 0]));
  return (
    <ol className="ch-funnel">
      {minutes.map((m) => (
        <li key={m.chapter}>
          <span>{m.chapter}</span>
          <span className="ch-pair">
            <i className="ch-d" style={{ width: `${((m.direct ?? 0) / max) * 100}%` }} />
            <i className="ch-r" style={{ width: `${((m.recursive ?? 0) / max) * 100}%` }} />
          </span>
          <b>
            {m.direct ?? "–"} / {m.recursive ?? "–"}
          </b>
        </li>
      ))}
    </ol>
  );
}
