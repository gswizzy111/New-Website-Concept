import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { refreshBagCompletionForCard } from "@/lib/intake/stages";
import { completeOrderIfAllDone, type OrderAutoComplete } from "@/lib/intake/order-autocomplete";

export type ToggleCardResult =
  | { ok: true; completed: boolean; orderCompletion?: OrderAutoComplete }
  | { ok: false; status: number; error: string };

/**
 * The order page's Done toggle (POST /api/admin/cards/[id]/complete), moved
 * here unchanged so it can be tested: flips cards.completed (and
 * completed_at), refreshes the card's tier bag, and, when the card was just
 * marked done, completes the order if it was the last one
 * (completeOrderIfAllDone; `orderCompletion` is its result). Un-doing a card
 * never changes the order's status. Admin access is checked by the route.
 */
export async function toggleCardCompletion(admin: SupabaseClient, input: { cardId: string; by: string | null }): Promise<ToggleCardResult> {
  const id = input.cardId;

  // Read current value
  const { data: card, error: fetchErr } = await admin
    .from("cards")
    .select("completed, order_id")
    .eq("id", id)
    .single();

  if (fetchErr || !card) {
    console.error("[card complete] fetch error:", fetchErr);
    return { ok: false, status: fetchErr ? 500 : 404, error: fetchErr?.message ?? "Card not found" };
  }

  const newState = !card.completed;

  // Update and read back the actual persisted value
  const { data: updated, error: updateErr } = await admin
    .from("cards")
    .update({ completed: newState, completed_at: newState ? new Date().toISOString() : null })
    .eq("id", id)
    .select("completed")
    .single();

  if (updateErr || !updated) {
    console.error("[card complete] update error:", updateErr);
    return { ok: false, status: 500, error: updateErr?.message ?? "Update failed" };
  }

  await refreshBagCompletionForCard(id, admin); // its tier bag completes or reopens with it

  // The order's last card: the order becomes Completed (once; never undone here)
  if (updated.completed === true && card.order_id) {
    const orderCompletion = await completeOrderIfAllDone(admin, card.order_id as string, input.by);
    return { ok: true, completed: true, orderCompletion };
  }
  return { ok: true, completed: updated.completed as boolean };
}
