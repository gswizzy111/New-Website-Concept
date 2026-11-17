import Link from "next/link";
import { cookies } from "next/headers";
import { OpenFileButton } from "@/components/open-file-button";
import { PurchasePixel } from "@/components/purchase-pixel";
import { createAdminClient } from "@/lib/supabase/admin";
import { stripe } from "@/lib/stripe";
import { CHECKOUT_SESSION_COOKIE, CHECKOUT_SESSION_ID } from "@/lib/tracking-guard";
import { ArrowRight, Check, Package } from "lucide-react";
import { cta } from "@/components/brand";

export default async function CheckoutSuccessPage({
  searchParams,
}: {
  searchParams: Promise<{ session_id?: string }>;
}) {
  // Stripe adds ?session_id=; the first script on the page then takes it out
  // of the address (analytics must never see it) and keeps it in a cookie for
  // this page, so a reload still finds the order (lib/tracking-guard.ts)
  const fromUrl = (await searchParams).session_id;
  const candidate = fromUrl ?? (await cookies()).get(CHECKOUT_SESSION_COOKIE)?.value;
  const session_id = candidate && CHECKOUT_SESSION_ID.test(candidate) ? candidate : undefined;
  let order: {
    id: string;
    order_number: string | number;
    customer_email: string;
    inbound_method: string;
    shipping_label_url: string | null;
  } | null = null;
  let amountTotal: number | null = null;
  let currency = "usd";

  if (session_id) {
    const admin = createAdminClient();

    // Run Supabase lookup and Stripe session fetch in parallel
    const [bySessionResult, stripeResult] = await Promise.allSettled([
      admin
        .from("orders")
        .select("id, order_number, customer_email, inbound_method, shipping_label_url")
        .eq("stripe_session_id", session_id)
        .maybeSingle(),
      stripe.checkout.sessions.retrieve(session_id),
    ]);

    const bySession = bySessionResult.status === "fulfilled" ? bySessionResult.value.data : null;
    const stripeSession = stripeResult.status === "fulfilled" ? stripeResult.value : null;

    // Only a completed checkout is a purchase
    if (stripeSession?.status === "complete" && stripeSession.amount_total != null) {
      amountTotal = stripeSession.amount_total;
      currency = stripeSession.currency ?? "usd";
    }

    if (bySession) {
      order = bySession;
    } else if (stripeSession) {
      // Fallback: use order_id from Stripe metadata
      const orderId = stripeSession.metadata?.order_id;
      if (orderId) {
        const { data: byId } = await admin
          .from("orders")
          .select("id, order_number, customer_email, inbound_method, shipping_label_url")
          .eq("id", orderId)
          .maybeSingle();
        if (byId) order = byId;

        // Opportunistically save the stripe_session_id for future lookups
        if (byId) {
          await admin
            .from("orders")
            .update({ stripe_session_id: session_id })
            .eq("id", orderId)
            .is("stripe_session_id", null);
        }
      }
    }
  }

  return (
    <section className="surface-cobalt relative isolate flex min-h-[70vh] flex-1 items-center overflow-hidden">
      <PurchasePixel sessionId={session_id} amountCents={amountTotal} currency={currency} orderId={order?.id} />
      <span aria-hidden className="halftone-dots -right-[10%] -top-[20%] h-[130%] w-[64%]" />
      <span aria-hidden className="halftone-dots -bottom-[30%] -left-[16%] h-[80%] w-[50%] opacity-70" />
      <div
        className={
          order
            ? "wrap grid items-center gap-x-16 gap-y-12 py-16 md:py-24 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,0.9fr)]"
            : "wrap py-20 md:py-28"
        }
      >
        <div className={order ? "min-w-0 text-center lg:text-left" : "min-w-0 text-center"}>
          <span
            aria-hidden
            className={`sticker-pop mx-auto grid size-20 place-items-center rounded-full bg-sun text-ink shadow-[0_0_0_4px_var(--white),var(--pop-shadow)] md:size-24 ${order ? "lg:mx-0" : ""}`}
            style={{ ["--d" as string]: 120 }}
          >
            <Check className="size-10 md:size-12" strokeWidth={3} />
          </span>
          <h1 className="hero-in display-lg mt-9 text-white" style={{ ["--d" as string]: 200 }}>
            Order Confirmed!
          </h1>
          {order?.order_number ? (
            <p className="hero-in mt-6 inline-flex items-center gap-3 rounded-full bg-ink/35 py-2 pr-5 pl-2 text-[15px] font-bold text-white shadow-[inset_0_0_0_1px_rgba(255,255,255,0.22)]" style={{ ["--d" as string]: 280 }}>
              <span className="rounded-full bg-sun px-3 py-1 text-ink">Order</span>
              <span className="font-display text-[22px] font-black tracking-[0.02em] tabular-nums">#{order.order_number}</span>
            </p>
          ) : (
            <p className="hero-in mt-6 text-[17px] font-bold text-white" style={{ ["--d" as string]: 280 }}>
              Your payment was received successfully.
            </p>
          )}
          <p className={`hero-in lead mx-auto mt-5 text-[#e6ebff] ${order ? "lg:mx-0" : ""}`} style={{ ["--d" as string]: 340 }}>
            Thank you! We&apos;ll send confirmation to your email with next steps.
          </p>
          {!order && (
            <div className="hero-in mt-10 flex justify-center" style={{ ["--d" as string]: 400 }}>
              <Link href="/" className={cta({ size: "lg" })}>
                Back to Home
                <ArrowRight aria-hidden className="size-5" strokeWidth={2} />
              </Link>
            </div>
          )}
        </div>

        {order && (
        <div className="hero-in panel min-w-0 p-6 md:p-8" style={{ ["--d" as string]: 380 }}>
          {order.inbound_method === "buy_label" && (
            <div className="mb-7 rounded-[18px] bg-cobalt-wash p-5 md:p-6">
              <p className="mb-2 flex items-center gap-2.5 text-[16px] font-bold text-ink">
                <span aria-hidden className="grid size-8 place-items-center rounded-full bg-white text-cobalt">
                  <Package className="size-4" strokeWidth={2} />
                </span>
                Your prepaid shipping label
              </p>
              {order.shipping_label_url ? (
                <>
                  <p className="mb-5 text-[15px] leading-relaxed text-ink-soft">
                    Print this label, attach it to your package, and drop it off at the carrier.
                  </p>
                  {/* A button, not a link: analytics runs on this page (components/open-file-button.tsx) */}
                  <OpenFileButton
                    url={order.shipping_label_url}
                    className={cta({ tone: "cobalt", size: "sm", className: "cursor-pointer" })}
                  >
                    Download Label (PDF)
                  </OpenFileButton>
                </>
              ) : (
                <p className="text-[15px] leading-relaxed text-ink-soft">
                  Your label is being generated — check your order tracking page in a moment.
                </p>
              )}
            </div>
          )}

          <div className="flex w-full flex-col gap-3.5">
            {order.order_number && (
              <Link href={`/orders/${order.order_number}`} className={cta({ size: "lg", className: "w-full" })}>
                Track Your Order
                <ArrowRight aria-hidden className="size-5" strokeWidth={2} />
              </Link>
            )}
            <Link
              href="/"
              className={cta({ tone: order.order_number ? "outline" : "ink", size: "lg", className: "w-full" })}
            >
              Back to Home
            </Link>
          </div>
        </div>
        )}
      </div>
    </section>
  );
}
