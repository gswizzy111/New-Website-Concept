import type { SupabaseClient } from "@supabase/supabase-js";
import { normalizeTier } from "@/lib/intake/codes";

/**
 * A card already in a tier bag keeps its tier: the bag's Bag ID, printed label
 * and due date belong to that tier. The admin tier switches
 * (PATCH /api/admin/cards/[id]/tier and /api/admin/orders/[id]/tier) refuse to
 * move a bagged card to another tier and point to the order's Receiving page,
 * where "Mark not received" takes a card out of its bag first (allowed until a
 * work step is recorded for it).
 */

export type BaggedCard = { id: string; card_name: string | null; tier: string | null; bagCode: string };

/** Errors meaning the intake update isn't applied yet (no bag_id column / tier_bags table). */
function missingIntakeSchema(error: { code?: string; message?: string }): boolean {
  if (["42703", "42P01", "PGRST200", "PGRST204", "PGRST205"].includes(error.code ?? "")) return true;
  return /(bag_id|tier_bags)/.test(error.message ?? "") && /(does not exist|could not find|schema cache)/i.test(error.message ?? "");
}

/**
 * The bagged cards of one card or of one order, with their Bag IDs. None
 * before the intake tables exist (nothing can be bagged then).
 */
export async function baggedCards(
  admin: SupabaseClient,
  where: { cardId: string } | { orderId: string },
): Promise<{ ok: true; cards: BaggedCard[] } | { ok: false; error: string }> {
  let query = admin.from("cards").select("id, card_name, tier, bag_id").not("bag_id", "is", null);
  query = "cardId" in where ? query.eq("id", where.cardId) : query.eq("order_id", where.orderId);
  const { data, error } = await query;
  if (error) return missingIntakeSchema(error) ? { ok: true, cards: [] } : { ok: false, error: error.message };
  const rows = (data ?? []) as { id: string; card_name: string | null; tier: string | null; bag_id: string }[];
  if (!rows.length) return { ok: true, cards: [] };
  const { data: bags, error: bagError } = await admin
    .from("tier_bags")
    .select("id, bag_code")
    .in("id", [...new Set(rows.map((c) => c.bag_id))]);
  if (bagError) return { ok: false, error: bagError.message };
  const codes = new Map(((bags ?? []) as { id: string; bag_code: string }[]).map((b) => [b.id, b.bag_code]));
  return {
    ok: true,
    cards: rows.map((c) => ({ id: c.id, card_name: c.card_name, tier: c.tier, bagCode: codes.get(c.bag_id) ?? "a tier bag" })),
  };
}

/**
 * The bagged cards an order's tier change would move to another tier: as in
 * PATCH /api/admin/orders/[id]/tier, cards with no tier of their own follow
 * the order, and so do cards carrying the old order tier or a prep tier.
 */
export function cardsMovedByOrderTier(cards: BaggedCard[], from: string | null, to: string): BaggedCard[] {
  const follows = new Set([from, "prep", "prep_standard"].filter((t): t is string => !!t));
  return cards.filter((c) => {
    const own = c.tier?.trim() ? c.tier : null;
    if (own !== null && !follows.has(own)) return false;
    return normalizeTier(own ?? from) !== normalizeTier(to);
  });
}

/** True when switching this bagged card to `to` changes its effective tier. */
export function cardTierChanges(card: Pick<BaggedCard, "tier">, orderTier: string | null, to: string): boolean {
  const own = card.tier?.trim() ? card.tier : null;
  return normalizeTier(own ?? orderTier) !== normalizeTier(to);
}

/** The refusal shown to staff (409). */
export function tierLockMessage(cards: BaggedCard[]): string {
  const codes = [...new Set(cards.map((c) => c.bagCode))];
  if (cards.length === 1) {
    return `This card is already in bag ${codes[0]}, so its tier can't change here. On this order's Receiving page, use "Mark not received" on the card (possible until a work step is recorded), change its tier there, then receive it again.`;
  }
  return `${cards.length} cards are already in tier bags (${codes.join(", ")}), so their tier can't change here. On this order's Receiving page, use "Mark not received" on those cards (possible until a work step is recorded), change their tier there, then receive them again.`;
}
