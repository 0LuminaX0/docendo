// The text lesson's figures (lesson.json names them by id). Plain SVG, no state, so the reading page renders them on
// the server and the help passages in the browser. Drawn with the team in the lesson doc (2 November 2026).

const ink = "var(--ink)";
const quiet = "var(--muted)";
const edge = "var(--fig-edge)";
const grid = "var(--rule)";
const accent = "var(--blue)";
const warn = "var(--fig-warn)";

const Arrow = ({ id, fill }: { id: string; fill: string }) => (
  <marker id={id} viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
    <path d="M0 0L10 5L0 10z" fill={fill} />
  </marker>
);

/** Figure 1: averages from few lunches can be far from the truth. */
function Averages() {
  const x0 = 220, x1 = 700;
  const rowA = 112, rowB = 172, rowC = 232;
  const aDots = [330, 410], bDots = [400, 420, 440, 455, 460, 470, 475, 490, 500, 510, 530, 545], cDots = [300, 350, 400, 430, 470];
  const avg = (xs: number[]) => xs.reduce((s, v) => s + v, 0) / xs.length;
  const row = (y: number, dots: number[], truth: number) => (
    <g>
      <line x1={x0} x2={x1} y1={y} y2={y} stroke={grid} strokeWidth="1.25" />
      {dots.map((x, i) => <circle key={i} cx={x} cy={y} r="5" fill={quiet} fillOpacity="0.55" />)}
      <line x1={truth} x2={truth} y1={y - 16} y2={y + 16} stroke={edge} strokeWidth="1.5" strokeDasharray="4 3" />
      <line x1={avg(dots)} x2={avg(dots)} y1={y - 16} y2={y + 16} stroke={accent} strokeWidth="3" />
    </g>
  );
  return (
    <svg viewBox="0 0 760 304" role="img" aria-label="Averages from few lunches can be far from the truth" fontSize="13">
      <defs><Arrow id="lf1-arrow" fill={edge} /></defs>
      <text x="24" y="30" fontSize="15" fontWeight="600" fill={ink}>Averages from few lunches can be far from the truth</text>
      <text x="24" y="52" fontSize="11.5" fill={quiet}>Dots: lunches you had. Solid mark: your average. Dashed mark: the true average, hidden from you.</text>
      {row(rowA, aDots, 560)}
      <text x="24" y={rowA - 2} fontWeight="600" fill={ink}>Truck A</text>
      <text x="24" y={rowA + 16} fontSize="11.5" fill={quiet}>2 lunches</text>
      <text x="370" y={rowA - 24} textAnchor="middle" fontSize="11.5" fill={ink}>your average</text>
      <text x="560" y={rowA - 24} textAnchor="middle" fontSize="11.5" fill={quiet}>true average</text>
      {row(rowB, bDots, 470)}
      <text x="24" y={rowB - 2} fontWeight="600" fill={ink}>Truck B</text>
      <text x="24" y={rowB + 16} fontSize="11.5" fill={quiet}>12 lunches</text>
      {row(rowC, cDots, 380)}
      <text x="24" y={rowC - 2} fontWeight="600" fill={ink}>Truck C</text>
      <text x="24" y={rowC + 16} fontSize="11.5" fill={quiet}>5 lunches</text>
      <line x1={x0} x2={x1} y1="270" y2="270" stroke={edge} strokeWidth="1.25" markerEnd="url(#lf1-arrow)" />
      <text x={x0} y="290" fontSize="11.5" fill={quiet}>worse lunch</text>
      <text x={x1} y="290" textAnchor="end" fontSize="11.5" fill={quiet}>better lunch</text>
    </svg>
  );
}

/** A table of rounds: one column per day, a row per truck with its average after that day; the truck picked that day
 * is highlighted, with the lunch it gave. */
type Day = { label: string; pick?: string; lunch?: number; avg: Record<string, number | null>; gap?: boolean };
function DayTable({ days, rows, x0, y0, col, hot }: { days: Day[]; rows: string[]; x0: number; y0: number; col: number; hot: (d: Day, i: number) => "fav" | "warn" | "plain" }) {
  const rh = 34;
  return (
    <g>
      <text x={x0 - 12} y={y0 + 4} textAnchor="end" fontSize="11.5" fill={quiet}>picked</text>
      {rows.map((r, j) => (
        <text key={r} x={x0 - 12} y={y0 + 34 + j * rh + 4} textAnchor="end" fontSize="11.5" fill={ink}>{`${r}'s average`}</text>
      ))}
      {days.map((d, i) => {
        const cx = x0 + i * col + col / 2;
        if (d.gap) return <text key={i} x={cx} y={y0 + 34 + rh} textAnchor="middle" fill={quiet}>…</text>;
        const kind = hot(d, i);
        return (
          <g key={i}>
            <text x={cx} y={y0 - 22} textAnchor="middle" fontSize="11.5" fill={quiet}>{d.label}</text>
            <rect x={cx - 17} y={y0 - 13} width="34" height="24" rx="6" fill={kind === "warn" ? warn : kind === "fav" ? accent : "none"} fillOpacity={kind === "plain" ? 1 : 0.14} stroke={kind === "warn" ? warn : kind === "fav" ? accent : edge} strokeWidth={kind === "plain" ? 1.25 : 2} />
            <text x={cx} y={y0 + 4} textAnchor="middle" fontWeight="600" fill={ink}>{d.pick}</text>
            {rows.map((r, j) => {
              const v = d.avg[r] ?? null;
              const y = y0 + 34 + j * rh;
              const picked = d.pick === r;
              return (
                <g key={r}>
                  {picked && <rect x={cx - 26} y={y - 12} width="52" height="23" rx="5" fill={accent} fillOpacity="0.1" />}
                  <text x={cx} y={y + 4} textAnchor="middle" fontWeight={picked ? 600 : 400} fill={v === null ? quiet : ink}>{v === null ? "–" : v.toFixed(1)}</text>
                  {picked && d.lunch !== undefined && <text x={cx + 30} y={y - 4} fontSize="10" fill={quiet}>{d.lunch}</text>}
                </g>
              );
            })}
          </g>
        );
      })}
    </g>
  );
}

/** Figure 2: greedy day by day, with the averages it goes by; it switches when the favourite is overtaken. */
function Greedy() {
  const days: Day[] = [
    { label: "day 1", pick: "A", lunch: 6, avg: { A: 6, B: null, C: null } },
    { label: "day 2", pick: "B", lunch: 8, avg: { A: 6, B: 8, C: null } },
    { label: "day 3", pick: "C", lunch: 5, avg: { A: 6, B: 8, C: 5 } },
    { label: "day 4", pick: "B", lunch: 6, avg: { A: 6, B: 7, C: 5 } },
    { label: "day 5", pick: "B", lunch: 3, avg: { A: 6, B: 17 / 3, C: 5 } },
    { label: "day 6", pick: "A", lunch: 7, avg: { A: 6.5, B: 17 / 3, C: 5 } },
    { label: "day 7", pick: "A", lunch: 6, avg: { A: 19 / 3, B: 17 / 3, C: 5 } },
  ];
  const x0 = 150, col = 84;
  return (
    <svg viewBox="0 0 760 300" role="img" aria-label="Greedy day by day: it picks the highest average and switches when another overtakes it" fontSize="13">
      <text x="24" y="30" fontSize="15" fontWeight="600" fill={ink}>Greedy, day by day</text>
      <text x="24" y="52" fontSize="11.5" fill={quiet}>Each column: the truck picked that day (its lunch in small print) and every truck&apos;s average after it.</text>
      <DayTable days={days} rows={["A", "B", "C"]} x0={x0} y0={110} col={col} hot={(d, i) => (i < 3 ? "plain" : "fav")} />
      <line x1={x0 + 5 * col} x2={x0 + 5 * col} y1="78" y2="250" stroke={edge} strokeWidth="1.25" strokeDasharray="4 3" />
      <text x="24" y="270" fontSize="11.5" fill={ink}>Days 1 to 3 try each truck once. From day 4 greedy picks the highest average: B.</text>
      <text x="24" y="290" fontSize="11.5" fill={ink}>After day 5, B&apos;s average (5.7) is below A&apos;s (6.0), so A is the new favourite and greedy switches to it.</text>
    </svg>
  );
}

/** Figure 3: one unlucky first lunch can hide the best truck for good. */
function LockIn() {
  const b = [6, 7, 5, 6, 7, 5, 6];
  const avgB = (i: number) => b.slice(0, i + 1).reduce((s, v) => s + v, 0) / (i + 1);
  const days: Day[] = [
    { label: "day 1", pick: "A", lunch: 2, avg: { A: 2, B: null, C: null } },
    { label: "day 2", pick: "B", lunch: 6, avg: { A: 2, B: avgB(0), C: null } },
    { label: "day 3", pick: "C", lunch: 5, avg: { A: 2, B: avgB(0), C: 5 } },
    ...b.slice(1).map((l, i) => ({ label: `day ${i + 4}`, pick: "B", lunch: l, avg: { A: 2, B: avgB(i + 1), C: 5 } })),
  ];
  const x0 = 150, col = 64;
  return (
    <svg viewBox="0 0 760 300" role="img" aria-label="One unlucky first lunch can hide the best truck for good" fontSize="13">
      <text x="24" y="30" fontSize="15" fontWeight="600" fill={ink}>One unlucky first lunch can hide the best truck for good</text>
      <text x="24" y="52" fontSize="11.5" fill={quiet}>The true averages, hidden from you: A 7, B 6, C 5.</text>
      <DayTable days={days} rows={["A", "B", "C"]} x0={x0} y0={110} col={col} hot={(d, i) => (i === 0 ? "warn" : i < 3 ? "plain" : "fav")} />
      <text x="24" y="270" fontSize="11.5" fill={ink}>Day 1: A, truly the best truck, gives a poor lunch (2) by bad luck. B&apos;s average stays well above 2,</text>
      <text x="24" y="290" fontSize="11.5" fill={ink}>so greedy keeps picking B; A is never tried again, and its average of 2 is never updated.</text>
    </svg>
  );
}

/** Figure 4: ε-greedy's lottery, early and late: the same share of rounds, landing on any option, the favourite too. */
function Lottery() {
  const strip = (y: number, title: string, lottery: Record<number, string>) => (
    <g>
      <text x="24" y={y - 12} fontWeight="600" fill={ink}>{title}</text>
      {Array.from({ length: 40 }, (_, i) => {
        const l = lottery[i];
        const x = 24 + i * 17.8;
        return (
          <g key={i}>
            <rect x={x} y={y} width="15" height="28" rx="3" fill={l ? accent : edge} fillOpacity={l ? 0.85 : 0.14} />
            <text x={x + 7.5} y={y + 19} textAnchor="middle" fontSize="11" fontWeight={l ? 600 : 400} fill={l ? "#fff" : quiet}>{l ?? "A"}</text>
          </g>
        );
      })}
    </g>
  );
  return (
    <svg viewBox="0 0 760 286" role="img" aria-label="ε-greedy's lottery decides the same share of rounds early and late, and can land on any option" fontSize="13">
      <text x="24" y="30" fontSize="15" fontWeight="600" fill={ink}>ε-greedy, early and late</text>
      <text x="24" y="52" fontSize="11.5" fill={quiet}>ε = 0.1 and four options, A to D; A is the favourite. A dark square is a round decided by the lottery, with the option it landed on.</text>
      {strip(96, "Rounds 1 to 40", { 6: "C", 13: "A", 25: "D", 34: "B" })}
      {strip(176, "Rounds 10,001 to 10,040", { 3: "B", 17: "D", 22: "A", 38: "C" })}
      <text x="24" y="240" fontSize="11.5" fill={ink}>In both stretches about one round in ten is a lottery: ε has not changed in between.</text>
      <text x="24" y="260" fontSize="11.5" fill={ink}>The lottery ignores the averages and the counts, so it lands on every option alike, the favourite A included.</text>
    </svg>
  );
}

const fmt = (v: number) => v.toFixed(1);

/** Figure 5: one UCB round with numbers (round 20, c = 1): the bonus can lift an option over a higher average. */
function Score() {
  const base = 276, scale = 24, w = 92, lnT = Math.log(20);
  const opts = [
    { name: "A", avg: 6.0, n: 12, cx: 220 },
    { name: "B", avg: 5.8, n: 3, cx: 380 },
    { name: "C", avg: 4.5, n: 5, cx: 540 },
  ].map((o) => ({ ...o, bonus: Math.sqrt(lnT / o.n) }));
  const best = Math.max(...opts.map((o) => o.avg + o.bonus));
  return (
    <svg viewBox="0 0 760 356" role="img" aria-label="One UCB round with numbers: B has the highest score although A has the highest average" fontSize="13">
      <text x="24" y="30" fontSize="15" fontWeight="600" fill={ink}>One UCB round, with numbers</text>
      <text x="24" y="52" fontSize="11.5" fill={quiet}>Round t = 20, c = 1, so each bonus is √(<tspan className="ln">ln</tspan>(20) / n) with <tspan className="ln">ln</tspan>(20) ≈ 3.0. Grey: the average. Blue: the bonus.</text>
      {opts.map((o) => {
        const top = base - (o.avg + o.bonus) * scale;
        const win = o.avg + o.bonus === best;
        return (
          <g key={o.name}>
            <rect x={o.cx - w / 2} y={base - o.avg * scale} width={w} height={o.avg * scale} fill={edge} fillOpacity="0.18" stroke={edge} strokeWidth="1.25" />
            <rect x={o.cx - w / 2} y={top} width={w} height={o.bonus * scale} fill={accent} fillOpacity={win ? 0.55 : 0.3} stroke={accent} strokeWidth={win ? 2.5 : 1.5} />
            <text x={o.cx} y={top - 10} textAnchor="middle" fontWeight="600" fill={ink}>{`${fmt(o.avg)} + ${o.bonus.toFixed(2)} = ${(o.avg + o.bonus).toFixed(2)}`}</text>
            <text x={o.cx} y={base + 22} textAnchor="middle" fontWeight="600" fill={ink}>{o.name}</text>
            <text x={o.cx} y={base + 40} textAnchor="middle" fontSize="11.5" fill={quiet}>{`picked ${o.n} times`}</text>
          </g>
        );
      })}
      <line x1="140" y1={base} x2="620" y2={base} stroke={edge} strokeWidth="1.25" />
      <text x="24" y="344" fontSize="11.5" fill={ink}>B has the highest score, so UCB picks B, although A has the higher average: B&apos;s bonus is bigger because B was picked fewer times.</text>
    </svg>
  );
}

/** Figure 6: one option's bonus over the rounds: it drops at each of its picks and grows, ever more slowly, in between. */
function Bonus() {
  const t0 = 10, t1 = 90, n0 = 3, picks = [15, 18, 35, 41, 70];
  const x = (t: number) => 70 + ((t - t0) / (t1 - t0)) * 620;
  const lo = 0.66, hi = 0.97, y = (b: number) => 236 - ((b - lo) / (hi - lo)) * 150;
  const bonus = (t: number, n: number) => Math.sqrt(Math.log(t) / n);
  let d = "", n = n0;
  const marks: { t: number; from: number; to: number }[] = [];
  for (let t = t0; t <= t1; t += 0.5) {
    d += `${d ? "L" : "M"}${x(t).toFixed(1)} ${y(bonus(t, n)).toFixed(1)}`;
    if (picks.includes(t)) {
      marks.push({ t, from: bonus(t, n), to: bonus(t, n + 1) });
      n += 1;
      d += `L${x(t).toFixed(1)} ${y(bonus(t, n)).toFixed(1)}`;
    }
  }
  return (
    <svg viewBox="0 0 760 312" role="img" aria-label="One option's bonus: it drops each time the option is picked and grows, ever more slowly, in the rounds between" fontSize="13">
      <text x="24" y="30" fontSize="15" fontWeight="600" fill={ink}>One option&apos;s bonus, round by round</text>
      <text x="24" y="52" fontSize="11.5" fill={quiet}>c = 1. The option has been picked 3 times by round 10; for the example, say it is also picked in rounds 15, 18, 35, 41 and 70.</text>
      <line x1="70" y1="78" x2="70" y2="244" stroke={edge} strokeWidth="1.25" />
      <line x1="70" y1="244" x2="700" y2="244" stroke={edge} strokeWidth="1.25" />
      <text x="56" y="160" transform="rotate(-90 56 160)" textAnchor="middle" fontSize="11.5" fill={quiet}>bonus</text>
      <path d={d} fill="none" stroke={accent} strokeWidth="2" />
      {marks.map((m) => (
        <g key={m.t}>
          <circle cx={x(m.t)} cy={y(m.to)} r="4" fill={accent} />
          <text x={x(m.t)} y="262" textAnchor="middle" fontSize="11" fill={quiet}>{m.t}</text>
        </g>
      ))}
      <text x="700" y="262" textAnchor="end" fontSize="11.5" fill={quiet}>round t</text>
      <text x={x(41) + 10} y={y(bonus(41, 7)) + 20} fontSize="11.5" fill={ink}>picked: n grows, the bonus drops</text>
      <text x={x(46)} y={y(bonus(70, 7)) - 22} fontSize="11.5" fill={ink}>not picked: t grows, the bonus rises, ever more slowly</text>
      <text x="24" y="292" fontSize="11.5" fill={ink}>Only this option&apos;s own picks make its bonus drop. Every round that passes adds to it, a little less each time.</text>
    </svg>
  );
}

/** Figure 7: the three rules side by side. */
function Compare() {
  const cols = [
    { x: 130, head: "Most rounds it picks" },
    { x: 300, head: "It picks something else" },
    { x: 480, head: "How often it does that" },
    { x: 660, head: "Random?" },
  ];
  const rows = [
    { name: "Greedy", cells: [["the highest average"], ["never"], ["–"], ["no"]] },
    { name: "ε-greedy", cells: [["the highest average"], ["when the lottery is drawn:", "any option, the favourite too"], ["a share ε of rounds,", "the same early and late"], ["yes"]] },
    { name: "UCB", cells: [["the highest average", "plus bonus"], ["when another option's", "bonus lifts it to the top"], ["set by c, each option's", "picks and the round"], ["no"]] },
  ];
  return (
    <svg viewBox="0 0 760 260" role="img" aria-label="Greedy, ε-greedy and UCB side by side" fontSize="13">
      <text x="24" y="30" fontSize="15" fontWeight="600" fill={ink}>The three rules side by side</text>
      {cols.map((c) => <text key={c.head} x={c.x} y="68" fontSize="11.5" fontWeight="600" fill={quiet}>{c.head}</text>)}
      {rows.map((r, i) => {
        const y = 108 + i * 56;
        return (
          <g key={r.name}>
            <line x1="24" x2="736" y1={y - 24} y2={y - 24} stroke={grid} strokeWidth="1.25" />
            <text x="24" y={y} fontWeight="600" fill={ink}>{r.name}</text>
            {r.cells.map((lines, j) => lines.map((l, k) => <text key={`${j}${k}`} x={cols[j]!.x} y={y + k * 17} fontSize="12.5" fill={ink}>{l}</text>))}
          </g>
        );
      })}
    </svg>
  );
}

export const FIGURE: Record<string, () => React.ReactElement> = { averages: Averages, greedy: Greedy, lockin: LockIn, lottery: Lottery, score: Score, bonus: Bonus, compare: Compare };
