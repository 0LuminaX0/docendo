import type { NextRequest } from "next/server";
import { z } from "zod";
import { adminFromRequest } from "@/lib/server/admin";
import { fail, ok, readBody, sameOrigin } from "@/lib/server/http";
import { limit } from "@/lib/server/limit";
import { lessonCoverage } from "@/lib/server/moments";
import { getSettings, resetSettings, saveSettings } from "@/lib/server/settings";
import { Settings } from "@/lib/settings";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const Body = z.discriminatedUnion("action", [
  z.object({ action: z.literal("check"), settings: Settings }), // what an edit would do to the lesson's help, unsaved
  z.object({ action: z.literal("save"), settings: Settings }),
  z.object({ action: z.literal("reset") }),
]);

/** The study settings (admin only): check an edit, save it, or go back to the defaults. */
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
  if (b.action === "check") return ok({ coverage: lessonCoverage(b.settings.lesson) });
  const version = b.action === "save" ? await saveSettings(b.settings) : await resetSettings();
  const now = await getSettings();
  return ok({ version, settings: now.settings, coverage: lessonCoverage(now.settings.lesson) });
}
