import Link from "next/link";
import { requireAdmin } from "@/lib/server/admin";
import { eventStore } from "@/lib/server/events";
import { viewHref, viewOf, viewTables } from "@/lib/server/adminview";
import { inScope } from "@/lib/analytics";
import AdminShell from "@/components/admin/AdminShell";
import ViewBar from "@/components/admin/ViewBar";

export const dynamic = "force-dynamic";
export const metadata = { title: "Docendo: feedback", robots: { index: false, follow: false } };

const mean = (xs: number[]) => (xs.length ? Math.round((xs.reduce((a, b) => a + b, 0) / xs.length) * 10) / 10 : null);

/** What learners wrote in the box at the end of a session, newest first, with the rating per condition. */
export default async function Page({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  await requireAdmin();
  const view = viewOf(await searchParams);
  const t = await viewTables(view);
  const rows = [...t.feedback].reverse();
  const ratings = (cond?: string) => rows.filter((r) => typeof r.rating === "number" && (!cond || r.condition === cond)).map((r) => Number(r.rating));
  const counts = { participants: t.allSessions.filter((x) => inScope(x, "participants")).length, team: t.allSessions.filter((x) => inScope(x, "team")).length, all: t.allSessions.length };
  const elsewhere = view.scope === "participants" ? counts.team : 0;
  return (
    <AdminShell store={eventStore}>
      <div className="adm-head">
        <div>
          <h1>Feedback</h1>
          <p className="note">
            From the box at the end of a session: {rows.length} {rows.length === 1 ? "answer" : "answers"}, {rows.filter((r) => String(r.text ?? "").trim()).length} with words.
          </p>
        </div>
        <div className="adm-actions">
          <a className="btn ghost small" href="/api/admin/export?table=feedback">feedback.csv</a>
        </div>
      </div>
      <ViewBar path="/admin/feedback" view={view} counts={counts} />
      {rows.length > 0 && (
        <section className="adm-kpis">
          <div>
            <b>{mean(ratings()) ?? "–"}</b>
            <span>mean rating of 5 ({ratings().length} rated)</span>
          </div>
          <div>
            <b>{mean(ratings("direct")) ?? "–"}</b>
            <span>direct ({ratings("direct").length})</span>
          </div>
          <div>
            <b>{mean(ratings("recursive")) ?? "–"}</b>
            <span>recursive ({ratings("recursive").length})</span>
          </div>
        </section>
      )}
      <section className="adm-card">
        <ul className="adm-quotes">
          {rows.map((f, i) => (
            <li key={i}>
              {typeof f.rating === "number" && <b>{f.rating}/5 </b>}
              {String(f.text || "(rating only)")}
              <span className="note">
                {" "}
                <span className={`adm-pill ${f.condition === "recursive" ? "rec" : "dir"}`}>{String(f.condition)}</span> {String(f.entry)}
                {f.testScore !== null && f.testScore !== undefined ? `, test ${String(f.testScore)}/${String(f.testOf ?? "?")}` : ""},{" "}
              </span>
              <Link className="note" href={`/admin/sessions/${String(f.sid)}`}>
                session
              </Link>
            </li>
          ))}
          {!rows.length && (
            <li className="note">
              No feedback in this view yet.
              {elsewhere > 0 && (
                <>
                  {" "}
                  <Link href={viewHref("/admin/feedback", view, { scope: "team" })}>See Team and tests</Link>.
                </>
              )}
            </li>
          )}
        </ul>
      </section>
    </AdminShell>
  );
}
