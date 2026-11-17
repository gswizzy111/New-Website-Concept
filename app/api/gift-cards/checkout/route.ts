import { z } from "zod";
import { stripe } from "@/lib/stripe";
import { siteUrl } from "@/lib/site-url";
import { logCheckoutError } from "@/lib/checkout-error-log";

const Schema = z.object({
  amount_cents: z.number().int().min(1000).max(100000),
  purchaser_name: z.string().min(1),
  purchaser_email: z.string().email(),
  recipient_name: z.string().min(1),
  recipient_email: z.string().email(),
  personal_message: z.string().max(500).optional(),
});

export async function POST(req: Request) {
  const body = await req.json().catch(() => null);
  const parsed = Schema.safeParse(body);
  if (!parsed.success) {
    return Response.json({ error: "Invalid request." }, { status: 400 });
  }

  const data = parsed.data;
  const appUrl = siteUrl();
  const amountDollars = (data.amount_cents / 100).toFixed(2);

  let session: Awaited<ReturnType<typeof stripe.checkout.sessions.create>>;
  try {
    session = await stripe.checkout.sessions.create({
      mode: "payment",
      customer_email: data.purchaser_email,
      line_items: [
        {
          price_data: {
            currency: "usd",
            product_data: {
              name: `The Card Doc Gift Card — $${amountDollars}`,
              description: "Redeemable on any card restoration order at thecarddoc1.com",
            },
            unit_amount: data.amount_cents,
          },
          quantity: 1,
        },
      ],
      // Payment methods come from the Stripe Dashboard. Klarna's and Afterpay's
      // rules forbid selling gift cards with them, so this page never offers
      // them, even when they are switched on for orders and kits
      // (docs/payments/turn-on-payment-methods.md)
      excluded_payment_method_types: ["klarna", "afterpay_clearpay"],
      // The success page reads the session for the Meta Purchase event; the
      // page's first script takes the ID out of the address (lib/tracking-guard.ts)
      success_url: `${appUrl}/gift-cards/success?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${appUrl}/gift-cards`,
      metadata: {
        type: "gift_card",
        amount_cents: String(data.amount_cents),
        purchaser_name: data.purchaser_name,
        purchaser_email: data.purchaser_email,
        recipient_name: data.recipient_name,
        recipient_email: data.recipient_email,
        personal_message: data.personal_message ?? "",
      },
    });
  } catch (err) {
    console.error("Gift card Stripe session creation failed:", err);
    const ref = `PAYMENT_SETUP_FAILED-${Date.now().toString(36).toUpperCase()}`;
    await logCheckoutError({
      ref,
      timestamp: new Date().toISOString(),
      code: "PAYMENT_SETUP_FAILED",
      actual_error: `Gift card checkout: ${err instanceof Error ? err.message : String(err)}`,
      customer_name: data.purchaser_name,
      customer_email: data.purchaser_email,
      user_agent: req.headers.get("user-agent") ?? undefined,
    });
    return Response.json({
      error: "Payment setup failed. Please try again. If this keeps happening, DM @the_card_doc on Instagram.",
      code: "PAYMENT_SETUP_FAILED",
      ref,
    }, { status: 500 });
  }

  return Response.json({ url: session.url });
}
