import { NextResponse, type NextRequest } from "next/server";
import { adminFromRequest } from "@/lib/server/admin";
import { loadTables } from "@/lib/server/admindata";
import { toCsv } from "@/lib/analytics";
import { fail } from "@/lib/server/http";
import { currentStudy } from "@/lib/server/study";
import { packFor } from "@/lib/server/content";
import { answerText, practisedOf, surveyQuestions } from "@/lib/server/survey";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// reasons: the post-test's written reasons, shuffled, with each item's rubric and an empty score column, to score
// without seeing who wrote them (the test table's ref joins the scores back); survey: one row per answer to the
// questions after the test, with the question's words and the answer in words beside its raw value
const TABLES = ["sessions", "turns", "practice", "test", "video", "feedback", "reasons", "survey"] as const;

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
  let rows = t[what as (typeof TABLES)[number]] as Record<string, unknown>[];
  if (what === "reasons") {
    const { pack } = await currentStudy();
    const item = (id: unknown) => pack.exercises.find((q) => q.id === id);
    rows = rows.map((r) => ({ ref: r.ref, item: r.item, form: r.form, question: item(r.item)?.title ?? "", rubric: item(r.item)?.rubric ?? "", chosen: r.chosen, reason: r.reason, score: "" }));
  }
  if (what === "survey")
    rows = rows.map((r) => {
      const q = surveyQuestions(packFor(String(r.topic ?? ""))).find((x) => x.id === r.question);
      return { ...r, practised: practisedOf(r), kind: q?.kind ?? null, prompt: q?.prompt ?? null, answerText: answerText(q, r.answer), retired: q?.until ?? null };
    });
  return new NextResponse(toCsv(rows), { headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="docendo-${what}-${stamp}.csv"`, "Cache-Control": "no-store" } });
}
