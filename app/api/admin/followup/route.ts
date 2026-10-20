import type { NextRequest } from "next/server";
import { z } from "zod";
import { adminFromRequest } from "@/lib/server/admin";
import { fail, ok, readBody, sameOrigin } from "@/lib/server/http";
import { limit } from "@/lib/server/limit";
import { record } from "@/lib/server/events";
import { followUpOpens, listParticipants, setFollowUpOpen } from "@/lib/server/participants";
import { getSettings, saveSettings } from "@/lib/server/settings";
import { settingsProblem } from "@/lib/server/study";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const Pid = z.string().regex(/^[A-Za-z0-9_-]{1,40}$/);
const Body = z.discriminatedUnion("action", [
  // open the follow-up now for these people, or put them back on the schedule
  z.object({ action: z.literal("open"), pids: z.array(Pid).min(1).max(500) }),
  z.object({ action: z.literal("schedule"), pids: z.array(Pid).min(1).max(500) }),
  // everyone whose follow-up is still waiting (participants, trial runs, or both)
  z.object({ action: z.literal("open-waiting"), who: z.enum(["participants", "trials", "all"]) }),
  // the switch and the days (the same setting as on Study setup)
  z.object({ action: z.literal("setting"), followUp: z.boolean(), followUpDays: z.number().min(0).max(60) }),
]);

/** The follow-up test's admin actions: open it early, back to the schedule, or change the setting. */
export async function POST(req: NextRequest) {
  if (!sameOrigin(req)) return fail(403, "Requests from other sites are not allowed.");
  if (!adminFromRequest(req)) return fail(401, "Sign in to the admin panel first.");
  const r = await limit("admin:followup", 60, 60);
  if (!r.ok) return fail(429, "Too many changes in a short time.");
  const body = Body.safeParse(await readBody(req, 30_000));
  if (!body.success) return fail(400, "Bad request.");
  const b = body.data;

  if (b.action === "setting") {
    const { settings } = await getSettings({ fresh: true });
    const next = { ...settings, test: { followUp: b.followUp, followUpDays: b.followUpDays } };
    const problem = settingsProblem(next);
    if (problem) return fail(400, problem);
    const version = await saveSettings(next);
    return ok({ version });
  }

  let pids: string[];
  if (b.action === "open-waiting") {
    const { settings } = await getSettings({ fresh: true });
    const now = Date.now();
    pids = (await listParticipants())
      .filter((p) => (b.who === "all" ? true : b.who === "trials" ? !!p.trial : !p.trial))
      .filter((p) => !p.delayedAt && (followUpOpens(p, settings.test.followUpDays) ?? Infinity) > now && p.testAt)
      .map((p) => p.pid);
  } else pids = b.pids;
  const open = b.action !== "schedule";
  const changed = pids.length ? await setFollowUpOpen(pids, open) : 0;
  record({ t: "followup_admin", sid: "admin", action: b.action, people: changed });
  return ok({ changed });
}
