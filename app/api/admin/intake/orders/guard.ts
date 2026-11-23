import { getAdminSession } from "@/lib/admin-auth";
import { paymentState, REFUNDED_ERROR, UNPAID_ERROR } from "@/app/admin/receiving/_components/payment";

/** Shared checks of the receiving routes (/api/admin/intake/orders/*). */

export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const DAY = /^\d{4}-\d{2}-\d{2}$/;

/** The full admin's username (for received_by and the logs), or a 401 response. */
export async function adminName(): Promise<{ by: string } | { response: Response }> {
  const session = await getAdminSession();
  if (session?.role !== "admin") return { response: Response.json({ error: "Unauthorized" }, { status: 401 }) };
  return { by: session.username ?? "admin" };
}

/** The request body as JSON, or null when it isn't (or is over 20 KB). */
export async function smallJson(req: Request): Promise<unknown> {
  const text = await req.text().catch(() => "");
  if (!text || text.length > 20_000) return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

export function fail(status: number, error: string) {
  return Response.json({ error }, { status });
}

/**
 * Receiving on an order that isn't paid: refunded orders are refused; any
 * other unpaid order (payment_status not 'paid', e.g. a checkout never paid)
 * only with `allowUnpaid: true`, sent after staff confirm. Returns the
 * response to send, or null to go ahead.
 */
export function paymentBlock(paymentStatus: string | null | undefined, allowUnpaid: boolean | undefined): Response | null {
  const state = paymentState(paymentStatus);
  if (state === "refunded") return Response.json({ error: REFUNDED_ERROR, payment: state }, { status: 409 });
  if (state === "unpaid" && allowUnpaid !== true) return Response.json({ error: UNPAID_ERROR, payment: state, unpaid: true }, { status: 409 });
  return null;
}
