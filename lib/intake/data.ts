import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { fetchAll } from "@/lib/fetch-all";
import { normalizeCode } from "@/lib/intake/codes";
import { BAG_COLUMNS } from "@/lib/intake/due-dates";
import { bagCompletionPatch } from "@/lib/intake/stage-plan";
import { buildOrderIntake } from "@/lib/intake/views";
import type {
  BagSummary, IntakeCard, IntakeCardRow, IntakeOrder, IntakeOrderRow, IntakeResult, OrderIntake,
  StageEventRow, TierBagDueChange, TierBagRow,
} from "@/lib/intake/types";

/**
 * Everything the receiving pages show, read with the server's admin client
 * (lib/supabase/admin.ts). Admin access is checked by the page or route.
 * Each loader returns { ok: false, status, error } instead of throwing: 404
 * when the order, bag or card doesn't exist, 500 otherwise (the message names
 * the missing table/column when the intake migration isn't applied yet).
 *
 * Bag completion heals itself here: a bag whose cards were ticked done (or
 * reopened) somewhere that doesn't refresh bags (the old site, the
 * ship-marks-cards-done trigger) gets completed_at set or cleared on load.
 */

export const CARD_COLUMNS =
  "id, order_id, card_name, card_set, card_year, card_number, variation, notes, photo_urls, catalog_image_url, tier, status, completed, completed_at, current_round, created_at, card_seq, card_code, bag_id, received_at, received_by, awaiting_arrival, receiving_photo_urls";
export const ORDER_COLUMNS =
  "id, order_number, customer_name, customer_email, customer_phone, status, payment_status, restoration_tier, inbound_method, customer_notes, created_at";
/** The order_events the receiving pages read (stage history, rounds, the historical received day). */
export const INTAKE_EVENT_TYPES = ["stage_update", "round_started", "status_updated", "manual_order_created"];

/** restoration_settings display names by tier ("premium" -> "Gold"). */
export async function loadTierNames(admin: SupabaseClient): Promise<Record<string, string>> {
  const { data } = await admin.from("restoration_settings").select("tier, display_name");
  return Object.fromEntries((data ?? []).filter((r) => r.display_name).map((r) => [r.tier as string, r.display_name as string]));
}

type Loaded = { order: IntakeOrderRow; cards: IntakeCardRow[]; bags: TierBagRow[]; events: StageEventRow[]; tierNames: Record<string, string> };

async function loadOrderRows(admin: SupabaseClient, orderId: string): Promise<IntakeResult<{ rows: Loaded }>> {
  try {
    const [{ data: order, error: oErr }, cards, { data: bags, error: bErr }, events, tierNames] = await Promise.all([
      admin.from("orders").select(ORDER_COLUMNS).eq("id", orderId).maybeSingle(),
      fetchAll((from, to) => admin.from("cards").select(CARD_COLUMNS).eq("order_id", orderId).order("created_at").order("id").range(from, to)),
      admin.from("tier_bags").select(BAG_COLUMNS).eq("order_id", orderId),
      fetchAll((from, to) => admin.from("order_events").select("event_type, description, metadata, created_at").eq("order_id", orderId)
        .in("event_type", INTAKE_EVENT_TYPES).order("created_at", { ascending: false }).order("id", { ascending: false }).range(from, to)),
      loadTierNames(admin),
    ]);
    const err = oErr ?? bErr;
    if (err) return { ok: false, status: 500, error: err.message };
    if (!order) return { ok: false, status: 404, error: "Order not found" };
    return {
      ok: true,
      rows: {
        order: order as IntakeOrderRow,
        cards: cards as IntakeCardRow[],
        bags: (bags ?? []) as TierBagRow[],
        events: events as StageEventRow[],
        tierNames,
      },
    };
  } catch (e) {
    return { ok: false, status: 500, error: e instanceof Error ? e.message : String(e) };
  }
}

/** Set or clear completed_at on bags whose cards changed elsewhere (best effort; never fails the load). */
async function healBags(admin: SupabaseClient, rows: Loaded): Promise<void> {
  const now = new Date().toISOString();
  for (const bag of rows.bags) {
    const patch = bagCompletionPatch(bag, rows.cards.filter((c) => c.bag_id === bag.id), now, rows.order.status);
    if (!patch) continue;
    try {
      const q = admin.from("tier_bags").update(patch).eq("id", bag.id);
      const { data, error } = await (patch.completed_at ? q.is("completed_at", null) : q).select(BAG_COLUMNS);
      if (error) throw new Error(error.message);
      if (data?.[0]) Object.assign(bag, data[0]);
    } catch (e) {
      // Preview mode refuses writes; the page still shows the computed state (BagSummary.complete)
      console.warn("[intake] bag completion not healed:", e instanceof Error ? e.message : e);
    }
  }
}

/**
 * The order receiving workspace: the order, its cards (by card number; with
 * effective tier, photos, codes, stage state, bag, flags), its bags (counts,
 * due date, completion, stages-differ) and the order's receiving / completion
 * status. Cards without a Card ID yet have code null (receiveCards and
 * ensureCardCodes assign them).
 */
export async function loadOrderIntake(
  admin: SupabaseClient,
  orderId: string,
  opts: { heal?: boolean } = {},
): Promise<IntakeResult<{ intake: OrderIntake }>> {
  const loaded = await loadOrderRows(admin, orderId);
  if (!loaded.ok) return loaded;
  if (opts.heal ?? true) await healBags(admin, loaded.rows);
  return { ok: true, intake: buildOrderIntake(loaded.rows) };
}

/** A bag's page: the bag, its order, its cards (non-refunded first by card number) and the due date change log. */
export async function loadBag(
  admin: SupabaseClient,
  bagId: string,
): Promise<IntakeResult<{ bag: BagSummary; order: IntakeOrder; cards: IntakeCard[]; dueChanges: TierBagDueChange[] }>> {
  const { data: row, error } = await admin.from("tier_bags").select("order_id").eq("id", bagId).maybeSingle();
  if (error) return { ok: false, status: 500, error: error.message };
  if (!row) return { ok: false, status: 404, error: "Bag not found" };
  const [loaded, { data: changes, error: chErr }] = await Promise.all([
    loadOrderIntake(admin, row.order_id as string),
    admin.from("tier_bag_due_changes").select("id, bag_id, old_due, new_due, reason, changed_by, created_at").eq("bag_id", bagId).order("created_at", { ascending: false }),
  ]);
  if (!loaded.ok) return loaded;
  if (chErr) return { ok: false, status: 500, error: chErr.message };
  const bag = loaded.intake.bags.find((b) => b.id === bagId);
  if (!bag) return { ok: false, status: 404, error: "Bag not found" };
  const cards = loaded.intake.cards.filter((c) => c.bagId === bagId).sort((a, b) => Number(a.refunded) - Number(b.refunded));
  return { ok: true, bag, order: loaded.intake.order, cards, dueChanges: (changes ?? []) as TierBagDueChange[] };
}

/** A card's page: the card (photos, codes, stage state and history), its order and its bag. */
export async function loadCard(
  admin: SupabaseClient,
  cardId: string,
): Promise<IntakeResult<{ card: IntakeCard; order: IntakeOrder; bag: BagSummary | null }>> {
  const { data: row, error } = await admin.from("cards").select("order_id").eq("id", cardId).maybeSingle();
  if (error) return { ok: false, status: 500, error: error.message };
  if (!row?.order_id) return { ok: false, status: 404, error: "Card not found" };
  const loaded = await loadOrderIntake(admin, row.order_id as string);
  if (!loaded.ok) return loaded;
  const card = loaded.intake.cards.find((c) => c.id === cardId);
  if (!card) return { ok: false, status: 404, error: "Card not found" };
  return { ok: true, card, order: loaded.intake.order, bag: card.bagId ? loaded.intake.bags.find((b) => b.id === card.bagId) ?? null : null };
}

/**
 * What a scanned or typed Card ID / Bag ID points at (case-insensitive; a
 * pasted QR link works too). Null when it's not a code or nothing has it.
 */
export async function resolveCode(
  admin: SupabaseClient,
  raw: string,
): Promise<{ kind: "card" | "bag"; id: string; code: string } | null> {
  const code = normalizeCode(raw);
  if (!code) return null;
  const [{ data: card }, { data: bag }] = await Promise.all([
    admin.from("cards").select("id").eq("card_code", code).maybeSingle(),
    admin.from("tier_bags").select("id").eq("bag_code", code).maybeSingle(),
  ]);
  if (card?.id) return { kind: "card", id: card.id as string, code };
  if (bag?.id) return { kind: "bag", id: bag.id as string, code };
  return null;
}
