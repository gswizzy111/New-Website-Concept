import { createAdminClient } from "@/lib/supabase/admin";
import { fetchAll } from "@/lib/fetch-all";

/**
 * The Completed section (/admin/receiving/completed) and its alert: tier bags
 * whose every non-refunded card is done (tier_bags.completed_at, set by
 * refreshBagCompletion in lib/intake/stages.ts), newest first, with how far
 * the rest of each order is. A bag finishing never completes the order:
 * "Partially completed" is worked out here, never stored, and an admin marks
 * the order completed by hand once every card is done.
 */

export type CompletedCard = {
  id: string;
  card_code: string | null;
  card_seq: number | null;
  card_name: string;
  card_set: string | null;
  card_number: string | null;
  card_year: string | null;
  completed: boolean;
  completed_at: string | null;
  refunded: boolean;
  /** The customer's photo, else a receiving photo, else the catalog picture. */
  photo: string | null;
  photoIsReference: boolean;
};

export type OrderProgress = {
  bagsDone: number;
  bagsTotal: number;
  /** Non-refunded cards of the order, bagged or not. */
  cardsTotal: number;
  cardsDone: number;
  /** Non-refunded cards not in any bag yet (still awaiting arrival or never received). */
  cardsNotInBag: number;
  allCardsDone: boolean;
  /** Every card is done and the order's status is still received / in progress. */
  canMarkCompleted: boolean;
};

export type CompletedBag = {
  id: string;
  bag_code: string;
  tier: string;
  received_on: string | null;
  due_date: string | null;
  completed_at: string;
  completion_seen_at: string | null;
  isNew: boolean;
  order: { id: string; order_number: string | null; customer_name: string | null; status: string };
  cards: CompletedCard[];
  /** Non-refunded cards in the bag. */
  cardCount: number;
  progress: OrderProgress;
};

/** The order statuses from which "Mark order completed" is offered. */
const OPEN_STATUSES = ["received", "in_progress"];

/** True when the error means the intake migration hasn't been applied yet. */
export function isMissingIntakeSchema(error: { code?: string; message?: string } | null | undefined): boolean {
  if (!error) return false;
  // 42P01 undefined table, 42703 undefined column, PGRST204/205 not in PostgREST's schema cache
  if (["42P01", "42703", "PGRST204", "PGRST205"].includes(error.code ?? "")) return true;
  const m = error.message ?? "";
  return /tier_bags|tier_bag_due_changes|business_holidays|card_seq|card_code|bag_id|received_at|received_by|awaiting_arrival|receiving_photo_urls|completion_seen_at/i.test(m)
    && /does not exist|could not find|schema cache/i.test(m);
}

type BagRow = {
  id: string; order_id: string; bag_code: string; tier: string; received_on: string | null; due_date: string | null;
  completed_at: string | null; completion_seen_at: string | null;
};
type CardRow = {
  id: string; order_id: string; bag_id: string | null; card_code: string | null; card_seq: number | null;
  card_name: string; card_set: string | null; card_number: string | null; card_year: string | null;
  completed: boolean | null; completed_at: string | null; status: string | null;
  photo_urls: string[] | null; receiving_photo_urls: string[] | null; catalog_image_url: string | null; created_at: string;
};

function cardPhoto(c: CardRow): { photo: string | null; photoIsReference: boolean } {
  const own = c.photo_urls?.[0] ?? c.receiving_photo_urls?.[0] ?? null;
  if (own) return { photo: own, photoIsReference: false };
  return { photo: c.catalog_image_url ?? null, photoIsReference: !!c.catalog_image_url };
}

/** How far an order is: its bags and cards, done or not. */
export function orderProgress(status: string, bags: Pick<BagRow, "completed_at">[], cards: Pick<CardRow, "completed" | "status" | "bag_id">[]): OrderProgress {
  const live = cards.filter((c) => c.status !== "refunded");
  const cardsDone = live.filter((c) => c.completed).length;
  const allCardsDone = live.length > 0 && cardsDone === live.length;
  return {
    bagsDone: bags.filter((b) => b.completed_at).length,
    bagsTotal: bags.length,
    cardsTotal: live.length,
    cardsDone,
    cardsNotInBag: live.filter((c) => !c.bag_id && !c.completed).length,
    allCardsDone,
    canMarkCompleted: allCardsDone && OPEN_STATUSES.includes(status),
  };
}

/** "All cards done" or "Partially completed: 1 of 2 bags done". */
export function progressText(p: OrderProgress): string {
  if (p.allCardsDone) return "All cards done";
  const extra = p.cardsNotInBag > 0 ? ` · ${p.cardsNotInBag} card${p.cardsNotInBag === 1 ? "" : "s"} not received yet` : "";
  return `Partially completed: ${p.bagsDone} of ${p.bagsTotal} bag${p.bagsTotal === 1 ? "" : "s"} done${extra}`;
}

const CARD_COLUMNS =
  "id, order_id, bag_id, card_code, card_seq, card_name, card_set, card_number, card_year, completed, completed_at, status, photo_urls, receiving_photo_urls, catalog_image_url, created_at";

/**
 * Completed bags, newest completion first (`limit` of them), with each one's
 * cards and its order's progress. `missingTables` is true when the intake
 * migration isn't applied yet (the page shows a notice instead).
 */
export async function loadCompletedBags(limit = 50): Promise<{
  bags: CompletedBag[];
  hasMore: boolean;
  unseen: number;
  missingTables: boolean;
  error: string | null;
}> {
  const admin = createAdminClient();
  const empty = { bags: [], hasMore: false, unseen: 0 };
  const { data: bagRows, error } = await admin
    .from("tier_bags")
    .select("id, order_id, bag_code, tier, received_on, due_date, completed_at, completion_seen_at")
    .not("completed_at", "is", null)
    .order("completed_at", { ascending: false })
    .order("id")
    .limit(limit + 1);
  if (error) {
    return { ...empty, missingTables: isMissingIntakeSchema(error), error: isMissingIntakeSchema(error) ? null : error.message };
  }
  const page = ((bagRows ?? []) as BagRow[]).slice(0, limit);
  const hasMore = (bagRows ?? []).length > limit;
  const unseen = await countUnseenCompletedBags();
  if (page.length === 0) return { bags: [], hasMore: false, unseen, missingTables: false, error: null };

  const orderIds = [...new Set(page.map((b) => b.order_id))];
  try {
    const [{ data: orders, error: ordersErr }, allBags, allCards] = await Promise.all([
      admin.from("orders").select("id, order_number, customer_name, status").in("id", orderIds),
      fetchAll<BagRow>((from, to) =>
        admin.from("tier_bags")
          .select("id, order_id, bag_code, tier, received_on, due_date, completed_at, completion_seen_at")
          .in("order_id", orderIds).order("id").range(from, to)),
      fetchAll<CardRow>((from, to) =>
        admin.from("cards").select(CARD_COLUMNS).in("order_id", orderIds).order("id").range(from, to)),
    ]);
    if (ordersErr) throw new Error(ordersErr.message);
    const orderById = new Map((orders ?? []).map((o) => [o.id as string, o]));

    const bags: CompletedBag[] = page.map((b) => {
      const o = orderById.get(b.order_id);
      const status = (o?.status as string) ?? "";
      const orderBags = allBags.filter((x) => x.order_id === b.order_id);
      const orderCards = allCards.filter((c) => c.order_id === b.order_id);
      const inBag = orderCards
        .filter((c) => c.bag_id === b.id)
        .sort((x, y) => (x.card_seq ?? 1e9) - (y.card_seq ?? 1e9) || x.created_at.localeCompare(y.created_at) || x.id.localeCompare(y.id));
      return {
        id: b.id,
        bag_code: b.bag_code,
        tier: b.tier,
        received_on: b.received_on,
        due_date: b.due_date,
        completed_at: b.completed_at!,
        completion_seen_at: b.completion_seen_at,
        isNew: !b.completion_seen_at,
        order: {
          id: b.order_id,
          order_number: (o?.order_number as string) ?? null,
          customer_name: (o?.customer_name as string) ?? null,
          status,
        },
        cards: inBag.map((c) => ({
          id: c.id,
          card_code: c.card_code,
          card_seq: c.card_seq,
          card_name: c.card_name,
          card_set: c.card_set,
          card_number: c.card_number,
          card_year: c.card_year,
          completed: !!c.completed,
          completed_at: c.completed_at,
          refunded: c.status === "refunded",
          ...cardPhoto(c),
        })),
        cardCount: inBag.filter((c) => c.status !== "refunded").length,
        progress: orderProgress(status, orderBags, orderCards),
      };
    });
    return { bags, hasMore, unseen, missingTables: false, error: null };
  } catch (e) {
    return { ...empty, unseen, missingTables: false, error: e instanceof Error ? e.message : String(e) };
  }
}

/**
 * Completed bags nobody has dismissed yet (the "New" badge and the admin nav
 * badge). 0 when the intake tables don't exist yet or the count fails.
 */
export async function countUnseenCompletedBags(): Promise<number> {
  const { count, error } = await createAdminClient()
    .from("tier_bags")
    .select("id", { count: "exact", head: true })
    .not("completed_at", "is", null)
    .is("completion_seen_at", null);
  if (error) {
    if (!isMissingIntakeSchema(error)) console.error("[intake] unseen completed bags count failed:", error.message);
    return 0;
  }
  return count ?? 0;
}

/**
 * Dismisses the "bag completed" alert: the given bags, or every completed bag
 * not yet seen. Returns how many were marked.
 */
export async function markCompletedBagsSeen(bagIds?: string[]): Promise<number> {
  let query = createAdminClient()
    .from("tier_bags")
    .update({ completion_seen_at: new Date().toISOString() })
    .not("completed_at", "is", null)
    .is("completion_seen_at", null);
  if (bagIds) {
    if (bagIds.length === 0) return 0;
    query = query.in("id", bagIds);
  }
  const { data, error } = await query.select("id");
  if (error) throw new Error(error.message);
  return (data ?? []).length;
}
