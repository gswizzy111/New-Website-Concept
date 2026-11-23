import type { SupabaseClient } from "@supabase/supabase-js";
import { cardCode, qrUrl, tierDisplayName, tierRank } from "@/lib/intake/codes";
import type { BagSummary } from "@/lib/intake/types";
import { CONTENT_WIDTH_CONFIG_KEY, STOCK_CONFIG_KEY, normalizeLabelSettings, type LabelStockId } from "./stock";
import type { LabelBag } from "./types";

// What the label routes print, read with a few plain queries (server only:
// pass the service-role client from lib/supabase/admin.ts).

export type LabelBagWithId = LabelBag & { id: string; orderId: string; labelPrintedAt: string | null };

type BagRow = {
  id: string;
  order_id: string;
  tier: string;
  batch: number;
  bag_code: string;
  received_on: string | null;
  due_date: string | null;
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
 * number and customer and the bag's non-refunded cards by card number.
 * Bags come fastest tier first, then by batch.
 */
export async function loadLabelBags(
  admin: SupabaseClient,
  where: { bagId: string } | { orderId: string },
): Promise<{ bags: LabelBagWithId[]; error: string | null }> {
  let q = admin.from("tier_bags").select("id, order_id, tier, batch, bag_code, received_on, due_date, label_printed_at");
  q = "bagId" in where ? q.eq("id", where.bagId) : q.eq("order_id", where.orderId);
  const { data: bagData, error: bagErr } = await q;
  if (bagErr) return { bags: [], error: bagErr.message };
  const bagRows = (bagData ?? []) as BagRow[];
  if (!bagRows.length) return { bags: [], error: null };

  const orderIds = [...new Set(bagRows.map((b) => b.order_id))];
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
    if (!c.bag_id || c.status === "refunded") continue;
    (cardsByBag.get(c.bag_id) ?? cardsByBag.set(c.bag_id, []).get(c.bag_id)!).push(c);
  }

  const bags = bagRows
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
        cards: (cardsByBag.get(b.id) ?? [])
          .filter((c) => c.card_seq != null)
          .sort((x, y) => (x.card_seq ?? 0) - (y.card_seq ?? 0))
          .map((c) => {
            const code = c.card_code ?? cardCode(orderNumber, c.card_seq!);
            return {
              seq: c.card_seq!,
              code,
              qrUrl: qrUrl(code),
              name: c.card_name ?? "",
              set: c.card_set,
              year: c.card_year,
              number: c.card_number,
            };
          }),
      };
    });
  return { bags, error: null };
}

/** A BagSummary (lib/intake/types.ts) as the label layout reads it (no card years there). */
export function labelBagFromSummary(b: BagSummary): LabelBag {
  return {
    bagCode: b.code,
    qrUrl: b.qrUrl,
    tierName: b.tierName,
    orderNumber: b.orderNumber,
    customerName: b.customerName ?? "",
    receivedOn: b.receivedOn,
    dueDate: b.dueDate,
    cards: b.cards
      .filter((c) => c.seq != null && c.code)
      .map((c) => ({ seq: c.seq!, code: c.code!, qrUrl: c.qrUrl, name: c.name, set: c.set, number: c.number })),
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
