import type { NextRequest } from "next/server";
import { z } from "zod";
import { adminFromRequest } from "@/lib/server/admin";
import { createCodes, deleteCode, updateCode } from "@/lib/server/admindata";
import { fail, ok, readBody, sameOrigin } from "@/lib/server/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const Condition = z.enum(["direct", "recursive", "random"]);
const Body = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("create"),
    count: z.number().int().min(1).max(200),
    prefix: z.string().max(20).default(""),
    label: z.string().max(60).default(""),
    condition: Condition,
    team: z.boolean().default(false),
    maxUses: z.number().int().min(1).max(10_000).nullable().default(1),
  }),
  z.object({
    action: z.literal("update"),
    code: z.string().min(4).max(40),
    active: z.boolean().optional(),
    label: z.string().max(60).optional(),
    condition: Condition.optional(),
    team: z.boolean().optional(),
    maxUses: z.number().int().min(1).max(10_000).nullable().optional(),
  }),
  z.object({ action: z.literal("delete"), code: z.string().min(4).max(40) }),
]);

/** Make, change and delete access codes (admin only). */
export async function POST(req: NextRequest) {
  if (!sameOrigin(req)) return fail(403, "Requests from other sites are not allowed.");
  if (!adminFromRequest(req)) return fail(401, "Sign in to the admin panel first.");
  const body = Body.safeParse(await readBody(req, 4_000));
  if (!body.success) return fail(400, "Bad request.");
  const b = body.data;
  if (b.action === "create") return ok({ codes: await createCodes(b) });
  if (b.action === "update") {
    const { action: _a, code, ...patch } = b;
    const c = await updateCode(code, patch);
    return c ? ok({ code: c }) : fail(404, "No such code.");
  }
  return (await deleteCode(b.code)) ? ok({ ok: true }) : fail(404, "No such code.");
}
