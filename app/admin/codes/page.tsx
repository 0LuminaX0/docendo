import { requireAdmin } from "@/lib/server/admin";
import { listCodes } from "@/lib/server/admindata";
import { eventStore } from "@/lib/server/events";
import { config } from "@/lib/server/env";
import AdminShell from "@/components/admin/AdminShell";
import CodeManager from "@/components/admin/CodeManager";

export const dynamic = "force-dynamic";
export const metadata = { title: "Docendo: access codes", robots: { index: false, follow: false } };

export default async function Page() {
  await requireAdmin();
  const codes = await listCodes();
  return (
    <AdminShell store={eventStore}>
      <div className="adm-head">
        <div>
          <h1>Access codes</h1>
          <p className="note">
            Each code opens one session (or more, if you allow it) and sets its condition. Random alternates between direct and recursive on each use, so the groups stay balanced. Team codes turn on the test shortcuts and the condition switch. Sessions log a code&apos;s id, never the code.
            {config.accessCode ? " The shared code from ACCESS_CODE also still works." : ""}
          </p>
        </div>
      </div>
      <CodeManager initial={codes} />
    </AdminShell>
  );
}
