"use client";

import { useEffect } from "react";
import { useCart } from "@/lib/cart-context";

/**
 * Empties the kit cart once Stripe has sent the customer back after paying
 * (the shop checkout's success_url carries ?session_id=...). Kit checkout keeps
 * the cart until then, so cancelling on Stripe returns to a full cart.
 *
 * Render it anywhere on the kit order-confirmed page. It renders nothing.
 * `paid`, when given, decides instead of the address: the page's first script
 * takes session_id out of the address before analytics run
 * (lib/tracking-guard.ts), so the page passes what the server read.
 */
export function ClearCartAfterPayment({ paid }: { paid?: boolean } = {}) {
  const { clearCart } = useCart();

  useEffect(() => {
    const fromStripe = paid ?? !!new URLSearchParams(window.location.search).get("session_id");
    if (!fromStripe) return;
    // Arriving from Stripe is a full page load: this effect runs before the cart
    // provider's own effect reads the saved cart back, so remove the saved copy
    // as well as the items in memory
    try {
      localStorage.removeItem("cart");
    } catch {}
    clearCart();
  }, [clearCart, paid]);

  return null;
}
