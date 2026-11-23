// Revenue on the Show Dropoffs tab (/admin/show-dropoffs). Server only.
//
// Each drop-off counts what lib/show-dropoff-pricing.ts says: before it is
// entered, the tiers the customer picked at the admin's current prices
// (restoration_settings, PSA Prep from store_config); once entered, its
// order's total, so this tab and the order show the same amount. Cancelled
// drop-offs count nothing. Diamond, and 5+ cards with several services,
// can't be priced until entered and are flagged as not fully priced.
// Show drop-off orders (linked by show_dropoffs.order_id) are left out of the
// dashboard and the money reports: this tab is where their revenue shows.

import { createAdminClient } from "@/lib/supabase/admin";
import { fetchAll } from "@/lib/fetch-all";
import { getLiveTiers } from "@/lib/live-tiers";
import { getPrepCardCents } from "@/lib/show-dropoff-services";
import { dropoffFigure, makePriceBook, type LinkedOrder } from "@/lib/show-dropoff-pricing";

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
  /** Its order's total once entered, else the tiers picked, priced; 0 for a cancelled drop-off. */
  cents: number;
  cancelled: boolean;
  entered: boolean;
  /** False when part of it couldn't be priced (Diamond, 5+ cards with several services or no count). */
  complete: boolean;
  /** True when `cents` is the order's total. */
  fromOrder: boolean;
  orderNumber?: string;
  orderId?: string;
};

export type RevenueTotals = {
  dropoffs: number;
  cards: number;
  revenueCents: number;
  enteredCents: number;
  toEnterCents: number;
  /** Drop-offs that couldn't be fully priced. */
  unpriced: number;
};

/** Each drop-off's revenue by id, with the order it was entered as. */
export async function dropoffRevenue(rows: DropoffRevenueRow[]): Promise<Map<string, DropoffMoney>> {
  const admin = createAdminClient();
  const orderIds = [...new Set(rows.map((r) => r.order_id).filter((id): id is string => !!id))];
  const orders = new Map<string, LinkedOrder & { order_number: string }>();
  for (let i = 0; i < orderIds.length; i += 200) {
    const { data, error } = await admin.from("orders").select("id, order_number, total_cents").in("id", orderIds.slice(i, i + 200));
    if (error) throw new Error(error.message);
    for (const o of data ?? []) orders.set(o.id, o);
  }

  const [tiers, prepCents] = await Promise.all([getLiveTiers(), getPrepCardCents()]);
  const book = makePriceBook(tiers, prepCents);
  const money = new Map<string, DropoffMoney>();
  for (const row of rows) {
    const order = row.order_id ? orders.get(row.order_id) : undefined;
    money.set(row.id, {
      ...dropoffFigure(row, book, order),
      cancelled: row.status === "cancelled",
      entered: row.status === "entered",
      ...(row.order_id ? { orderId: row.order_id, orderNumber: order?.order_number } : {}),
    });
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
  const t: RevenueTotals = { dropoffs: 0, cards: 0, revenueCents: 0, enteredCents: 0, toEnterCents: 0, unpriced: 0 };
  for (const row of rows) {
    const m = money.get(row.id);
    if (!m || m.cancelled) continue;
    t.dropoffs++;
    t.cards += dropoffCardCount(row);
    t.revenueCents += m.cents;
    if (m.entered) t.enteredCents += m.cents;
    else t.toEnterCents += m.cents;
    if (!m.complete) t.unpriced++;
  }
  return t;
}
