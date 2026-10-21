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
