import Link from "next/link";
import { requireAdmin } from "@/lib/server/admin";
import { loadTables } from "@/lib/server/admindata";
import { eventStore } from "@/lib/server/events";
import AdminShell from "@/components/admin/AdminShell";

export const dynamic = "force-dynamic";
export const metadata = { title: "Docendo: feedback", robots: { index: false, follow: false } };

export default async function Page() {
  await requireAdmin();
  const t = await loadTables();
  const rows = [...t.feedback].reverse();
  const rated = rows.filter((r) => typeof r.rating === "number");
  const avg = rated.length ? Math.round((rated.reduce((a, r) => a + Number(r.rating), 0) / rated.length) * 10) / 10 : null;
  return (
    <AdminShell store={eventStore}>
      <div className="adm-head">
        <div>
          <h1>Feedback</h1>
          <p className="note">From the box at the end of a session. {rows.length} {rows.length === 1 ? "answer" : "answers"}{avg !== null ? `, mean rating ${avg} of 5` : ""}.</p>
        </div>
        <div className="adm-actions"><a className="btn ghost small" href="/api/admin/export?table=feedback">feedback.csv</a></div>
      </div>
      <section className="adm-card">
        <ul className="adm-quotes">
          {rows.map((f, i) => (
            <li key={i}>
              {typeof f.rating === "number" && <b>{f.rating}/5 </b>}
              {String(f.text || "(rating only)")}
              <span className="note"> {String(f.condition)}, {String(f.entry)}{f.testScore !== null && f.testScore !== undefined ? `, test ${String(f.testScore)}/10` : ""}, </span>
              <Link className="note" href={`/admin/sessions/${String(f.sid)}`}>session</Link>
            </li>
          ))}
          {!rows.length && <li className="note">No feedback yet.</li>}
        </ul>
      </section>
    </AdminShell>
  );
}
