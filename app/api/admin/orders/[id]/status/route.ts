import { isAdmin } from "@/lib/admin-auth";
import { setOrderStatus } from "@/lib/order-status";

// The work (order row, status event, emails) lives in lib/order-status.ts so
// receiving marks orders received through the same code.
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!(await isAdmin())) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  const body = await request.json().catch(() => ({}));
  const { status } = body;
  const tracking_number = typeof body.tracking_number === "string" ? body.tracking_number.trim() : "";

  const result = await setOrderStatus({ orderId: id, status, trackingNumber: tracking_number });
  if (!result.ok) return Response.json({ error: result.error }, { status: result.httpStatus });

  return Response.json({ ok: true, ...(result.emailFailed ? { emailFailed: true } : {}), ...(result.notesEmailed ? { notesEmailed: result.notesEmailed } : {}) });
}
