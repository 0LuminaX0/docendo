import Link from "next/link";
import { requireAdmin } from "@/lib/server/admin";
import { loadTables } from "@/lib/server/admindata";
import { eventStore } from "@/lib/server/events";
import { summarize } from "@/lib/analytics";
import AdminShell from "@/components/admin/AdminShell";

export const dynamic = "force-dynamic";
export const metadata = { title: "Docendo: admin", robots: { index: false, follow: false } };

const STEP_NAME: Record<string, string> = { start: "Started", pretest: "Pretest", watch: "Watched", teach: "Taught Kai", practice: "Practised", test: "Final test", results: "Finished" };
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
  const s = summarize(t, { all });
  const feedback = t.feedback.filter((f) => all || f.entry === "participant").slice(-3).reverse();
  const top = s.funnel[0]!.n;

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
        <div className="adm-actions">
          <a className="btn small" href="/api/admin/export?table=sessions">Sessions CSV</a>
          <a className="btn ghost small" href="/api/admin/export?table=events">All events</a>
        </div>
      </div>

      <section className="adm-kpis">
        <div><b>{s.sessions}</b><span>sessions</span></div>
        <div><b>{s.finished}</b><span>finished the test</span></div>
        <div><b>{s.byCondition.direct} / {s.byCondition.recursive}</b><span>direct / recursive</span></div>
        <div><b>{minText(s.minutes.find((m) => m.chapter === "Total")!.all)}</b><span>median session</span></div>
        <div><b>{s.testMean.direct ?? "–"} / {s.testMean.recursive ?? "–"}</b><span>mean test score, direct / recursive</span></div>
        <div><b>${s.cost}</b><span>model cost</span></div>
      </section>

      <div className="adm-cols">
        <section className="adm-card">
          <h2>How far people get</h2>
          <ol className="adm-funnel">
            {s.funnel.map((f) => (
              <li key={f.step}>
                <span>{STEP_NAME[f.step]}</span>
                <Bar value={f.n} max={top} />
                <b>{f.n}</b>
              </li>
            ))}
          </ol>
        </section>
        <section className="adm-card">
          <h2>Time per chapter (median)</h2>
          <table className="adm-table">
            <thead>
              <tr><th>Chapter</th><th>All</th><th>Direct</th><th>Recursive</th></tr>
            </thead>
            <tbody>
              {s.minutes.map((m) => (
                <tr key={m.chapter}><td>{m.chapter}</td><td>{minText(m.all)}</td><td>{minText(m.direct)}</td><td>{minText(m.recursive)}</td></tr>
              ))}
            </tbody>
          </table>
        </section>
      </div>

      <section className="adm-card">
        <h2>Practice problems</h2>
        <p className="note">Direct: the learner&apos;s first try, and solved in two tries. Recursive: Kai&apos;s first try, and right after the learner&apos;s correction.</p>
        <table className="adm-table">
          <thead>
            <tr><th>Problem</th><th>Direct (n)</th><th>First try</th><th>Solved</th><th>Time</th><th>Recursive (n)</th><th>Kai first try</th><th>After correction</th><th>Time</th></tr>
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
          <p className="note">Share correct. Aim for about half in the pilot.</p>
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
