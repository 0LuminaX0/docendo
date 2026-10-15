import { requireAdmin } from "@/lib/server/admin";
import { loadEvents } from "@/lib/server/admindata";
import { eventStore } from "@/lib/server/events";
import { lessonCoverage } from "@/lib/server/moments";
import { defaults, getSettings, versionOf } from "@/lib/server/settings";
import { config } from "@/lib/server/env";
import { FIXED } from "@/lib/settings";
import AdminShell from "@/components/admin/AdminShell";
import SettingsForm from "@/components/admin/SettingsForm";

export const dynamic = "force-dynamic";
export const metadata = { title: "Docendo: settings", robots: { index: false, follow: false } };

export default async function Page() {
  await requireAdmin();
  const { settings, version } = await getSettings();
  const events = await loadEvents();
  const history = events
    .filter((e) => e.t === "settings_change")
    .slice(-12)
    .reverse()
    .map((e) => ({ at: e.at, version: String(e.version ?? ""), changed: (e.changed as string[] | undefined) ?? [], reset: !!e.reset }));
  // how many sessions started under each version (the analysis can compare them)
  const perVersion: Record<string, number> = {};
  for (const e of events) if (e.t === "session_start" && e.settings) perVersion[String(e.settings)] = (perVersion[String(e.settings)] ?? 0) + 1;
  const def = defaults();
  return (
    <AdminShell store={eventStore}>
      <div className="adm-head">
        <div>
          <h1>Settings</h1>
          <p className="note">
            The study&apos;s adjustable settings. A saved change reaches new page loads within seconds; every session logs the version it started
            under ({version} now{perVersion[version] ? `, ${perVersion[version]} sessions so far` : ""}), so sessions under different settings can be told apart.
          </p>
        </div>
      </div>
      <SettingsForm
        initial={settings}
        defaults={def}
        version={version}
        defaultVersion={versionOf(def)}
        coverage={lessonCoverage(settings.lesson)}
        history={history}
        perVersion={perVersion}
        fixed={FIXED.map(([a, b]) => [a, b])}
        demo={config.demo}
      />
    </AdminShell>
  );
}
