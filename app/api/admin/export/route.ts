import { NextResponse, type NextRequest } from "next/server";
import { adminFromRequest } from "@/lib/server/admin";
import { loadTables } from "@/lib/server/admindata";
import { toCsv } from "@/lib/analytics";
import { fail } from "@/lib/server/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const TABLES = ["sessions", "turns", "practice", "test", "video", "feedback"] as const;

/** Download a table as CSV, or every event as JSONL (admin only). The same tables as `pnpm events export`. */
export async function GET(req: NextRequest) {
  if (!adminFromRequest(req)) return fail(401, "Sign in to the admin panel first.");
  const what = req.nextUrl.searchParams.get("table") ?? "sessions";
  const t = await loadTables();
  const stamp = new Date().toISOString().slice(0, 16).replace(/[:T]/g, "-");
  if (what === "events")
    return new NextResponse(t.events.map((e) => JSON.stringify(e)).join("\n") + "\n", {
      headers: { "Content-Type": "application/x-ndjson", "Content-Disposition": `attachment; filename="docendo-events-${stamp}.jsonl"`, "Cache-Control": "no-store" },
    });
  if (!(TABLES as readonly string[]).includes(what)) return fail(400, "Unknown table.");
  const rows = t[what as (typeof TABLES)[number]] as Record<string, unknown>[];
  return new NextResponse(toCsv(rows), { headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="docendo-${what}-${stamp}.csv"`, "Cache-Control": "no-store" } });
}
