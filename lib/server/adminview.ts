import "server-only";
import { inScope, scopeOf, type Scope } from "../analytics";
import { loadTables } from "./admindata";

// The admin pages' common filter, from the URL: whose sessions (participants, the team's and test sessions, or all),
// which period (the last 7 or 30 days, or everything) and which topic pack. Practice and test rows follow their
// sessions. Every page that counts sessions reads it the same way, so their numbers agree.

export type View = { scope: Scope; days: number | null; topic: string | null };
export const PERIODS = [7, 30, null] as const;

export function viewOf(q: { scope?: string; days?: string; topic?: string; all?: string }): View {
  const days = q.days === "7" || q.days === "30" ? Number(q.days) : null;
  return { scope: q.all === "1" ? "all" : scopeOf(q.scope), days, topic: q.topic && /^[a-z0-9-]{1,40}$/.test(q.topic) ? q.topic : null };
}

/** The URL for the same view with some parts changed (defaults left out, so links stay short). */
export function viewHref(path: string, v: View, patch: Partial<View> = {}, extra: Record<string, string | undefined> = {}) {
  const n = { ...v, ...patch };
  const p = new URLSearchParams();
  if (n.scope !== "participants") p.set("scope", n.scope);
  if (n.days) p.set("days", String(n.days));
  if (n.topic) p.set("topic", n.topic);
  for (const [k, val] of Object.entries(extra)) if (val) p.set(k, val);
  const s = p.toString();
  return s ? `${path}?${s}` : path;
}

/** The research tables, cut to the view. `all` is kept: the counts before the cut, for "n of m" notes. */
export async function viewTables(v: View) {
  const t = await loadTables();
  const since = v.days ? Date.now() - v.days * 86_400_000 : null;
  const sessions = t.sessions.filter((s) => inScope(s, v.scope) && (!since || Date.parse(String(s.startedAt)) >= since) && (!v.topic || s.topic === v.topic));
  const sids = new Set(sessions.map((s) => s.sid));
  const keep = <T extends { sid?: unknown }>(rows: T[]) => rows.filter((r) => sids.has(r.sid as string));
  return {
    ...t,
    sessions,
    turns: keep(t.turns),
    practice: keep(t.practice),
    test: keep(t.test),
    video: keep(t.video),
    feedback: keep(t.feedback),
    events: t.events.filter((e) => sids.has(e.sid)),
    allSessions: t.sessions,
  };
}
