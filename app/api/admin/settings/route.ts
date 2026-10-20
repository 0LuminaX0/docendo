import type { NextRequest } from "next/server";
import { z } from "zod";
import { adminFromRequest } from "@/lib/server/admin";
import { fail, ok, readBody, sameOrigin } from "@/lib/server/http";
import { limit } from "@/lib/server/limit";
import { hasTopic, packFor } from "@/lib/server/content";
import { defaults, getSettings, resetSettings, saveSettings } from "@/lib/server/settings";
import { packSummary, settingsProblem } from "@/lib/server/study";
import { Settings } from "@/lib/settings";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const Body = z.discriminatedUnion("action", [
  z.object({ action: z.literal("check"), settings: Settings }), // what an edit would do to the lesson's help, unsaved
  z.object({ action: z.literal("topic"), topic: z.string().max(40) }), // another topic pack: its defaults and contents
  z.object({ action: z.literal("save"), settings: Settings }),
  z.object({ action: z.literal("reset") }),
]);

/** The study settings (admin only): check an edit, look at another topic, save, or go back to the defaults. */
export async function POST(req: NextRequest) {
  if (!sameOrigin(req)) return fail(403, "Requests from other sites are not allowed.");
  if (!adminFromRequest(req)) return fail(401, "Sign in to the admin panel first.");
  const r = await limit(`admin:settings`, 60, 60);
  if (!r.ok) return fail(429, "Too many changes in a short time.");
  const raw = await readBody(req, 20_000);
  const body = Body.safeParse(raw);
  if (!body.success) {
    const issue = body.error.issues[0];
    return fail(400, issue ? `${issue.path.join(".") || "settings"}: ${issue.message}` : "Bad request.");
  }
  const b = body.data;
  if (b.action === "topic") {
    if (!hasTopic(b.topic)) return fail(404, "No such topic pack.");
    const d = defaults(b.topic);
    return ok({ defaults: d, summary: packSummary(packFor(b.topic), d) });
  }
  if (b.action === "check") return ok({ summary: packSummary(packFor(b.settings.topic), b.settings), problem: settingsProblem(b.settings) });
  if (b.action === "save") {
    const p = settingsProblem(b.settings);
    if (p) return fail(400, p);
  }
  const version = b.action === "save" ? await saveSettings(b.settings) : await resetSettings();
  const now = await getSettings();
  return ok({ version, settings: now.settings, summary: packSummary(packFor(now.settings.topic), now.settings) });
}
