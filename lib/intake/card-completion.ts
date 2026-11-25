import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { currentStageOf, refreshBagCompletionForCard } from "@/lib/intake/stages";
import { completeOrderIfAllDone, type OrderAutoComplete } from "@/lib/intake/order-autocomplete";
import { returnCardsToBags } from "@/lib/intake/tracking/bag-places";
import type { TrackBagPlace } from "@/lib/intake/tracking/types";

export type ToggleCardResult =
  | { ok: true; completed: boolean; orderCompletion?: OrderAutoComplete; bagPlaces?: TrackBagPlace[]; unbinned?: TrackBagPlace[] }
  | { ok: false; status: number; error: string };

/**
 * The order page's Done toggle (POST /api/admin/cards/[id]/complete), moved
 * here so it can be tested: flips cards.completed (and completed_at) and
 * refreshes the card's tier bag. When the card was just marked done it ends
 * like every other Done (done flow, Nov 25 2026): the card goes back in its
 * bag, out of any holder or desk (returnCardsToBags: location null, the slot
 * frees up, a card_moves 'done' row; `bagPlaces` says where the bag is), and
 * the order completes if it was the last card (completeOrderIfAllDone;
 * `orderCompletion` is its result). Un-doing a card never changes the
 * order's status or the card's place; its bag reopens, and a bag in the
 * Ready to ship bin goes back in the Open bags box (`unbinned`: "Take
 * REYES's bag out of the Ready to ship bin"). Admin access is checked by the route.
 */
export async function toggleCardCompletion(admin: SupabaseClient, input: { cardId: string; by: string | null }): Promise<ToggleCardResult> {
  const id = input.cardId;

  // Read current value
  const { data: card, error: fetchErr } = await admin
    .from("cards")
    .select("completed, order_id, current_round")
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

  // Its tier bag completes or reopens with it (reopened: out of the Ready to ship bin)
  const { unbinned } = await refreshBagCompletionForCard(id, admin, input.by);

  if (updated.completed === true && card.order_id) {
    const orderId = card.order_id as string;
    // Back in its bag, out of any holder or desk (as the Scan page, Desk and step picker Done)
    const stageBefore = await currentStageOf(admin, { orderId, cardId: id, round: (card.current_round as number | null) ?? null });
    const home = await returnCardsToBags(admin, { cards: [{ id, stageBefore }], by: input.by });
    // The order's last card: the order becomes Completed (once; never undone here)
    const orderCompletion = await completeOrderIfAllDone(admin, orderId, input.by);
    if (!home.ok) return { ok: false, status: home.status, error: `Marked done, but not put back in the bag: ${home.error}` };
    return { ok: true, completed: true, orderCompletion, ...(home.bags.length ? { bagPlaces: home.bags } : {}) };
  }
  return { ok: true, completed: updated.completed as boolean, ...(unbinned.length ? { unbinned } : {}) };
}
