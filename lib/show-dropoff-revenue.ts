// Revenue on the Show Dropoffs tab (/admin/show-dropoffs). Server only.
//
// Each drop-off's revenue is the tiers the customer picked at the table, at
// the admin's current prices (restoration_settings, PSA Prep from
// store_config): each listed card at its tier (or the one service picked),
// and for 5+ cards the card count times the one service. Entered or not, the
// figure is the same; entering only links its order. Cancelled drop-offs
// count nothing. Diamond is priced by declared value, which the form doesn't
// ask for, and 5+ cards with several services have no per-card split, so
// those are flagged as not fully priced.

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
  /** The tiers picked, priced; 0 for a cancelled drop-off. */
  cents: number;
  cancelled: boolean;
  entered: boolean;
  /** False when part of it couldn't be priced (Diamond, 5+ cards with several services or no count). */
  complete: boolean;
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

/** The tiers picked on one drop-off, priced. */
function priceTiers(row: DropoffRevenueRow, book: PriceBook): { cents: number; complete: boolean } {
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

/** Each drop-off's revenue by id, with the order it was entered as. */
export async function dropoffRevenue(rows: DropoffRevenueRow[]): Promise<Map<string, DropoffMoney>> {
  const admin = createAdminClient();
  const orderIds = [...new Set(rows.map((r) => r.order_id).filter((id): id is string => !!id))];
  const orderNumbers = new Map<string, string>();
  for (let i = 0; i < orderIds.length; i += 200) {
    const { data, error } = await admin.from("orders").select("id, order_number").in("id", orderIds.slice(i, i + 200));
    if (error) throw new Error(error.message);
    for (const o of data ?? []) orderNumbers.set(o.id, o.order_number);
  }

  const book = await priceBook();
  const money = new Map<string, DropoffMoney>();
  for (const row of rows) {
    const cancelled = row.status === "cancelled";
    const priced = cancelled ? { cents: 0, complete: true } : priceTiers(row, book);
    money.set(row.id, {
      ...priced,
      cancelled,
      entered: row.status === "entered",
      ...(row.order_id ? { orderId: row.order_id, orderNumber: orderNumbers.get(row.order_id) } : {}),
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
