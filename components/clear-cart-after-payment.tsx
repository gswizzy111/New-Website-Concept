"use client";

import { useEffect } from "react";
import { useCart } from "@/lib/cart-context";

/**
 * Empties the kit cart once Stripe has sent the customer back after paying
 * (the shop checkout's success_url carries ?session_id=...). Kit checkout keeps
 * the cart until then, so cancelling on Stripe returns to a full cart.
 *
 * Render it anywhere on the kit order-confirmed page. It renders nothing.
 */
export function ClearCartAfterPayment() {
  const { clearCart } = useCart();

  useEffect(() => {
    if (!new URLSearchParams(window.location.search).get("session_id")) return;
    // Arriving from Stripe is a full page load: this effect runs before the cart
    // provider's own effect reads the saved cart back, so remove the saved copy
    // as well as the items in memory
    try {
      localStorage.removeItem("cart");
    } catch {}
    clearCart();
  }, [clearCart]);

  return null;
}
