import { createAdminClient } from "@/lib/supabase/admin";
import { likeExact } from "@/lib/like-exact";
import { takeAttempt } from "@/lib/attempt-limit";
import { z } from "zod";

/**
 * The loyalty discount the order builder shows at checkout (the checkout
 * route works it out again on the server, so this is for display only).
 * Answers with the discount alone, never the number of orders behind it.
 * POST takes the email in the body so it stays out of URLs and logs; GET is
 * kept for the order builder until it moves to POST.
 *
 * Anyone can ask, and the discount still shows whether an address has 0, 1
 * or 2+ paid orders, so lookups are limited for everyone together (there is
 * no sign-in to count them against, and never an IP): enough for the
 * customers checking out, too few to go through a list of addresses. Past the
 * limit the answer is 0%; checkout still applies the real discount.
 */
const LOOKUP_RULE = { max: 60, windowMinutes: 15 };
const LIMIT_KEY = "loyalty";

async function loyalty(rawEmail: unknown) {
  const email = typeof rawEmail === "string" ? rawEmail.toLowerCase().trim() : "";
  // Only a real address: anything else (a pattern, a fragment) counts nothing
  if (!email || email.length > 320 || !z.string().email().safeParse(email).success) return { discountPercent: 0 };

  const { wait } = await takeAttempt("loyalty-lookup", LIMIT_KEY, LOOKUP_RULE);
  if (wait > 0) return { discountPercent: 0 };

  const admin = createAdminClient();
  const { count, error } = await admin
    .from("orders")
    .select("id", { count: "exact", head: true })
    .ilike("customer_email", likeExact(email))
    .eq("payment_status", "paid")
    .neq("status", "awaiting_payment");
  if (error) {
    console.error("Loyalty lookup failed:", error.message);
    return { discountPercent: 0 };
  }

  // Same rule as the checkout route: 5% on the second order, 10% after that
  const orderCount = count ?? 0;
  const discountPercent = orderCount >= 2 ? 10 : orderCount === 1 ? 5 : 0;
  return { discountPercent };
}

const noStore = { headers: { "Cache-Control": "no-store" } };

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  return Response.json(await loyalty(searchParams.get("email")), noStore);
}

export async function POST(req: Request) {
  const body = await req.json().catch(() => null);
  return Response.json(await loyalty(body?.email), noStore);
}
