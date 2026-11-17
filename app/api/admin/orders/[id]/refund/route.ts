import { createAdminClient } from "@/lib/supabase/admin";
import { z } from "zod";
import { getAdminSession } from "@/lib/admin-auth";
import { refundOrder } from "@/lib/refunds";

const Body = z.object({
  amountCents: z.number().int().min(1).optional(),
  reason: z.string().max(500).optional(),
  sendEmail: z.boolean().optional(),
  customerMessage: z.string().max(1000).optional(),
  // One per click of Confirm Refund, so a retried request can't refund twice
  requestId: z.string().regex(/^[A-Za-z0-9-]{8,64}$/).optional(),
});

// The order page's Refund button (lib/refunds.ts does the refund)
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const adminSession = await getAdminSession();
  if (adminSession?.role !== "admin") {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  const body = await request.json().catch(() => ({}));
  const parsed = Body.safeParse(body);
  if (!parsed.success) return Response.json({ error: "Invalid data" }, { status: 400 });

  const result = await refundOrder(createAdminClient(), id, parsed.data, adminSession.username);
  if (!result.ok) {
    return Response.json({
      error: result.error,
      ...(result.partial ? { partial: true, amountCents: result.partial.amountCents } : {}),
    }, { status: result.status });
  }
  return Response.json({
    ok: true,
    refundId: result.refundId,
    amountCents: result.amountCents,
    newRefundedCents: result.newRefundedCents,
    isFullRefund: result.isFullRefund,
    ...(result.emailFailed ? { emailFailed: true } : {}),
  });
}
