import { requireAdmin } from "@/lib/server/admin";
import { loadEvents } from "@/lib/server/admindata";
import { eventStore } from "@/lib/server/events";
import { defaults, versionOf } from "@/lib/server/settings";
import { currentStudy, packSummary, topicList } from "@/lib/server/study";
import { config } from "@/lib/server/env";
import AdminShell from "@/components/admin/AdminShell";
import SettingsForm from "@/components/admin/SettingsForm";

export const dynamic = "force-dynamic";
export const metadata = { title: "Docendo: study setup", robots: { index: false, follow: false } };

export default async function Page() {
  await requireAdmin();
  const { settings, version, pack } = await currentStudy({ fresh: true });
  const events = await loadEvents();
  // the latest changes, newest first; the same save repeated in a row (a test, a double click) is one line with a count
  const history: { at: string; version: string; changed: string[]; reset: boolean; times: number }[] = [];
  for (const e of events.filter((e) => e.t === "settings_change").reverse()) {
    const h = { at: e.at, version: String(e.version ?? ""), changed: (e.changed as string[] | undefined) ?? [], reset: !!e.reset, times: 1 };
    const prev = history.at(-1);
    if (prev && prev.version === h.version && prev.reset === h.reset && prev.changed.join() === h.changed.join()) prev.times++;
    else if (history.length < 10) history.push(h);
    else break;
  }
  // how many sessions started under each version (the analysis can compare them)
  const perVersion: Record<string, number> = {};
  for (const e of events) if (e.t === "session_start" && e.settings) perVersion[String(e.settings)] = (perVersion[String(e.settings)] ?? 0) + 1;
  const def = defaults(settings.topic);
  return (
    <AdminShell store={eventStore}>
      <div className="adm-head">
        <div>
          <h1>Study setup</h1>
          <p className="note">
            A study is a topic pack and the steps around it. A saved change reaches new page loads within seconds; every session logs the version it started under (
            <code>{version}</code> now{perVersion[version] ? `, ${perVersion[version]} sessions so far` : ""}), so sessions under different setups can be told apart.
          </p>
        </div>
      </div>
      <SettingsForm
        initial={settings}
        defaults={def}
        summary={packSummary(pack, settings)}
        topics={topicList()}
        version={version}
        defaultVersion={versionOf(def)}
        history={history}
        perVersion={perVersion}
        demo={config.demo}
      />
    </AdminShell>
  );
}
