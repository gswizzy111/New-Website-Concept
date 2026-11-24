/**
 * True when a Supabase error (or a message from fetchAll, which keeps only
 * the message) says the card tracking update (supabase/migrations/
 * 20261124_card_tracking.sql: locations, card_moves, cards.location_id /
 * located_at, tier_bags.location_id / located_at) or the intake update before
 * it isn't in the database yet. The ship check and Forgotten pages then work
 * without places, and the menu badge falls back to what it can count.
 */
export function isMissingTracking(error: { code?: string; message?: string } | null | undefined): boolean {
  if (!error) return false;
  // 42703 undefined column, 42P01 undefined table, PGRST200 no relationship, PGRST204/205 not in the schema cache
  if (["42703", "42P01", "PGRST200", "PGRST204", "PGRST205"].includes(error.code ?? "")) return true;
  const m = error.message ?? "";
  return /(location_id|located_at|locations|card_moves|tier_bags|bag_id|awaiting_arrival|card_code)/i.test(m)
    && /(does not exist|could not find|schema cache|relationship)/i.test(m);
}

/** What the pages say while the places tables are missing. */
export const PLACES_NOTICE =
  "Card places aren't set up yet (supabase/migrations/20261124_card_tracking.sql isn't applied), so “scanned at Shipping” and “last seen” can't be checked. Done / not done still shows.";
