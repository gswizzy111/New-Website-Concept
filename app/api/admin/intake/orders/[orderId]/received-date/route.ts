import { z } from "zod";
import { createAdminClient } from "@/lib/supabase/admin";
import { setBagReceivedOn } from "@/lib/intake/due-dates";
import { isMissingSchema } from "@/app/admin/receiving/_components/schema";
import { DAY, UUID, adminName, fail, smallJson } from "../../guard";

/**
 * Enter or correct the day a bag's cards arrived (historical bags flagged
 * "Missing receiving date"); the due date is worked out again from it unless
 * it was set by hand (lib/intake/due-dates.ts setBagReceivedOn).
 *
 * POST { bagId: uuid, receivedOn: "YYYY-MM-DD" }
 * → 200 { ok: true, bag: { id, received_on, due_date, due_status } } | { error }
 */
const Body = z.object({
  bagId: z.string().regex(UUID, "Bag not found"),
  receivedOn: z.string().regex(DAY, "Pick a valid received date."),
});

export async function POST(req: Request, { params }: { params: Promise<{ orderId: string }> }) {
  const who = await adminName();
  if ("response" in who) return who.response;
  const { orderId } = await params;
  if (!UUID.test(orderId)) return fail(404, "Order not found");

  const parsed = Body.safeParse(await smallJson(req));
  if (!parsed.success) return fail(400, parsed.error.issues[0]?.message ?? "Invalid request");

  const admin = createAdminClient();
  const { data: bag, error } = await admin.from("tier_bags").select("id, order_id").eq("id", parsed.data.bagId).maybeSingle();
  if (error) return fail(isMissingSchema(error) ? 503 : 500, isMissingSchema(error) ? "Bags need the intake database update first." : error.message);
  if (!bag || bag.order_id !== orderId) return fail(404, "Bag not found on this order");

  const result = await setBagReceivedOn(admin, { bagId: bag.id, receivedOn: parsed.data.receivedOn, by: who.by });
  if (!result.ok) return fail(result.status, result.error);
  const { id, received_on, due_date, due_status } = result.bag;
  return Response.json({ ok: true, bag: { id, received_on, due_date, due_status } });
}
