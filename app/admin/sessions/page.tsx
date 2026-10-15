import Link from "next/link";
import { requireAdmin } from "@/lib/server/admin";
import { eventStore } from "@/lib/server/events";
import { viewHref, viewOf, viewTables } from "@/lib/server/adminview";
import { inScope } from "@/lib/analytics";
import { topicList } from "@/lib/server/study";
import AdminShell from "@/components/admin/AdminShell";
import ViewBar from "@/components/admin/ViewBar";

export const dynamic = "force-dynamic";
export const metadata = { title: "Docendo: sessions", robots: { index: false, follow: false } };

const when = (iso: unknown) => (typeof iso === "string" ? new Date(iso).toLocaleString("en-GB", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" }) : "–");

export default async function Page({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  await requireAdmin();
  const q = await searchParams;
  const view = viewOf(q);
  const t = await viewTables(view);
  const rows = t.sessions
    .filter((s) => !q.cond || String(s.practiceView ?? s.condition) === q.cond)
    .sort((a, b) => String(b.startedAt).localeCompare(String(a.startedAt)));
  const link = (p: Record<string, string | undefined>) => viewHref("/admin/sessions", view, {}, { cond: q.cond, ...p });
  const counts = { participants: t.allSessions.filter((x) => inScope(x, "participants")).length, team: t.allSessions.filter((x) => inScope(x, "team")).length, all: t.allSessions.length };
  const topics = topicList();

  return (
    <AdminShell store={eventStore}>
      <div className="adm-head">
        <div>
          <h1>Sessions</h1>
          <p className="note">
            {rows.length} {rows.length === 1 ? "session" : "sessions"}. Team sessions (the shared code, team codes) and demo sessions are under &quot;Team and tests&quot;.
          </p>
          <p className="adm-filters">
            {["", "direct", "recursive"].map((c) => (
              <Link key={c} href={link({ cond: c })} aria-current={(q.cond ?? "") === c ? "page" : undefined} className="adm-filter">
                {c || "both conditions"}
              </Link>
            ))}
          </p>
        </div>
        <div className="adm-actions">
          {(["sessions", "turns", "practice", "test"] as const).map((x) => (
            <a key={x} className="btn ghost small" href={`/api/admin/export?table=${x}`}>{x}.csv</a>
          ))}
        </div>
      </div>
      <ViewBar path="/admin/sessions" view={view} topics={topics} counts={counts} />
      <section className="adm-card">
        <table className="adm-table adm-sessions">
          <thead>
            <tr><th>Started</th><th>Code</th>{topics.length > 1 && <th>Topic</th>}<th>Condition</th><th>Reached</th><th>Minutes</th><th>Messages</th><th>Facts</th><th>Practice</th><th>Test</th><th></th></tr>
          </thead>
          <tbody>
            {rows.map((s) => {
              const rec = String(s.practiceView ?? s.condition) === "recursive";
              return (
                <tr key={String(s.sid)}>
                  <td>{when(s.startedAt)}</td>
                  <td>{String(s.pid ?? "–")} <span className="note">{String(s.entry ?? "")}{s.demo ? ", demo" : ""}{s.phase === "delayed" ? ", follow-up" : ""}</span></td>
                  {topics.length > 1 && <td>{String(s.topic)}</td>}
                  <td><span className={`adm-pill ${rec ? "rec" : "dir"}`}>{rec ? "recursive" : "direct"}</span></td>
                  <td>{String(s.reachedStep)}</td>
                  <td>{s.minTotal === null ? "–" : String(s.minTotal)}</td>
                  <td>{String(s.turns ?? 0)}</td>
                  <td>{String(s.factsCorrect ?? 0)}/{String(s.factsTotal ?? "–")}</td>
                  <td>{rec ? `Kai ${String(s.kaiFirstTry ?? 0)} + ${String(s.kaiOnRetry ?? 0)}` : `${String(s.practiceSolved ?? 0)} solved`}</td>
                  <td>{s.testScore === null || s.testScore === undefined ? "–" : `${String(s.testScore)}/${String(s.testOf)}`}</td>
                  <td><Link href={`/admin/sessions/${String(s.sid)}`}>Open</Link></td>
                </tr>
              );
            })}
            {!rows.length && <tr><td colSpan={10} className="note">No sessions yet.</td></tr>}
          </tbody>
        </table>
      </section>
    </AdminShell>
  );
}
