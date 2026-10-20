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

const PAGE = 100;
/** 1.11 (minutes) → "1:07" */
const mmss = (min: unknown) => (typeof min === "number" && Number.isFinite(min) ? `${Math.floor(min)}:${String(Math.round((min % 1) * 60)).padStart(2, "0")}` : "–");

/**
 * Every session in view, newest first: one filter row (whose, which period, which condition), a search over codes,
 * labels and session ids, 100 to a page. Each row opens the session's record.
 */
export default async function Page({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  await requireAdmin();
  const q = await searchParams;
  const view = viewOf(q);
  const t = await viewTables(view);
  const find = (q.q ?? "").trim().toLowerCase().slice(0, 60);
  const all = t.sessions
    .filter((s) => !q.cond || String(s.practiceView ?? s.condition) === q.cond)
    .filter((s) => !find || [s.sid, s.pid, s.codeLabel].some((v) => String(v ?? "").toLowerCase().includes(find)))
    .sort((a, b) => String(b.startedAt).localeCompare(String(a.startedAt)));
  const page = Math.max(0, Number(q.page ?? 0) || 0);
  const rows = all.slice(page * PAGE, page * PAGE + PAGE);
  const keep = { cond: q.cond, q: find || undefined };
  const link = (p: Record<string, string | undefined>) => viewHref("/admin/sessions", view, {}, { ...keep, ...p });
  const counts = { participants: t.allSessions.filter((x) => inScope(x, "participants")).length, team: t.allSessions.filter((x) => inScope(x, "team")).length, all: t.allSessions.length };
  const topics = topicList();
  const elsewhere = view.scope === "participants" ? counts.team : 0;

  return (
    <AdminShell store={eventStore}>
      <div className="adm-head">
        <div>
          <h1>Sessions</h1>
          <p className="note">
            {all.length} {all.length === 1 ? "session" : "sessions"}{find ? ` matching “${find}”` : ""}, newest first. Team, trial and demo sessions are under &quot;Team and tests&quot;.
          </p>
        </div>
        <div className="adm-actions">
          <span className="note">Export</span>
          {(["sessions", "turns", "practice", "test"] as const).map((x) => (
            <a key={x} className="btn ghost small" href={`/api/admin/export?table=${x}`}>{x}.csv</a>
          ))}
        </div>
      </div>
      <ViewBar path="/admin/sessions" view={view} topics={topics} counts={counts}>
        <span className="adm-seg">
          {["", "direct", "recursive"].map((c) => (
            <Link key={c} href={link({ cond: c || undefined, page: undefined })} aria-current={(q.cond ?? "") === c ? "page" : undefined}>
              {c || "Both conditions"}
            </Link>
          ))}
        </span>
        <form className="adm-search" action="/admin/sessions" method="get">
          {view.scope !== "participants" && <input type="hidden" name="scope" value={view.scope} />}
          {view.days && <input type="hidden" name="days" value={view.days} />}
          {view.topic && <input type="hidden" name="topic" value={view.topic} />}
          {q.cond && <input type="hidden" name="cond" value={q.cond} />}
          <input className="input" type="search" name="q" defaultValue={find} placeholder="Code, label or session id" aria-label="Find a session" />
        </form>
      </ViewBar>
      <section className="adm-card">
        <table className="adm-table adm-sessions">
          <thead>
            <tr><th>Started</th><th>Code</th>{topics.length > 1 && <th>Topic</th>}<th>Condition</th><th>Reached</th><th>Time</th><th>Messages</th><th>Facts</th><th>Practice</th><th>Test</th><th></th></tr>
          </thead>
          <tbody>
            {rows.map((s) => {
              const rec = String(s.practiceView ?? s.condition) === "recursive";
              return (
                <tr key={String(s.sid)}>
                  <td>{when(s.startedAt)}</td>
                  <td>{String(s.pid ?? "–")} {s.codeLabel ? <span className="note">“{String(s.codeLabel)}”</span> : null} <span className="note">{String(s.entry ?? "")}{s.demo ? ", demo" : ""}{s.phase === "delayed" ? ", follow-up" : ""}</span></td>
                  {topics.length > 1 && <td>{String(s.topic)}</td>}
                  <td><span className={`adm-pill ${rec ? "rec" : "dir"}`}>{rec ? "recursive" : "direct"}</span></td>
                  <td>{String(s.reachedStep)}</td>
                  <td>{mmss(s.minTotal)}</td>
                  <td>{String(s.turns ?? 0)}</td>
                  <td>{s.factsTotal ? `${String(s.factsCorrect ?? 0)}/${String(s.factsTotal)}` : "–"}</td>
                  <td>{rec ? `Kai ${String(s.kaiFirstTry ?? 0)} + ${String(s.kaiOnRetry ?? 0)}` : `${String(s.practiceSolved ?? 0)} solved`}</td>
                  <td>{s.testScore === null || s.testScore === undefined ? "–" : `${String(s.testScore)}/${String(s.testOf)}`}</td>
                  <td><Link href={`/admin/sessions/${String(s.sid)}`}>Open</Link></td>
                </tr>
              );
            })}
            {!rows.length && (
              <tr>
                <td colSpan={11} className="note">
                  {find ? "No session matches." : "No sessions in this view yet."}
                  {elsewhere > 0 && (
                    <>
                      {" "}
                      <Link href={viewHref("/admin/sessions", view, { scope: "team" })}>{elsewhere} under Team and tests</Link>.
                    </>
                  )}
                </td>
              </tr>
            )}
          </tbody>
        </table>
        {all.length > PAGE && (
          <p className="adm-pager">
            {page > 0 && <Link href={link({ page: page > 1 ? String(page - 1) : undefined })}>Newer</Link>}
            <span className="note">
              {page * PAGE + 1} to {Math.min(all.length, (page + 1) * PAGE)} of {all.length}
            </span>
            {(page + 1) * PAGE < all.length && <Link href={link({ page: String(page + 1) })}>Older</Link>}
          </p>
        )}
      </section>
    </AdminShell>
  );
}
