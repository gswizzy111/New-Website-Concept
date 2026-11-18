import type { createAdminClient } from "@/lib/supabase/admin";

type Admin = ReturnType<typeof createAdminClient>;

/**
 * Refund requests (supabase/migrations/20261107_refund_requests.sql):
 * customer support asks for a refund on an order and an admin approves or
 * denies it from the Refund Requests tab on /admin. Support never sees
 * amounts: the admin picks the amount, and lib/refunds.ts issues it.
 */
export type RefundScope = "order" | "cards" | "other";
export type RefundRequestStatus = "pending" | "processing" | "approved" | "denied";

export type RefundRequest = {
  id: string;
  order_id: string;
  scope: RefundScope;
  card_ids: string[];
  reason: string;
  requested_by: string;
  status: RefundRequestStatus;
  decided_by: string | null;
  decided_at: string | null;
  decision_note: string | null;
  refunded_cents: number | null;
  last_error: string | null;
  created_at: string;
};

export const OPEN_REFUND_STATUSES: RefundRequestStatus[] = ["pending", "processing"];

export const SCOPE_LABELS: Record<RefundScope, string> = {
  order: "Whole order",
  cards: "Specific cards",
  other: "Something else",
};

export const REQUEST_STATUS_LABELS: Record<RefundRequestStatus, { label: string; cls: string }> = {
  pending: { label: "Waiting for an admin", cls: "bg-amber-100 text-amber-800" },
  processing: { label: "Being refunded", cls: "bg-blue-100 text-blue-700" },
  approved: { label: "Approved, refund issued", cls: "bg-green-100 text-green-700" },
  denied: { label: "Denied", cls: "bg-red-100 text-red-700" },
};

/** Requests waiting on an admin (the /admin tab badge and banner). */
export async function pendingRefundRequestCount(admin: Admin): Promise<number> {
  const { count } = await admin
    .from("refund_requests")
    .select("id", { count: "exact", head: true })
    .eq("status", "pending");
  return count ?? 0;
}

// Emailing admins about a new request lives in lib/refund-request-email.ts,
// so pages that only count requests don't load the Resend SDK.
