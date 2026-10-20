import Link from "next/link";
import { requireAdmin } from "@/lib/server/admin";
import { eventStore } from "@/lib/server/events";
import { listCodes, loadTables } from "@/lib/server/admindata";
import { followUpOpens, listParticipants } from "@/lib/server/participants";
import { currentStudy } from "@/lib/server/study";
import { otherForm } from "@/lib/server/content";
import AdminShell from "@/components/admin/AdminShell";
import FollowUpManager, { type Person } from "@/components/admin/FollowUpManager";

export const dynamic = "force-dynamic";
export const metadata = { title: "Docendo: follow-up", robots: { index: false, follow: false } };

/**
 * The follow-up test: whether it is on and after how many days it opens, everyone who can take it (a code that names
 * one person: a one-use participant or trial code), where each stands, and opening it early for one person or all.
 */
export default async function Page() {
  await requireAdmin();
  const { settings, pack } = await currentStudy({ fresh: true });
  const [people, codes, t] = await Promise.all([listParticipants(), listCodes(), loadTables()]);
  const label = new Map(codes.map((c) => [c.id, c.label]));
  const now = Date.now();
  const rows: Person[] = people.map((p) => {
    const sessions = t.sessions.filter((s) => s.pid === p.pid);
    const main = sessions.filter((s) => s.phase !== "delayed" && s.testScore !== null && s.testScore !== undefined).pop();
    const late = sessions.filter((s) => s.phase === "delayed" && s.testScore !== null && s.testScore !== undefined).pop();
    const opens = followUpOpens(p, settings.test.followUpDays);
    const status: Person["status"] = !p.testAt ? "first" : p.delayedAt ? "done" : opens !== null && opens <= now ? "open" : "waiting";
    return {
      pid: p.pid,
      label: label.get(p.pid) ?? "",
      trial: !!p.trial,
      cond: p.cond,
      form: p.form,
      followForm: otherForm(p.form),
      testAt: p.testAt ?? null,
      score: main ? `${String(main.testScore)}/${String(main.testOf)}` : null,
      opensAt: opens,
      early: !!p.opensAt,
      doneAt: p.delayedAt ?? null,
      lateScore: late ? `${String(late.testScore)}/${String(late.testOf)}` : null,
      status,
      sid: (main?.sid as string | undefined) ?? null,
      lateSid: (late?.sid as string | undefined) ?? null,
    };
  });

  return (
    <AdminShell store={eventStore}>
      <div className="adm-head">
        <div>
          <h1>Follow-up test</h1>
          <p className="note">
            The other test form, taken again some days after the final test, to see what stays. For codes that name one person (one-use participant and trial codes): the shared code names nobody. People come back with the same code, or on the same device; their results page tells them when.
          </p>
        </div>
      </div>
      <FollowUpManager
        rows={rows}
        on={settings.test.followUp}
        days={settings.test.followUpDays}
        forms={pack.forms.length}
        formSize={pack.formItems("B").length}
        paired={pack.formItems("B").filter((q) => q.pair).length}
      />
      <p className="note">
        To try it yourself: on <Link href="/admin/settings">Study setup</Link>, &quot;Try it as a participant&quot;; take the final test; open it here for that trial code; then go back to the welcome page on the same device (or enter the code again).
      </p>
    </AdminShell>
  );
}
