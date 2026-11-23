/**
 * Whether an order was paid for, as receiving treats it (orders.payment_status:
 * pending / paid / refunded / failed). Staff once worked on orders whose
 * checkout was never paid, so receiving warns on anything but 'paid' and asks
 * for an explicit confirm, and refuses refunded orders outright.
 */
export type PaymentState = "paid" | "unpaid" | "refunded";

export function paymentState(paymentStatus: string | null | undefined): PaymentState {
  if (paymentStatus === "paid") return "paid";
  if (paymentStatus === "refunded") return "refunded";
  return "unpaid";
}

export const UNPAID_CONFIRM = "This order hasn't been paid. Receive anyway?";
export const REFUNDED_ERROR = "This order was refunded. Cards can't be received on it.";
export const UNPAID_ERROR = "This order hasn't been paid. Confirm to receive anyway.";
