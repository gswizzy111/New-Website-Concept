// Revenue on the Show Dropoffs tab (/admin/show-dropoffs). Server only.
//
// A show drop-off is only the intake; the money is on the order the admin
// creates from it (show_dropoffs.order_id). So each drop-off counts as:
//  - entered: its order's total, less refunds that went through (the refunds
//    ledger, lib/refund-ledger.ts). A cancelled order counts $0.
//  - to enter: an estimate from what the customer picked at the table, at
//    the admin's current prices (each listed card's tier, or for 5+ cards the
//    card count times the one service picked). Diamond is priced by declared
//    value, which the form doesn't ask for, so it can't be estimated.
//  - cancelled: nothing.

import { createAdminClient } from "@/lib/supabase/admin";
import { fetchAll } from "@/lib/fetch-all";
import { getLiveTiers } from "@/lib/live-tiers";
import { getPrepCardCents } from "@/lib/show-dropoff-services";
import type { RestorationTier } from "@/lib/restoration-tiers";

export type DropoffRevenueRow = {
  id: string;
  show_name: string | null;
  status: string;
  tiers: string[];
  five_plus: boolean;
  card_count: number | null;
  cards: { service?: string | null }[] | null;
  order_id: string | null;
};

export type DropoffMoney = {
  /** Entered: what the order brought in. To enter: the estimate. */
  cents: number;
  kind: "entered" | "estimate" | "none";
  /** False when part of it couldn't be priced (Diamond, 5+ cards with several services or no count). */
  complete: boolean;
  orderNumber?: string;
  orderId?: string;
};

export type RevenueTotals = { dropoffs: number; cards: number; enteredCents: number; estimateCents: number; unpriced: number };

type PriceBook = { perCard: (service: string) => number | null };

async function priceBook(): Promise<PriceBook> {
  const [tiers, prepCents] = await Promise.all([getLiveTiers(), getPrepCardCents()]);
  const byId = new Map<string, RestorationTier>(tiers.map((t) => [t.id, t]));
  return {
    perCard(service) {
      if (service === "prep") return prepCents;
      const tier = byId.get(service);
      if (!tier || tier.pricing_type === "percentage") return null;
      return tier.price_cents;
    },
  };
}

function estimate(row: DropoffRevenueRow, book: PriceBook): { cents: number; complete: boolean } {
  if (row.five_plus) {
    const price = row.tiers.length === 1 ? book.perCard(row.tiers[0]) : null;
    if (price === null || !row.card_count) return { cents: 0, complete: false };
    return { cents: price * row.card_count, complete: true };
  }
  let cents = 0;
  let complete = true;
  for (const card of row.cards ?? []) {
    // One service picked: every card is that service (as the signed text reads it)
    const service = card.service ?? (row.tiers.length === 1 ? row.tiers[0] : null);
    const price = service ? book.perCard(service) : null;
    if (price === null) complete = false;
    else cents += price;
  }
  return { cents, complete };
}

/** Each drop-off's money, by id, plus the orders behind the entered ones. */
export async function dropoffRevenue(rows: DropoffRevenueRow[]): Promise<Map<string, DropoffMoney>> {
  const admin = createAdminClient();
  const orderIds = [...new Set(rows.map((r) => r.order_id).filter((id): id is string => !!id))];
  const orders = new Map<string, { order_number: string; total_cents: number | null; status: string | null }>();
  const refunded = new Map<string, number>();
  for (let i = 0; i < orderIds.length; i += 200) {
    const ids = orderIds.slice(i, i + 200);
    const [{ data: o, error: oErr }, { data: r, error: rErr }] = await Promise.all([
      admin.from("orders").select("id, order_number, total_cents, status").in("id", ids),
      admin.from("refunds").select("order_id, amount_cents").in("order_id", ids).eq("status", "succeeded"),
    ]);
    if (oErr) throw new Error(oErr.message);
    if (rErr) throw new Error(rErr.message);
    for (const row of o ?? []) orders.set(row.id, row);
    for (const row of r ?? []) refunded.set(row.order_id, (refunded.get(row.order_id) ?? 0) + (row.amount_cents ?? 0));
  }

  const book = rows.some((r) => r.status === "new") ? await priceBook() : null;
  const money = new Map<string, DropoffMoney>();
  for (const row of rows) {
    if (row.status === "entered" && row.order_id) {
      const order = orders.get(row.order_id);
      const cents = !order || order.status === "cancelled"
        ? 0
        : Math.max(0, (order.total_cents ?? 0) - (refunded.get(row.order_id) ?? 0));
      money.set(row.id, { cents, kind: "entered", complete: true, orderNumber: order?.order_number, orderId: row.order_id });
    } else if (row.status === "new" && book) {
      const e = estimate(row, book);
      money.set(row.id, { cents: e.cents, kind: "estimate", complete: e.complete });
    } else {
      money.set(row.id, { cents: 0, kind: "none", complete: true });
    }
  }
  return money;
}

/** Every show drop-off's revenue fields (paged, so none are missed). */
export async function allDropoffsForRevenue(): Promise<DropoffRevenueRow[]> {
  const admin = createAdminClient();
  return fetchAll<DropoffRevenueRow>((from, to) =>
    admin
      .from("show_dropoffs")
      .select("id, show_name, status, tiers, five_plus, card_count, cards, order_id")
      .order("id")
      .range(from, to),
  );
}

/** Cards on a drop-off: the count it was signed with, else the cards listed. */
export function dropoffCardCount(row: Pick<DropoffRevenueRow, "card_count" | "cards">): number {
  return row.card_count ?? row.cards?.length ?? 0;
}

export function totalsFor(rows: DropoffRevenueRow[], money: Map<string, DropoffMoney>): RevenueTotals {
  const t: RevenueTotals = { dropoffs: 0, cards: 0, enteredCents: 0, estimateCents: 0, unpriced: 0 };
  for (const row of rows) {
    if (row.status === "cancelled") continue;
    const m = money.get(row.id);
    t.dropoffs++;
    t.cards += dropoffCardCount(row);
    if (m?.kind === "entered") t.enteredCents += m.cents;
    if (m?.kind === "estimate") {
      t.estimateCents += m.cents;
      if (!m.complete) t.unpriced++;
    }
  }
  return t;
}
