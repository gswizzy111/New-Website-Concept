"use client";

import { useEffect } from "react";
import { fbq } from "@/lib/pixel";

/** True the first time this browser asks about `key`; false after that. */
function firstTime(key: string): boolean {
  for (const store of [() => window.localStorage, () => window.sessionStorage]) {
    try {
      const s = store();
      if (s.getItem(key)) return false;
      s.setItem(key, "1");
      return true;
    } catch {
      // Storage blocked (private browsing etc.): try the next one
    }
  }
  // No storage at all: fire anyway, once per page load
  return true;
}

/**
 * Meta "Purchase" for a paid Stripe checkout, sent once per checkout session:
 * a reload, a second tab or the back button never counts it again. The
 * session ID is only the local key for that; it is never sent to Meta.
 */
export function PurchasePixel({
  sessionId,
  amountCents,
  currency = "usd",
  orderId,
}: {
  sessionId?: string;
  amountCents: number | null;
  currency?: string;
  orderId?: string;
}) {
  useEffect(() => {
    if (!sessionId || amountCents === null) return;
    if (!firstTime(`meta_px_${sessionId}`)) return;
    fbq("track", "Purchase", {
      value: amountCents / 100,
      currency: currency.toUpperCase(),
      ...(orderId ? { order_id: orderId } : {}),
    });
  }, [sessionId, amountCents, currency, orderId]);

  return null;
}
