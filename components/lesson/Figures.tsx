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

/** Figure 2: one unlucky first lunch can hide the best truck for good. */
function LockIn() {
  const w = 50, y0b = 108, h = 44;
  const bx = (i: number) => 40 + i * 58;
  const box = (x: number, kind: "warn" | "fav" | "none") => (
    <rect x={x} y={y0b} width={w} height={h} rx="8" fill={kind === "warn" ? warn : kind === "fav" ? accent : "none"} fillOpacity={kind === "none" ? 1 : 0.12} stroke={kind === "warn" ? warn : kind === "fav" ? accent : edge} strokeWidth={kind === "none" ? 1.25 : 2} />
  );
  const days = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9];
  const letter = ["A", "B", "C", "B", "B", "B", "B", "B", "B", "B"];
  return (
    <svg viewBox="0 0 760 250" role="img" aria-label="One unlucky first lunch can hide the best truck for good" fontSize="13">
      <text x="24" y="30" fontSize="15" fontWeight="600" fill={ink}>One unlucky first lunch can hide the best truck for good</text>
      <text x="24" y="52" fontSize="11.5" fill={quiet}>Which truck greedy picks, day by day</text>
      <text x={bx(3)} y="96" fontSize="11.5" fill={ink}>From day 4 on, greedy always picks its favourite, B</text>
      {days.map((i) => (
        <g key={i}>
          {box(bx(i), i === 0 ? "warn" : i < 3 ? "none" : "fav")}
          <text x={bx(i) + 25} y={y0b + 27} textAnchor="middle" fontWeight="600" fill={ink}>{letter[i]}</text>
          <text x={bx(i) + 25} y="172" textAnchor="middle" fontSize="11.5" fill={quiet}>day {i + 1}</text>
        </g>
      ))}
      <text x="643" y={y0b + 27} textAnchor="middle" fill={quiet}>…</text>
      {box(668, "fav")}
      <text x="693" y={y0b + 27} textAnchor="middle" fontWeight="600" fill={ink}>B</text>
      <text x="693" y="172" textAnchor="middle" fontSize="11.5" fill={quiet}>day 365</text>
      <text x="40" y="206" fontSize="11.5" fill={ink}>Day 1: A, truly the best truck, has a poor lunch by bad luck.</text>
      <text x="40" y="228" fontSize="11.5" fill={ink}>A is never tried again, so its low average is never corrected.</text>
    </svg>
  );
}

/** Figure 3: ε-greedy flips a weighted coin every round. */
function Lottery() {
  return (
    <svg viewBox="0 0 760 252" role="img" aria-label="ε-greedy flips a weighted coin every round" fontSize="13">
      <defs><Arrow id="lf3-arrow" fill={edge} /></defs>
      <text x="24" y="30" fontSize="15" fontWeight="600" fill={ink}>ε-greedy flips a weighted coin every round</text>
      <g fill="none" stroke={edge} strokeWidth="1.25">
        <path d="M185 150H256" markerEnd="url(#lf3-arrow)" />
        <path d="M330 108V92H470" markerEnd="url(#lf3-arrow)" />
        <path d="M330 192V210H470" markerEnd="url(#lf3-arrow)" />
      </g>
      <rect x="35" y="128" width="150" height="44" rx="8" fill="none" stroke={edge} strokeWidth="1.25" />
      <text x="110" y="154" textAnchor="middle" fill={ink}>Each round</text>
      <polygon points="256,150 330,108 404,150 330,192" fill="none" stroke={edge} strokeWidth="1.25" />
      <text x="330" y="146" textAnchor="middle" fill={ink}>Random number</text>
      <text x="330" y="164" textAnchor="middle" fill={ink}>below ε?</text>
      <text x="400" y="84" textAnchor="middle" fontSize="11.5" fill={quiet}>yes, chance ε</text>
      <text x="400" y="202" textAnchor="middle" fontSize="11.5" fill={quiet}>otherwise</text>
      <rect x="470" y="62" width="266" height="60" rx="8" fill={accent} fillOpacity="0.12" stroke={accent} strokeWidth="2" />
      <text x="486" y="87" fontWeight="600" fill={ink}>Lottery among all k options</text>
      <text x="486" y="108" fontSize="11.5" fill={ink}>each 1/k, the favourite included</text>
      <text x="486" y="142" fontSize="11.5" fill={quiet}>ignores the averages and</text>
      <text x="486" y="158" fontSize="11.5" fill={quiet}>how often each option was tried</text>
      <rect x="470" y="188" width="266" height="44" rx="8" fill="none" stroke={edge} strokeWidth="1.25" />
      <text x="603" y="214" textAnchor="middle" fill={ink}>Pick the favourite</text>
    </svg>
  );
}

/** Figure 4: each pick shrinks the bonus, and passing rounds grow it ever more slowly. */
function Bonus() {
  const base = 244, peak = 110, span = base - peak;
  const picks = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12];
  const px = (n: number) => 78 + (n - 1) * 22, py = (n: number) => base - span / Math.sqrt(n);
  const dots = picks.map((n) => `${px(n)},${py(n).toFixed(1)}`).join(" ");
  const rounds = [20, 30, 45, 70, 100, 150, 220, 320, 450, 600, 800, 1000];
  const rx = (t: number) => 438 + ((t - 20) / 980) * 250, ry = (t: number) => base - span * Math.sqrt(Math.log(t) / Math.log(1000));
  const curve = "M" + rounds.map((t) => `${rx(t).toFixed(1)} ${ry(t).toFixed(1)}`).join("L");
  return (
    <svg viewBox="0 0 760 292" role="img" aria-label="Each pick shrinks the bonus, and passing rounds grow it ever more slowly" fontSize="13">
      <defs><Arrow id="lf4-arrow" fill={accent} /></defs>
      <text x="24" y="30" fontSize="15" fontWeight="600" fill={ink}>Each pick shrinks the bonus, and passing rounds grow it ever more slowly</text>
      <text x="60" y="68" fontWeight="600" fill={ink}>Each pick of the option shrinks it</text>
      <text x="60" y="86" fontSize="11.5" fill={quiet}>picks of other options do not shrink it</text>
      <line x1="60" y1="100" x2="60" y2={base} stroke={edge} strokeWidth="1.25" />
      <line x1="60" y1={base} x2="340" y2={base} stroke={edge} strokeWidth="1.25" />
      <polyline points={dots} fill="none" stroke={accent} strokeWidth="1.25" strokeOpacity="0.45" />
      {picks.map((n) => <circle key={n} cx={px(n)} cy={py(n)} r="4" fill={accent} />)}
      <text x="46" y="172" transform="rotate(-90 46 172)" textAnchor="middle" fontSize="11.5" fill={quiet}>bonus</text>
      <text x="200" y="268" textAnchor="middle" fontSize="11.5" fill={quiet}>times this option was picked (n)</text>
      <text x="430" y="68" fontWeight="600" fill={ink}>Passing rounds grow it, ever more slowly</text>
      <text x="430" y="86" fontSize="11.5" fill={quiet}>because <tspan className="ln">ln</tspan> t grows, for every option</text>
      <line x1="430" y1="100" x2="430" y2={base} stroke={edge} strokeWidth="1.25" />
      <line x1="430" y1={base} x2="710" y2={base} stroke={edge} strokeWidth="1.25" />
      <path d={curve} fill="none" stroke={accent} strokeWidth="2" markerEnd="url(#lf4-arrow)" />
      <text x="688" y="142" textAnchor="end" fontSize="11.5" fill={quiet}>keeps growing, without limit</text>
      <text x="416" y="172" transform="rotate(-90 416 172)" textAnchor="middle" fontSize="11.5" fill={quiet}>bonus</text>
      <text x="570" y="268" textAnchor="middle" fontSize="11.5" fill={quiet}>rounds (t) while this option is not picked</text>
    </svg>
  );
}

/** Figure 5: UCB picks the highest score, average plus bonus. */
function Score() {
  const base = 262, w = 96;
  const bar = (cx: number, avg: number, bonus: number) => (
    <g>
      <rect x={cx - w / 2} y={base - avg} width={w} height={avg} fill={edge} fillOpacity="0.18" stroke={edge} strokeWidth="1.25" />
      <rect x={cx - w / 2} y={base - avg - bonus} width={w} height={bonus} fill={accent} fillOpacity="0.35" stroke={accent} strokeWidth="1.5" />
    </g>
  );
  return (
    <svg viewBox="0 0 760 326" role="img" aria-label="UCB picks the highest score, average plus bonus" fontSize="13">
      <text x="24" y="30" fontSize="15" fontWeight="600" fill={ink}>UCB picks the highest score, average plus bonus</text>
      <line x1="160" y1="84" x2="600" y2="84" stroke={edge} strokeWidth="1.25" strokeDasharray="4 4" />
      <text x="380" y="70" textAnchor="middle" fontWeight="600" fill={ink}>highest score, so UCB picks B</text>
      {bar(230, 150, 14)}
      <text x="230" y="286" textAnchor="middle" fontWeight="600" fill={ink}>A</text>
      <text x="230" y="304" textAnchor="middle" fontSize="11.5" fill={quiet}>highest average</text>
      {bar(380, 118, 60)}
      <text x="380" y="286" textAnchor="middle" fontWeight="600" fill={ink}>B</text>
      {bar(530, 60, 90)}
      <text x="530" y="161" textAnchor="middle" fontSize="11.5" fill={ink}>bonus</text>
      <text x="530" y="236" textAnchor="middle" fontSize="11.5" fill={ink}>average</text>
      <text x="530" y="286" textAnchor="middle" fontWeight="600" fill={ink}>C</text>
      <text x="530" y="304" textAnchor="middle" fontSize="11.5" fill={quiet}>biggest bonus</text>
      <line x1="150" y1={base} x2="610" y2={base} stroke={edge} strokeWidth="1.25" />
    </svg>
  );
}

export const FIGURE: Record<string, () => React.ReactElement> = { averages: Averages, lockin: LockIn, lottery: Lottery, bonus: Bonus, score: Score };
