import Link from "next/link";
import { requireAdmin } from "@/lib/server/admin";
import { listCodes, loadTables } from "@/lib/server/admindata";
import { eventStore } from "@/lib/server/events";
import { config } from "@/lib/server/env";
import AdminShell from "@/components/admin/AdminShell";
import CodeManager from "@/components/admin/CodeManager";

export const dynamic = "force-dynamic";
export const metadata = { title: "Docendo: access", robots: { index: false, follow: false } };

/**
 * Access: how people get into a session, how each way is counted, and the codes made here. The shared code is only
 * named, never shown (it lives in the server's environment).
 */
export default async function Page() {
  await requireAdmin();
  const codes = await listCodes();
  const t = await loadTables();
  const n = (entry: string) => t.sessions.filter((s) => s.entry === entry && s.phase !== "delayed").length;
  const demo = t.sessions.filter((s) => s.entry === "participant" && s.demo).length;
  const ways = [
    {
      name: "Participant codes",
      on: true,
      how: "Made below, one per person (or with more uses). The code sets the condition: direct, recursive, or random, which draws balanced blocks of 4. No shortcuts. A one-use code names one person, so they can come back for the follow-up test with it.",
      counted: "The study: the Dashboard's default view.",
      sessions: n("participant") - demo,
    },
    {
      name: "Trial runs",
      on: true,
      how: "Made below with \"Counts as: trial run\". Exactly what a participant sees (their condition, no shortcuts, no switch), including the follow-up test with a one-use code. Use these to try the study as a participant.",
      counted: "Team and tests: never in the study's numbers.",
      sessions: n("trial"),
    },
    {
      name: "Team codes",
      on: true,
      how: "Made below with \"Counts as: team\". The test shortcuts and a \"You solve / Kai solves\" switch in practice, to see both conditions in one session.",
      counted: "Team and tests.",
      sessions: t.sessions.filter((s) => s.entry === "team" && s.pid && s.phase !== "delayed" && codes.some((c) => c.id === s.pid)).length,
    },
    {
      name: "The shared code",
      on: !!config.accessCode,
      how: "One code for the whole team, set on the server (ACCESS_CODE in Vercel's environment), not here. Always the direct condition, with the shortcuts and the switch. It names nobody, so there is no follow-up test with it.",
      counted: "Team and tests.",
      sessions: t.sessions.filter((s) => s.entry === "team" && s.phase !== "delayed" && !codes.some((c) => c.id === s.pid)).length,
    },
    {
      name: "Older participant codes",
      on: !!config.codeSecret,
      how: "From pnpm codes (CODE_SECRET on the server): each code carries its own condition. Superseded by the codes made here.",
      counted: "The study.",
      sessions: null,
    },
    {
      name: "No code",
      on: !config.accessCode && !config.codeSecret && !config.adminPassword,
      how: "Only when the server has no code of any kind and no admin password: a developer's machine.",
      counted: "Team and tests.",
      sessions: n("open"),
    },
  ];

  return (
    <AdminShell store={eventStore}>
      <div className="adm-head">
        <div>
          <h1>Access</h1>
          <p className="note">How people get into a session, and how each way is counted. Sessions log a code&apos;s id, never the code. Demo sessions (no model key) always count as tests.</p>
        </div>
      </div>

      <section className="adm-card">
        <h2>Ways in</h2>
        <table className="adm-table adm-ways">
          <thead>
            <tr>
              <th>Way in</th>
              <th>How it works</th>
              <th>Counted as</th>
              <th>Sessions</th>
            </tr>
          </thead>
          <tbody>
            {ways.map((w) => (
              <tr key={w.name} className={w.on ? "" : "off"}>
                <td>
                  <b>{w.name}</b>
                  <span className={`adm-pill${w.on ? " ok" : ""}`}>{w.on ? "on" : "off"}</span>
                </td>
                <td>{w.how}</td>
                <td>{w.counted}</td>
                <td>{w.sessions ?? "–"}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="note">
          Team and trial sessions are under &quot;Team and tests&quot; on the <Link href="/admin?scope=team">Dashboard</Link> and in <Link href="/admin/sessions?scope=team">Sessions</Link>, and always on <Link href="/admin/live">Live</Link>.
        </p>
      </section>

      <CodeManager initial={codes} />
    </AdminShell>
  );
}
