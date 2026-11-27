import { z } from "zod";
import { createAdminClient } from "@/lib/supabase/admin";
import { getSoldOutPopupOn } from "@/lib/store-config";
import { takeAttempt } from "@/lib/attempt-limit";
import { isValidEmail } from "@/lib/checkout-validation";

/**
 * The site-wide sold-out pop-up (components/marketing/sold-out-popup.tsx).
 * GET: whether it shows (Store Settings switch). POST: joins the sold-out
 * waitlist (sold_out_waitlist, its own list) with a full name and email.
 */
export async function GET() {
  const on = await getSoldOutPopupOn();
  return Response.json({ on }, { headers: { "Cache-Control": "public, s-maxage=30, stale-while-revalidate=60" } });
}

const Schema = z.object({
  name: z.string().trim().min(2).max(120),
  email: z.string().trim().max(200).refine(isValidEmail),
  // Left empty by people; filled by bots
  website: z.string().max(0).optional().default(""),
});

export async function POST(request: Request) {
  const parsed = Schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return Response.json({ error: "Enter your full name and a valid email." }, { status: 400 });
  }
  const email = parsed.data.email.toLowerCase();

  const attempt = await takeAttempt("sold-out-waitlist", email, { max: 5, windowMinutes: 60 });
  if (attempt.wait > 0) {
    return Response.json({ error: "Too many tries with this email. Please wait a bit and try again." }, { status: 429 });
  }

  const { error } = await createAdminClient()
    .from("sold_out_waitlist")
    .upsert({ name: parsed.data.name, email }, { onConflict: "email" });
  if (error) {
    console.error("Sold-out waitlist signup not saved:", error.message);
    await attempt.release();
    return Response.json({ error: "We couldn't save that. Please try again." }, { status: 500 });
  }
  return Response.json({ ok: true });
}
