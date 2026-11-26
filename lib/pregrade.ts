import { createAdminClient } from "@/lib/supabase/admin";
import { fetchAll } from "@/lib/fetch-all";

/**
 * Pre-grades: an order's service line says how many it paid for (restoration
 * checkout: "pregrade"; prep checkout: "pre_grade_assessment"), and each card
 * that has one is flagged pregrade_selected. Orders from before cards were
 * flagged only have the count, so staff flag the cards on the order page. A
 * card's pre-grade is done once pregrade_submitted_at is set.
 */
export const PREGRADE_SERVICE_IDS = ["pregrade", "pre_grade_assessment"];

export type PregradeCount = { owed: number; done: number };
/** What the counts read of a card. */
export type PregradeFlags = { pregrade_selected?: boolean | null; pregrade_submitted_at?: string | null };

/** Owed: the larger of what was paid for and how many cards are flagged. */
export function pregradeCount(paidFor: number, cards: PregradeFlags[]): PregradeCount {
  const flagged = cards.filter((c) => c.pregrade_selected).length;
  const done = cards.filter((c) => c.pregrade_selected && c.pregrade_submitted_at).length;
  return { owed: Math.max(paidFor, flagged), done };
}

/**
 * Which cards of one order get the PG field on their bag label row (owner,
 * Nov 26 2026: "the people that pay for the pregrade have the sticker with
 * teh spot for the pregrade and the people that dont dont"): a card flagged
 * pregrade_selected (paid for at checkout, or marked by staff on the order
 * page) or whose pre-grade was submitted. When the order paid for more pre-grades than it has cards
 * flagged (older orders have only the count: pregradeCount's owed above the
 * flagged cards, when the order page says "Mark which cards below"), the
 * label can't know which cards, so every card of the order gets the field.
 *
 * `paidFor`: the pre-grades on the order's service lines (PREGRADE_SERVICE_IDS
 * quantities); `orderCards`: the order's cards that are flagged (any status,
 * bagged or not; others may be passed too), as the order page counts them.
 * Returns the test for one card of that order. Pure.
 */
export function pregradeOnLabel(paidFor: number, orderCards: PregradeFlags[]): (card: PregradeFlags) => boolean {
  const flagged = orderCards.filter((c) => c.pregrade_selected).length;
  const unassigned = pregradeCount(paidFor, orderCards).owed > flagged;
  return (card) => unassigned || !!card.pregrade_selected || !!card.pregrade_submitted_at;
}

/**
 * Pre-grade counts for every order that has any (all orders, or just
 * `orderIds`). Read in pages (lib/fetch-all.ts), so no rows are dropped past
 * the API's 1,000-row cap.
 */
export async function pregradeCounts(orderIds?: string[]): Promise<Map<string, PregradeCount>> {
  const admin = createAdminClient();
  type ServiceRow = { order_id: string; quantity: number | null };
  type CardRow = { order_id: string; pregrade_selected: boolean | null; pregrade_submitted_at: string | null };
  const chunks = orderIds ? chunk(orderIds, 100) : [null];
  const [serviceRows, cardRows] = await Promise.all([
    Promise.all(chunks.map((ids) => fetchAll<ServiceRow>((from, to) => {
      let q = admin.from("order_services").select("order_id, quantity").in("service_id", PREGRADE_SERVICE_IDS);
      if (ids) q = q.in("order_id", ids);
      // Ordered by every column read (rows equal in all of them are
      // interchangeable here), so the pages are stable
      return q.order("order_id").order("service_id").order("quantity").range(from, to);
    }))).then((r) => r.flat()),
    Promise.all(chunks.map((ids) => fetchAll<CardRow>((from, to) => {
      let q = admin.from("cards").select("order_id, pregrade_selected, pregrade_submitted_at").or("pregrade_selected.eq.true,pregrade_submitted_at.not.is.null");
      if (ids) q = q.in("order_id", ids);
      return q.order("id", { ascending: true }).range(from, to);
    }))).then((r) => r.flat()),
  ]);

  const paidFor = new Map<string, number>();
  for (const s of serviceRows) paidFor.set(s.order_id, (paidFor.get(s.order_id) ?? 0) + (s.quantity ?? 1));
  const cardsByOrder = new Map<string, CardRow[]>();
  for (const c of cardRows) cardsByOrder.set(c.order_id, [...(cardsByOrder.get(c.order_id) ?? []), c]);

  const counts = new Map<string, PregradeCount>();
  for (const id of new Set([...paidFor.keys(), ...cardsByOrder.keys()])) {
    const count = pregradeCount(paidFor.get(id) ?? 0, cardsByOrder.get(id) ?? []);
    if (count.owed > 0) counts.set(id, count);
  }
  return counts;
}

function chunk<T>(list: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < list.length; i += size) out.push(list.slice(i, i + size));
  return out;
}

/** "Pre-Grade ×3", or "Pre-Grade 1/3 done" once some are submitted. */
export function pregradeLabel({ owed, done }: PregradeCount) {
  return done > 0 ? `Pre-Grade ${Math.min(done, owed)}/${owed} done` : `Pre-Grade ×${owed}`;
}
