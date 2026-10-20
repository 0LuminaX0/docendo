import Link from "next/link";
import { requireAdmin } from "@/lib/server/admin";
import { eventStore } from "@/lib/server/events";
import { loadTables } from "@/lib/server/admindata";
import { inScope } from "@/lib/analytics";
import { currentStudy } from "@/lib/server/study";
import { BLOCKS, flowOf, type StepKey } from "@/lib/flow";
import AdminShell from "@/components/admin/AdminShell";
import AutoRefresh from "@/components/admin/AutoRefresh";

export const dynamic = "force-dynamic";
export const metadata = { title: "Docendo: live", robots: { index: false, follow: false } };

const STEP_BY_PATH: Record<string, StepKey> = Object.fromEntries(BLOCKS.map((b) => [b.path, b.key]));
const ago = (ms: number) => (ms < 60_000 ? "just now" : ms < 3_600_000 ? `${Math.round(ms / 60_000)} min ago` : ms < 2 * 86_400_000 ? `${Math.round(ms / 3_600_000)} h ago` : `${Math.round(ms / 86_400_000)} days ago`);

/**
 * Sessions as they happen: everyone active in the last three hours, where they are in the session and when they last
 * did something. For running a lab session or a pilot: who is stuck, who has left. Refreshes itself.
 */
export default async function Page() {
  await requireAdmin();
  const t = await loadTables();
  const { settings } = await currentStudy({ fresh: true });
  const flow = flowOf(settings);
  const now = Date.now();
  const recent = t.sessions
    .filter((s) => s.lastAt && now - Date.parse(String(s.lastAt)) < 3 * 3_600_000)
    .sort((a, b) => String(b.lastAt).localeCompare(String(a.lastAt)));
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const startedToday = t.sessions.filter((s) => Date.parse(String(s.startedAt)) >= today.getTime());
  const state = (s: Record<string, unknown>) => {
    const idle = now - Date.parse(String(s.lastAt));
    return s.reachedStep === "results" ? "done" : idle < 5 * 60_000 ? "active" : idle < 30 * 60_000 ? "idle" : "gone";
  };
  const active = recent.filter((s) => state(s) === "active").length;
  const last = [...t.sessions].filter((s) => s.lastAt).sort((a, b) => String(b.lastAt).localeCompare(String(a.lastAt)))[0];

  return (
    <AdminShell store={eventStore}>
      <div className="adm-head">
        <div>
          <h1>Live</h1>
          <p className="note">Everyone active in the last three hours, newest first. Active: something logged in the last 5 minutes; idle: 5 to 30; gone: longer, without finishing.</p>
        </div>
        <AutoRefresh seconds={20} />
      </div>

      <section className="adm-kpis">
        <div className={active ? "live" : ""}>
          <b>{active}</b>
          <span>active now</span>
        </div>
        <div>
          <b>{startedToday.length}</b>
          <span>started today ({startedToday.filter((s) => inScope(s, "participants")).length} participants)</span>
        </div>
        <div>
          <b>{startedToday.filter((s) => s.testScore !== null && s.testScore !== undefined).length}</b>
          <span>finished today</span>
        </div>
        <div>
          <b>{recent.filter((s) => state(s) === "gone").length}</b>
          <span>left without finishing (3 h)</span>
        </div>
      </section>

      <section className="adm-card">
        <table className="adm-table adm-live">
          <thead>
            <tr>
              <th></th>
              <th>Who</th>
              <th>Condition</th>
              <th>Where</th>
              <th>Through the session</th>
              <th>In for</th>
              <th>Last activity</th>
              <th>Messages</th>
              <th>Test</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {recent.slice(0, 60).map((s) => {
              const st = state(s);
              const step = s.reachedStep === "results" ? "results" : (STEP_BY_PATH[String(s.lastPath ?? "")] ?? null);
              const at = step ? flow.indexOf(step) : -1;
              const rec = String(s.practiceView ?? s.condition) === "recursive";
              return (
                <tr key={String(s.sid)} className={st === "gone" ? "off" : ""}>
                  <td>
                    <i className={`adm-dot ${st}`} title={st} />
                  </td>
                  <td>
                    {String(s.pid ?? "–")} <span className="note">{String(s.entry ?? "")}{s.demo ? ", demo" : ""}</span>
                  </td>
                  <td>
                    <span className={`adm-pill ${rec ? "rec" : "dir"}`}>{rec ? "recursive" : "direct"}</span>
                  </td>
                  <td>{step ? BLOCKS.find((b) => b.key === step)!.name : String(s.lastPath ?? "–")}</td>
                  <td>
                    <span className="adm-steps" aria-label={step ? `step ${at + 1} of ${flow.length}` : undefined}>
                      {flow.map((k, i) => (
                        <i key={k} className={i < at || st === "done" ? "done" : i === at ? `now tone-${k}` : ""} title={BLOCKS.find((b) => b.key === k)!.name} />
                      ))}
                    </span>
                  </td>
                  <td>{Math.round((Date.parse(String(s.lastAt)) - Date.parse(String(s.startedAt))) / 60_000)} min</td>
                  <td>{ago(now - Date.parse(String(s.lastAt)))}</td>
                  <td>{String(s.turns ?? 0)}</td>
                  <td>{s.testScore === null || s.testScore === undefined ? "–" : `${s.testScore}/${s.testOf}`}</td>
                  <td>
                    <Link href={`/admin/sessions/${String(s.sid)}`}>open</Link>
                  </td>
                </tr>
              );
            })}
            {recent.length > 60 && (
              <tr>
                <td colSpan={10} className="note">
                  {recent.length - 60} more in the last three hours: see <Link href="/admin/sessions?scope=all&days=7">Sessions</Link>.
                </td>
              </tr>
            )}
            {!recent.length && (
              <tr>
                <td colSpan={10} className="note">
                  Nobody in the last three hours.
                  {last ? (
                    <>
                      {" "}
                      The last activity was {ago(now - Date.parse(String(last.lastAt)))} (<Link href={`/admin/sessions/${String(last.sid)}`}>that session</Link>).
                    </>
                  ) : (
                    " No session has started yet."
                  )}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </section>
    </AdminShell>
  );
}
