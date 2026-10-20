import Link from "next/link";
import { requireAdmin } from "@/lib/server/admin";
import { eventStore } from "@/lib/server/events";
import { loadEvents } from "@/lib/server/admindata";
import { config } from "@/lib/server/env";
import { currentStudy } from "@/lib/server/study";
import AdminShell from "@/components/admin/AdminShell";

export const dynamic = "force-dynamic";
export const metadata = { title: "Docendo: health and cost", robots: { index: false, follow: false } };

type Call = { role: string; model: string; ms: number; usage?: { promptTokens?: number; completionTokens?: number; costUsd?: number } };
const DAYS = 14;
const ROLE_NAME: Record<string, string> = { judge: "Judge (reads the learner)", writer: "Writer (Kai's replies)", solver: "Solver (Kai's practice)", transcribe: "Voice input, final pass", "transcribe-live": "Voice input, live", "writer-rewrite": "Writer, rewrite after a blocked word" };
const usd = (v: number) => `$${v < 1 ? v.toFixed(3) : v.toFixed(2)}`;
const quantile = (xs: number[], q: number) => {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor(q * s.length))]!;
};
const sec = (ms: number | null) => (ms === null ? "–" : `${(ms / 1000).toFixed(1)} s`);

/**
 * How the system runs, every session counted (the model bill doesn't care who used it): model calls, speed and cost
 * per role and per day, today's use of the daily budget, and what went wrong (errors, offline fallbacks, blocked lesson
 * words, rate limits). The last two weeks.
 */
export default async function Page() {
  await requireAdmin();
  const events = await loadEvents();
  const { settings } = await currentStudy({ fresh: true });
  const since = Date.now() - DAYS * 86_400_000;
  const recent = events.filter((e) => Date.parse(e.at) >= since);
  const calls: (Call & { at: string })[] = recent.flatMap((e) => ((e.llm as Call[] | undefined) ?? []).map((c) => ({ ...c, at: e.at })));

  // per role
  const roles = [...new Set(calls.map((c) => c.role))].sort();
  const byRole = roles.map((r) => {
    const cs = calls.filter((c) => c.role === r);
    return {
      role: r,
      models: [...new Set(cs.map((c) => c.model))].join(", "),
      n: cs.length,
      p50: quantile(cs.map((c) => c.ms), 0.5),
      p90: quantile(cs.map((c) => c.ms), 0.9),
      cost: cs.reduce((a, c) => a + (c.usage?.costUsd ?? 0), 0),
      tokens: cs.reduce((a, c) => a + (c.usage?.promptTokens ?? 0) + (c.usage?.completionTokens ?? 0), 0),
    };
  });
  const totalCost = byRole.reduce((a, r) => a + r.cost, 0);

  // per day
  const day = (iso: string) => iso.slice(0, 10);
  const days = Array.from({ length: DAYS }, (_, i) => new Date(Date.now() - (DAYS - 1 - i) * 86_400_000).toISOString().slice(0, 10));
  const perDay = days.map((d) => {
    const cs = calls.filter((c) => day(c.at) === d);
    return { d, calls: cs.length, cost: cs.reduce((a, c) => a + (c.usage?.costUsd ?? 0), 0), sessions: recent.filter((e) => e.t === "session_start" && day(e.at) === d).length };
  });
  const maxCost = Math.max(0.001, ...perDay.map((p) => p.cost));

  // what went wrong
  // demo sessions (no model key) answer offline by design: what went wrong counts real sessions only
  const demoSids = new Set(recent.filter((e) => e.t === "session_start" && e.demo).map((e) => e.sid));
  const real = recent.filter((e) => !demoSids.has(e.sid));
  const count = (f: (e: (typeof recent)[number]) => boolean) => real.filter(f).length;
  const problems = [
    ["Chat turns that failed (the learner had to resend)", count((e) => e.t === "chat_error")],
    ["Chat turns answered offline (model out of credits)", count((e) => e.t === "chat_turn" && ((e.degraded as unknown[]) ?? []).length > 0)],
    ["Kai's practice attempts made offline", count((e) => (e.t === "practice_kai_solve" || e.t === "practice_kai_reteach") && e.by === "offline")],
    ["Kai's replies with a lesson word the learner hadn't used (rewritten)", count((e) => e.t === "chat_turn" && ((e.leaked as unknown[]) ?? []).length > 0)],
    ["Kai's replies replaced by a fallback line", count((e) => e.t === "chat_turn" && !!e.fallback)],
    ["Judge verdicts dropped (quote not in the message)", real.filter((e) => e.t === "chat_turn").reduce((a, e) => a + ((e.dropped as unknown[]) ?? []).length, 0)],
    ["Voice transcripts dropped as made up", count((e) => e.t === "voice_rejected")],
    ["Voice errors", count((e) => e.t === "voice_error")],
    ["Rate limits hit (chat, practice, voice)", count((e) => e.t === "chat_limited" || e.t === "practice_limited" || e.t === "voice_limited")],
  ] as const;
  const errors = recent
    .filter((e) => e.t === "chat_error" || e.t === "voice_error" || ((e.t === "practice_kai_solve" || e.t === "practice_kai_reteach") && e.error))
    .slice(-12)
    .reverse();

  // today's use of the daily budget (chat turns, Kai's attempts and voice passes count against it)
  const todayKey = new Date().toISOString().slice(0, 10);
  const usedToday = recent.filter((e) => day(e.at) === todayKey && (e.t === "chat_turn" || e.t === "practice_kai_solve" || e.t === "practice_kai_reteach" || e.t === "voice")).length;

  return (
    <AdminShell store={eventStore}>
      <div className="adm-head">
        <div>
          <h1>Health and cost</h1>
          <p className="note">The last {DAYS} days, every session (tests too: they cost the same). {config.demo ? "This server runs in demo mode: no model calls." : ""}</p>
        </div>
      </div>

      <section className="adm-kpis">
        <div>
          <b>{usd(totalCost)}</b>
          <span>model cost, {DAYS} days</span>
        </div>
        <div>
          <b>{calls.length}</b>
          <span>model calls</span>
        </div>
        <div className={usedToday > settings.dailyTurnLimit * 0.8 ? "warn" : ""}>
          <b>
            {usedToday} / {settings.dailyTurnLimit}
          </b>
          <span>of today&apos;s budget (UTC day; Study setup)</span>
        </div>
        <div className={errors.length ? "warn" : ""}>
          <b>{problems[0][1] + problems[7][1]}</b>
          <span>failed requests</span>
        </div>
      </section>

      <div className="adm-two">
        <div className="adm-stack">
          <section className="adm-card">
            <h2>Per role</h2>
            <p className="note">Speed is the model call alone (median and the slowest tenth). A chat turn is a judge call and a writer call.</p>
            <table className="adm-table">
              <thead>
                <tr>
                  <th>Role</th>
                  <th>Calls</th>
                  <th>Median</th>
                  <th>90%</th>
                  <th>Cost</th>
                </tr>
              </thead>
              <tbody>
                {byRole.map((r) => (
                  <tr key={r.role}>
                    <td className="wrap">
                      {ROLE_NAME[r.role] ?? r.role}
                      <span className="note cnt-model">{r.models}</span>
                    </td>
                    <td>{r.n}</td>
                    <td>{sec(r.p50)}</td>
                    <td className={r.p90 !== null && r.p90 > 10_000 ? "warn-text" : ""}>{sec(r.p90)}</td>
                    <td>{usd(r.cost)}</td>
                  </tr>
                ))}
                {!byRole.length && (
                  <tr>
                    <td colSpan={5} className="note">
                      No model calls in this period.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </section>
          <section className="adm-card">
            <h2>What went wrong</h2>
          <p className="note">Sessions with the model connected; demo sessions answer offline by design.</p>
            <ul className="adm-flags">
              {problems.map(([label, n]) => (
                <li key={label} className={n ? "on" : ""}>
                  <b>{n}</b>
                  <span>{label}</span>
                </li>
              ))}
            </ul>
          </section>
        </div>
        <div className="adm-stack">
          <section className="adm-card">
            <h2>Per day</h2>
            <p className="note">Model cost, calls and sessions started, per UTC day.</p>
            <table className="adm-table hc-days">
              <thead>
                <tr>
                  <th>Day</th>
                  <th></th>
                  <th>Cost</th>
                  <th>Calls</th>
                  <th>Sessions</th>
                </tr>
              </thead>
              <tbody>
                {perDay.map((p) => (
                  <tr key={p.d} className={p.calls || p.sessions ? "" : "off"}>
                    <td>
                      {p.d.slice(8)}.{p.d.slice(5, 7)}
                    </td>
                    <td className="hc-bar">
                      <span className="adm-bar">
                        <i style={{ width: `${(p.cost / maxCost) * 100}%` }} />
                      </span>
                    </td>
                    <td>{p.cost ? usd(p.cost) : "–"}</td>
                    <td>{p.calls || "–"}</td>
                    <td>{p.sessions || "–"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
          <section className="adm-card">
            <h2>Latest errors</h2>
            {errors.length ? (
              <ul className="adm-errors">
                {errors.map((e, i) => (
                  <li key={i}>
                    <span className="note">
                      {e.at.slice(5, 16).replace("T", " ")} UTC, {e.t.replace(/_/g, " ")}
                    </span>
                    <code>{String(e.error ?? "").slice(0, 200)}</code>
                    <Link className="note" href={`/admin/sessions/${e.sid}`}>
                      session
                    </Link>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="note">None in the last {DAYS} days.</p>
            )}
          </section>
        </div>
      </div>
    </AdminShell>
  );
}
