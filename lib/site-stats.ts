import { createAdminClient } from "@/lib/supabase/admin";

// Cards the owner has worked on outside website orders (owner's figure).
const CARDS_OUTSIDE_WEBSITE = 600;

/**
 * "Cards Restored" on the home page: every card sent in on a website order
 * (orders that were paid or placed by the admin, not abandoned or cancelled),
 * plus the cards done outside the website. Formatted like "2,321+".
 * Falls back to the owner's earlier "500+" if the count can't be read.
 */
export async function getCardsRestoredStat(): Promise<string> {
  try {
    const admin = createAdminClient();
    const { count, error } = await admin
      .from("cards")
      .select("id, orders!inner(status)", { count: "exact", head: true })
      .not("orders.status", "in", "(awaiting_payment,cancelled)");
    if (error || count === null) return "500+";
    return `${(count + CARDS_OUTSIDE_WEBSITE).toLocaleString("en-US")}+`;
  } catch {
    return "500+";
  }
}

/**
 * Cards finished on website orders, for the About page: card rows on paid
 * orders that are Completed, Shipped Back or Delivered (restoration and
 * prep), rounded down to the nearest 50, like "1,050+". Only what the
 * database shows: no outside figure, no unfinished cards. Null if it can't
 * be read, so the page leaves the figure out rather than guessing.
 */
export async function getCardsFinishedStat(): Promise<string | null> {
  try {
    const admin = createAdminClient();
    const { count, error } = await admin
      .from("cards")
      .select("id, orders!inner(status, payment_status)", { count: "exact", head: true })
      .in("orders.status", ["completed", "shipped_back", "delivered"])
      .eq("orders.payment_status", "paid");
    if (error || !count) return null;
    const floor = count >= 100 ? Math.floor(count / 50) * 50 : count;
    return `${floor.toLocaleString("en-US")}+`;
  } catch {
    return null;
  }
}
