import Link from "next/link";
import { requireAdmin } from "@/lib/server/admin";
import { loadTables } from "@/lib/server/admindata";
import { eventStore } from "@/lib/server/events";
import { charts, summarize } from "@/lib/analytics";
import { DailyBars, FunnelPairs, Legend, MinutesBars, Scatter, ScoreHist } from "@/components/admin/Charts";
import { testVersion } from "@/lib/server/content";
import { getSettings } from "@/lib/server/settings";
import AdminShell from "@/components/admin/AdminShell";

export const dynamic = "force-dynamic";
export const metadata = { title: "Docendo: admin", robots: { index: false, follow: false } };

const pctText = (v: number | null) => (v === null ? "–" : `${v}%`);
const minText = (v: number | null) => (v === null ? "–" : `${v} min`);

function Bar({ value, max = 100, tone = "blue" }: { value: number | null; max?: number; tone?: "blue" | "green" | "red" | "grey" }) {
  return (
    <span className={`adm-bar ${tone}`} aria-hidden="true">
      <i style={{ width: `${value === null || !max ? 0 : Math.max(2, (value / max) * 100)}%` }} />
    </span>
  );
}

export default async function Page({ searchParams }: { searchParams: Promise<{ all?: string }> }) {
  await requireAdmin();
  const all = (await searchParams).all === "1";
  const t = await loadTables();
  const versions = { A: testVersion("A"), B: testVersion("B") };
  const s = summarize(t, { all, testVersions: Object.values(versions) });
  const c = charts(t, { all });
  const { settings } = await getSettings();
  const flagged = new Set(c.flags.flatMap((f) => f.sids)).size;
  const cmp = c.comparison;
  const feedback = t.feedback.filter((f) => all || f.entry === "participant").slice(-3).reverse();

  return (
    <AdminShell store={eventStore}>
      <div className="adm-head">
        <div>
          <h1>Dashboard</h1>
          <p className="note">
            {all ? "Every session, tests included." : "Participants' sessions only (their own code, not demo)."}{" "}
            <Link href={all ? "/admin" : "/admin?all=1"}>{all ? "Participants only" : "Include team and test sessions"}</Link>
          </p>
        </div>
        <Legend />
      </div>

      <section className="adm-kpis">
        <div><b>{s.sessions}</b><span>sessions: {s.byCondition.direct} direct, {s.byCondition.recursive} recursive</span></div>
        <div><b>{s.finished}</b><span>finished the test ({s.sessions ? Math.round((s.finished / s.sessions) * 100) : 0}%)</span></div>
        <div><b>{minText(s.minutes.find((m) => m.chapter === "Total")!.all)}</b><span>median session</span></div>
        <div><b>{s.testMean.direct ?? "–"} / {s.testMean.recursive ?? "–"}</b><span>mean test score, direct / recursive</span></div>
        <div className={flagged ? "warn" : ""}><b>{flagged}</b><span>sessions to look at (data quality)</span></div>
        <div><b>${s.cost}</b><span>model cost{s.finished ? `, $${(s.cost / s.finished).toFixed(3)} a finished session` : ""}</span></div>
      </section>

      <div className="adm-cols">
        <section className="adm-card">
          <h2>Sessions per day</h2>
          <p className="note">The last three weeks, by the condition each session practised in.</p>
          <DailyBars daily={c.daily} />
        </section>
        <section className="adm-card">
          <h2>How far people get</h2>
          <p className="note">Share of each condition&apos;s sessions that reached a step (counts: direct / recursive).</p>
          <FunnelPairs funnel={c.funnel} />
        </section>
        <section className="adm-card">
          <h2>Final test scores</h2>
          <p className="note">Share of each condition at each score, 0 to 10; the lines mark the means.</p>
          <ScoreHist hist={c.hist} />
        </section>
        <section className="adm-card">
          <h2>Recursive against direct, so far</h2>
          <p className="note">Finished, not excluded. Descriptive only: not the planned analysis (pretest-adjusted, at the planned sample size).</p>
          {cmp ? (
            <div className="adm-effect">
              <div>
                <b className={cmp.diff >= 0 ? "pos" : "neg"}>{cmp.diff >= 0 ? "+" : ""}{cmp.diff}</b>
                <span>points, recursive minus direct (95% interval {cmp.lo} to {cmp.hi})</span>
              </div>
              <div className="adm-effect-bar" aria-hidden="true">
                <span className="zero" />
                <span className="ci" style={{ left: `${50 + Math.max(-50, Math.min(50, cmp.lo * 10))}%`, right: `${50 - Math.max(-50, Math.min(50, cmp.hi * 10))}%` }} />
                <span className="pt" style={{ left: `${50 + Math.max(-50, Math.min(50, cmp.diff * 10))}%` }} />
              </div>
              <dl className="adm-dl">
                <dt>Mean, recursive / direct</dt><dd>{cmp.m1} / {cmp.m2}</dd>
                <dt>Sessions, recursive / direct</dt><dd>{cmp.n1} / {cmp.n2}</dd>
                <dt>Cohen&apos;s d</dt><dd>{cmp.d ?? "–"}</dd>
              </dl>
            </div>
          ) : (
            <p className="note">Needs at least two finished sessions in each condition.</p>
          )}
          <h3 className="adm-sub">Balance: condition × test form</h3>
          <table className="adm-table adm-balance">
            <thead>
              <tr><th></th><th>Form A first</th><th>Form B first</th></tr>
            </thead>
            <tbody>
              {c.balance.map((b) => (
                <tr key={b.cond}><td><span className={`adm-pill ${b.cond === "direct" ? "dir" : "rec"}`}>{b.cond}</span></td><td>{b.A}</td><td>{b.B}</td></tr>
              ))}
            </tbody>
          </table>
        </section>
        <section className="adm-card">
          <h2>Pretest against final test</h2>
          <p className="note">One dot per finished session (pretest 0 to 3 across, final test 0 to 10 up).</p>
          <Scatter points={c.points} preMax={s.pretest.of} />
        </section>
        <section className="adm-card">
          <h2>After the test</h2>
          <p className="note">The questions before the score, means from 1 to 7 (direct / recursive), and the manipulation check.</p>
          <ol className="ch-funnel">
            {c.survey.map((q) => (
              <li key={q.key}>
                <span>{q.key}</span>
                <span className="ch-pair">
                  <i className="ch-d" style={{ width: `${((q.direct ?? 0) / 7) * 100}%` }} />
                  <i className="ch-r" style={{ width: `${((q.recursive ?? 0) / 7) * 100}%` }} />
                </span>
                <b>{q.direct ?? "–"} / {q.recursive ?? "–"}</b>
              </li>
            ))}
          </ol>
          <h3 className="adm-sub">The practice&apos;s light was mostly about…</h3>
          <table className="adm-table adm-balance">
            <thead>
              <tr><th></th><th>my understanding</th><th>Kai&apos;s</th><th>not sure</th></tr>
            </thead>
            <tbody>
              {c.lights.map((l) => (
                <tr key={l.cond}><td><span className={`adm-pill ${l.cond === "direct" ? "dir" : "rec"}`}>{l.cond}</span></td><td>{l.own}</td><td>{l.kai}</td><td>{l.unsure}</td></tr>
              ))}
            </tbody>
          </table>
          <p className="note" style={{ marginTop: 8 }}>Expected: direct answers &quot;my understanding&quot;, recursive &quot;Kai&apos;s&quot;. If not, the manipulation didn&apos;t land.</p>
        </section>
        <section className="adm-card">
          <h2>Minutes per chapter</h2>
          <p className="note">Medians (direct / recursive). Practice is timed at the same length in both.</p>
          <MinutesBars minutes={c.minutes} />
        </section>
      </div>

      <section className="adm-card">
        <h2>Practice problems</h2>
        <p className="note">Direct: the learner&apos;s first try, and solved in two tries. Recursive: Kai&apos;s first try, right after the learner&apos;s correction, and how often the learner called Kai&apos;s answer right before the light.</p>
        <table className="adm-table">
          <thead>
            <tr><th>Problem</th><th>Direct (n)</th><th>First try</th><th>Solved</th><th>Time</th><th>Recursive (n)</th><th>Kai first try</th><th>After correction</th><th>Calls right</th><th>Time</th></tr>
          </thead>
          <tbody>
            {s.practice.map((p) => (
              <tr key={p.id}>
                <td><b>{p.id}</b> <span className="note">round {String(p.round ?? "?")}</span></td>
                <td>{p.direct.tried}</td>
                <td><Bar value={p.direct.firstTry} tone="green" /> {pctText(p.direct.firstTry)}</td>
                <td>{pctText(p.direct.solved)}</td>
                <td>{p.direct.sec === null ? "–" : `${p.direct.sec} s`}</td>
                <td>{p.recursive.tried}</td>
                <td><Bar value={p.recursive.kaiFirst} tone="green" /> {pctText(p.recursive.kaiFirst)}</td>
                <td>{pctText(p.recursive.kaiAfter)}</td>
                <td>{pctText(p.recursive.callsRight)}</td>
                <td>{p.recursive.sec === null ? "–" : `${p.recursive.sec} s`}</td>
              </tr>
            ))}
            {!s.practice.length && <tr><td colSpan={9} className="note">No practice data yet.</td></tr>}
          </tbody>
        </table>
      </section>

      <div className="adm-cols">
        <section className="adm-card">
          <h2>Final test items</h2>
          <p className="note">
            Share correct. Aim for about half in the pilot. Final test only, current versions of forms A ({versions.A}) and B ({versions.B})
            {s.testOtherVersions ? `; ${s.testOtherVersions} answers to earlier versions are left out here (they are in the export)` : ""}.
          </p>
          <table className="adm-table">
            <thead>
              <tr><th>Item</th><th>n</th><th>All</th><th>Direct</th><th>Recursive</th></tr>
            </thead>
            <tbody>
              {s.test.map((q) => (
                <tr key={q.id}>
                  <td><b>{q.id}</b></td>
                  <td>{q.n}</td>
                  <td><Bar value={q.all} tone={q.all !== null && (q.all > 85 || q.all < 20) ? "red" : "blue"} /> {pctText(q.all)}</td>
                  <td>{pctText(q.direct)}</td>
                  <td>{pctText(q.recursive)}</td>
                </tr>
              ))}
              {!s.test.length && <tr><td colSpan={5} className="note">No test answers yet.</td></tr>}
            </tbody>
          </table>
        </section>
        <section className="adm-card">
          <h2>Teaching Kai</h2>
          <dl className="adm-dl">
            <dt>Messages per learner (median)</dt><dd>{s.teaching.turns ?? "–"}</dd>
            <dt>Facts explained (median)</dt><dd>{s.teaching.facts ?? "–"}{s.teaching.factsTotal ? ` of ${s.teaching.factsTotal}` : ""}</dd>
            <dt>Misconceptions stated (mean)</dt><dd>{s.teaching.misconceptions ?? "–"}</dd>
            <dt>How teaching ended</dt>
            <dd>{Object.entries(s.teaching.readyReasons).map(([k, n]) => `${k} ${n}`).join(", ") || "–"}</dd>
            <dt>Pretest (mean score)</dt><dd>{s.pretest.mean ?? "–"} of {s.pretest.of}; {s.excluded} excluded (took an RL course)</dd>
            <dt>Replies with a blocked lesson word</dt><dd>{s.teaching.leaks}</dd>
            <dt>Turns answered offline (no credits)</dt><dd>{s.teaching.degraded}</dd>
          </dl>
          {(settings.delayedTestDays > 0 || s.delayed.n > 0) && (
            <>
              <h2 style={{ marginTop: 18 }}>Follow-up test</h2>
              <p className="note">
                {settings.delayedTestDays ? `Opens ${settings.delayedTestDays} days after the final test, with the other form.` : "Switched off (Settings: follow-up test days is 0)."}
              </p>
              <dl className="adm-dl">
                <dt>Came back / finished</dt><dd>{s.delayed.n} / {s.delayed.finished}</dd>
                <dt>Mean score, direct / recursive</dt><dd>{s.delayed.mean.direct ?? "–"} / {s.delayed.mean.recursive ?? "–"}</dd>
                <dt>Days after the final test (median)</dt><dd>{s.delayed.days ?? "–"}</dd>
                <dt>Studied the topic since</dt><dd>{s.delayed.studiedSince} of {s.delayed.finished}</dd>
              </dl>
            </>
          )}
          <h2 style={{ marginTop: 18 }}>Data quality</h2>
          <p className="note">Sessions that may need a second look before the analysis.</p>
          <ul className="adm-flags">
            {c.flags.map((f) => (
              <li key={f.key} className={f.sids.length ? "on" : ""}>
                <b>{f.sids.length}</b>
                <span>{f.label}</span>
                {f.sids.length > 0 && (
                  <Link className="note" href={`/admin/sessions/${f.sids[0]}`}>
                    first one
                  </Link>
                )}
              </li>
            ))}
          </ul>
          <h2 style={{ marginTop: 18 }}>Latest feedback</h2>
          {feedback.length ? (
            <ul className="adm-quotes">
              {feedback.map((f, i) => (
                <li key={i}>
                  {f.rating ? <b>{String(f.rating)}/5</b> : null} {String(f.text || "(rating only)")}{" "}
                  <Link className="note" href={`/admin/sessions/${String(f.sid)}`}>session</Link>
                </li>
              ))}
            </ul>
          ) : (
            <p className="note">No feedback yet.</p>
          )}
        </section>
      </div>
    </AdminShell>
  );
}
