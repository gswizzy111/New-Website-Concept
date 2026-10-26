"use client";

import { useEffect } from "react";
import { useCart } from "@/lib/cart-context";

// Set once this page load has emptied the cart. Next.js reuses the confirmation
// page on Back/Forward, so without it, going back to the page after adding new
// items would empty the cart again. A new payment always comes back from Stripe
// as a full page load, which starts this at false again.
let clearedThisLoad = false;

/**
 * Empties the kit cart once the customer has paid. Kit checkout keeps the
 * cart until then, so cancelling on Stripe returns to a full cart.
 *
 * Render it on the kit order-confirmed page with `paid` decided on the server:
 * the page reads Stripe's session_id there, because the page's first script
 * takes it out of the address before anything else runs (lib/tracking-guard.ts).
 * It renders nothing.
 */
export function ClearCartAfterPayment({ paid }: { paid: boolean }) {
  const { clearCart } = useCart();

  useEffect(() => {
    if (!paid || clearedThisLoad) return;
    clearedThisLoad = true;
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
