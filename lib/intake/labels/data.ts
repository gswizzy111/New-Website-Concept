import type { SupabaseClient } from "@supabase/supabase-js";
import { cardCode, qrUrl, tierDisplayName, tierRank } from "@/lib/intake/codes";
import type { BagSummary } from "@/lib/intake/types";
import { CONTENT_WIDTH_CONFIG_KEY, STOCK_CONFIG_KEY, normalizeLabelSettings, type LabelStockId } from "./stock";
import type { LabelPlace } from "./place";
import type { LabelBag } from "./types";

// What the label routes print (one label per tier bag; one label per slot or
// place), read with a few plain queries (server only: pass the service-role
// client from lib/supabase/admin.ts).

export type LabelBagWithId = LabelBag & { id: string; orderId: string; labelPrintedAt: string | null };

type BagRow = {
  id: string;
  order_id: string;
  tier: string;
  batch: number;
  bag_code: string;
  received_on: string | null;
  due_date: string | null;
  due_status: string | null;
  label_printed_at: string | null;
};

type CardRow = {
  id: string;
  bag_id: string | null;
  card_seq: number | null;
  card_code: string | null;
  card_name: string | null;
  card_set: string | null;
  card_year: string | null;
  card_number: string | null;
  status: string | null;
};

/**
 * One bag (`bagId`) or every bag of an order (`orderId`), with the order's
 * number and customer, the bag's non-refunded cards by card number, and the
 * order's other bags with cards ("Also in this order" on the label). Bags
 * come fastest tier first, then by batch.
 */
export async function loadLabelBags(
  admin: SupabaseClient,
  where: { bagId: string } | { orderId: string },
): Promise<{ bags: LabelBagWithId[]; error: string | null }> {
  // Every bag of the order(s), so each label can name its order's other bags
  let orderIds: string[];
  if ("bagId" in where) {
    const { data, error } = await admin.from("tier_bags").select("order_id").eq("id", where.bagId);
    if (error) return { bags: [], error: error.message };
    orderIds = [...new Set(((data ?? []) as { order_id: string }[]).map((b) => b.order_id))];
    if (!orderIds.length) return { bags: [], error: null };
  } else {
    orderIds = [where.orderId];
  }
  const { data: bagData, error: bagErr } = await admin
    .from("tier_bags")
    .select("id, order_id, tier, batch, bag_code, received_on, due_date, due_status, label_printed_at")
    .in("order_id", orderIds);
  if (bagErr) return { bags: [], error: bagErr.message };
  const bagRows = (bagData ?? []) as BagRow[];
  if (!bagRows.length) return { bags: [], error: null };

  const [orders, cards, tiers] = await Promise.all([
    admin.from("orders").select("id, order_number, customer_name").in("id", orderIds),
    admin
      .from("cards")
      .select("id, bag_id, card_seq, card_code, card_name, card_set, card_year, card_number, status")
      .in("bag_id", bagRows.map((b) => b.id)),
    admin.from("restoration_settings").select("tier, display_name"),
  ]);
  if (orders.error) return { bags: [], error: orders.error.message };
  if (cards.error) return { bags: [], error: cards.error.message };

  const orderById = new Map((orders.data ?? []).map((o) => [o.id as string, o as { order_number: string; customer_name: string | null }]));
  const names: Record<string, string> = {};
  for (const t of (tiers.data ?? []) as { tier: string; display_name: string | null }[]) if (t.display_name) names[t.tier] = t.display_name;

  const cardsByBag = new Map<string, CardRow[]>();
  for (const c of (cards.data ?? []) as CardRow[]) {
    if (!c.bag_id || c.status === "refunded" || c.card_seq == null) continue;
    (cardsByBag.get(c.bag_id) ?? cardsByBag.set(c.bag_id, []).get(c.bag_id)!).push(c);
  }

  const all = bagRows
    .sort((a, b) => tierRank(a.tier) - tierRank(b.tier) || a.tier.localeCompare(b.tier) || a.batch - b.batch)
    .map((b): LabelBagWithId => {
      const order = orderById.get(b.order_id);
      const orderNumber = order?.order_number ?? "";
      return {
        id: b.id,
        orderId: b.order_id,
        labelPrintedAt: b.label_printed_at,
        bagCode: b.bag_code,
        qrUrl: qrUrl(b.bag_code),
        tierName: tierDisplayName(b.tier, names),
        orderNumber,
        customerName: order?.customer_name ?? "",
        receivedOn: b.received_on,
        dueDate: b.due_date,
        dueStatus: b.due_status,
        cards: (cardsByBag.get(b.id) ?? [])
          .sort((x, y) => (x.card_seq ?? 0) - (y.card_seq ?? 0))
          .map((c) => ({
            seq: c.card_seq!,
            code: c.card_code ?? cardCode(orderNumber, c.card_seq!),
            name: c.card_name ?? "",
            set: c.card_set,
            year: c.card_year,
            number: c.card_number,
          })),
      };
    });
  for (const b of all) {
    b.otherBags = all
      .filter((o) => o.orderId === b.orderId && o.id !== b.id && o.cards.length)
      .map((o) => ({ bagCode: o.bagCode, tierName: o.tierName, cardCount: o.cards.length }));
  }
  const bags = "bagId" in where ? all.filter((b) => b.id === where.bagId) : all;
  return { bags, error: null };
}

/**
 * A BagSummary (lib/intake/types.ts) as the label layout reads it (no card
 * years there). `others`: the order's other bags, for "Also in this order".
 */
export function labelBagFromSummary(b: BagSummary, others: readonly BagSummary[] = []): LabelBag {
  return {
    bagCode: b.code,
    qrUrl: b.qrUrl,
    tierName: b.tierName,
    orderNumber: b.orderNumber,
    customerName: b.customerName ?? "",
    receivedOn: b.receivedOn,
    dueDate: b.dueDate,
    dueStatus: b.dueStatus,
    cards: b.cards
      .filter((c) => c.seq != null && c.code)
      .map((c) => ({ seq: c.seq!, code: c.code!, name: c.name, set: c.set, number: c.number })),
    otherBags: others
      .filter((o) => o.id !== b.id && o.orderId === b.orderId && o.cardCount > 0)
      .map((o) => ({ bagCode: o.code, tierName: o.tierName, cardCount: o.cardCount })),
  };
}

/** The label stock and content width saved on the Receiving settings page (store_config), else 4x6 at 3.2in. */
export async function getLabelSettings(admin: SupabaseClient): Promise<{ stock: LabelStockId; contentWidthIn: number }> {
  try {
    const { data } = await admin.from("store_config").select("key, value").in("key", [STOCK_CONFIG_KEY, CONTENT_WIDTH_CONFIG_KEY]);
    const map = Object.fromEntries((data ?? []).map((r) => [r.key as string, r.value as string]));
    return normalizeLabelSettings(map[STOCK_CONFIG_KEY], map[CONTENT_WIDTH_CONFIG_KEY]);
  } catch {
    return normalizeLabelSettings(undefined, undefined);
  }
}

// ── Place labels (slots and signs) ───────────────────────────────────────────

/** A place label with its locations row's id, station type and whether it is in use. */
export type LabelPlaceWithId = LabelPlace & { id: string; station: string | null; active: boolean };

type PlaceRow = {
  id: string;
  code: string;
  name: string;
  kind: string;
  stage: string | null;
  due_date: string | null;
  station?: string | null;
  serial?: number | null;
  active?: boolean | null;
};

const PLACE_COLUMNS = "id, code, name, kind, stage, due_date, station, serial, active";
/** Without the slot columns (station, serial): a database where the slot migration isn't applied yet still prints signs. */
const PLACE_COLUMNS_BASE = "id, code, name, kind, stage, due_date, active";

function placeFromRow(r: PlaceRow): LabelPlaceWithId {
  return {
    id: r.id,
    code: r.code,
    name: r.name,
    kind: r.kind,
    stage: r.stage,
    dueDate: r.due_date,
    serial: r.serial ?? null,
    station: r.station ?? null,
    active: r.active !== false,
    qrUrl: qrUrl(r.code),
  };
}

/**
 * Places to print labels for (server only: the service-role client):
 *   { ids }                    those places, in the order asked (inactive ones too: asked for by id)
 *   { station, from?, to? }    the station type's active slots, by serial number
 *                              (from..to inclusive: "Clamps 01 to 20")
 */
export async function loadLabelPlaces(
  admin: SupabaseClient,
  where: { ids: string[] } | { station: string; from?: number | null; to?: number | null },
): Promise<{ places: LabelPlaceWithId[]; error: string | null }> {
  const read = async (columns: string) => {
    const q = admin.from("locations").select(columns);
    return "ids" in where ? await q.in("id", where.ids) : await q.eq("station", where.station);
  };
  let res = await read(PLACE_COLUMNS);
  // Before the slot columns exist, places asked for by id still print (as signs)
  if (res.error && "ids" in where && /column|schema cache/i.test(res.error.message)) res = await read(PLACE_COLUMNS_BASE);
  if (res.error) return { places: [], error: res.error.message };
  const rows = ((res.data ?? []) as unknown as PlaceRow[]).map(placeFromRow);
  if ("ids" in where) {
    const at = new Map(where.ids.map((id, i) => [id, i]));
    return { places: rows.sort((a, b) => (at.get(a.id) ?? 0) - (at.get(b.id) ?? 0)), error: null };
  }
  const from = where.from ?? -Infinity;
  const to = where.to ?? Infinity;
  const places = rows
    .filter((p) => p.active && p.serial != null && p.serial >= from && p.serial <= to)
    .sort((a, b) => (a.serial ?? 0) - (b.serial ?? 0) || a.code.localeCompare(b.code));
  return { places, error: null };
}
