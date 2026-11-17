import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { redirect, notFound } from "next/navigation";
import { formatCurrency } from "@/lib/utils";
import Link from "next/link";
import { LogoutButton } from "../../logout-button";
import { SubscriptionCancelButton } from "./subscription-cancel-button";
import { UpdateRequestPanel } from "@/components/account/update-request-panel";
import { getUpdateRequestState } from "@/lib/order-update-requests";
import { likeExact } from "@/lib/like-exact";
import { ArrowLeft } from "lucide-react";
import { Eyebrow, PAGE_TITLE, PANEL, PANEL_LABEL, PANEL_TITLE, PORTAL_LINK, PortalHeader, StatusPill, StatusTrack, TrackingPanel } from "@/components/account/portal";

export const dynamic = "force-dynamic";

const CARRIER_URLS: Record<string, (n: string) => string> = {
  USPS:  (n) => `https://tools.usps.com/go/TrackConfirmAction?tLabels=${n}`,
  UPS:   (n) => `https://www.ups.com/track?tracknum=${n}`,
  FedEx: (n) => `https://www.fedex.com/apps/fedextrack/?tracknumbers=${n}`,
  DHL:   (n) => `https://www.dhl.com/en/express/tracking.html?AWB=${n}`,
};

function getTrackUrl(carrier: string | null, tracking: string) {
  if (!carrier) return `https://parcelsapp.com/en/tracking/${tracking}`;
  const fn = CARRIER_URLS[carrier];
  return fn ? fn(tracking) : `https://parcelsapp.com/en/tracking/${tracking}`;
}

const STATUS_TIMELINE = ["paid", "processing", "shipped", "delivered"];
const STATUS_LABELS: Record<string, string> = {
  paid: "Order Received", processing: "Processing", shipped: "Shipped", delivered: "Delivered",
};
const STATUS_TONE: Record<string, "ink" | "cobalt" | "sun" | "success" | "danger" | "muted" | "wash"> = {
  paid:       "wash",
  processing: "sun",
  shipped:    "ink",
  delivered:  "success",
  cancelled:  "danger",
};

type ShopItem = { product_name: string; quantity: number; price_cents: number };

export default async function KitOrderPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/account/login");

  const admin = createAdminClient();
  const { data: order } = await admin
    .from("shop_orders")
    .select("*")
    .eq("id", id)
    .single();

  if (!order) notFound();
  if (order.customer_email?.toLowerCase() !== user.email?.toLowerCase()) notFound();

  const items = (order.items ?? []) as ShopItem[];
  const isSubscription = items.some((i: ShopItem) => i.product_name?.toLowerCase().includes("subscription"));

  // Check if customer has an active subscription (independent of kit order status)
  const { data: activeSub } = await admin
    .from("subscriptions")
    .select("id")
    .ilike("customer_email", likeExact(user.email!))
    .eq("status", "active")
    .maybeSingle();
  const hasActiveSub = !!activeSub;

  const updateState = await getUpdateRequestState(admin, `K${order.order_number}`);

  const currentIdx = STATUS_TIMELINE.indexOf(order.status);
  const trackUrl = order.tracking_number
    ? getTrackUrl((order as any).carrier ?? null, order.tracking_number)
    : null;

  return (
    <div className="surface-chalk min-h-screen">
      <PortalHeader width="max-w-3xl">
        <Link href="/account" className="inline-flex min-h-11 items-center gap-1.5 rounded-full px-3 text-sm font-bold text-ink-soft transition-colors hover:bg-chalk hover:text-ink">
          <ArrowLeft aria-hidden className="size-4" strokeWidth={2.25} />
          My Orders
        </Link>
        <span className="hidden max-w-[22ch] truncate text-sm text-ink-soft lg:block">{user.email}</span>
        <LogoutButton />
      </PortalHeader>

      <div className="mx-auto flex max-w-3xl flex-col gap-6 px-4 py-10 sm:px-6 md:py-14">
        {/* Header */}
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <Eyebrow>Kit Order</Eyebrow>
            <h1 className={PAGE_TITLE}>
              {order.order_number ? `K${order.order_number}` : "Order"}
            </h1>
            <p className="mt-2 text-[15px] text-ink-soft">
              Placed {new Date(order.created_at).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })}
            </p>
          </div>
          <StatusPill tone={STATUS_TONE[order.status] ?? "muted"} className="min-h-9 px-4 text-sm">
            {STATUS_LABELS[order.status] ?? order.status}
          </StatusPill>
        </div>

        <div className="grid gap-6 sm:grid-cols-2">
        {/* Status timeline */}
        {order.status !== "cancelled" && (
          <div className={PANEL}>
            <h2 className={PANEL_LABEL}>Status</h2>
            <StatusTrack
              steps={STATUS_TIMELINE.map((s) => {
                const sIdx = STATUS_TIMELINE.indexOf(s);
                return { key: s, label: STATUS_LABELS[s], state: s === order.status ? "current" : sIdx < currentIdx ? "done" : "next" };
              })}
            />
          </div>
        )}

        {/* Request an update (once a week) */}
        {order.status !== "cancelled" && (
          <UpdateRequestPanel
            endpoint={`/api/account/kit-orders/${order.id}/update-request`}
            email={order.customer_email}
            askedAt={updateState.askedAt}
            nextAllowedAt={updateState.nextAllowedAt}
            lastReply={updateState.lastReply}
            subject="kit order"
          />
        )}
        </div>

        {/* Tracking */}
        {order.tracking_number && trackUrl && (
          <TrackingPanel
            label="Shipment Tracking"
            number={order.tracking_number}
            href={trackUrl}
            chip={(order as any).carrier ? <StatusPill tone="sun">{(order as any).carrier}</StatusPill> : null}
          />
        )}

        {/* Order summary */}
        <div className={PANEL}>
          <h2 className={`${PANEL_TITLE} mb-5`}>Order Summary</h2>
          <div className="flex flex-col gap-2 text-[15px]">
            {items.map((item, i) => (
              <div key={i} className="flex justify-between gap-3">
                <span className="text-ink-soft">{item.product_name} × {item.quantity}</span>
                <span className="font-semibold">{formatCurrency(item.price_cents * item.quantity)}</span>
              </div>
            ))}
            <div className="mt-2 flex items-baseline justify-between border-t-2 border-ink pt-3 font-heading text-[1.75rem] leading-none font-black">
              <span>Total</span>
              <span>{formatCurrency(order.total_cents)}</span>
            </div>
          </div>
        </div>

        {/* Subscription cancel */}
        {isSubscription && hasActiveSub && (
          <div className={PANEL}>
            <h2 className={`${PANEL_TITLE} mb-2`}>Manage Subscription</h2>
            <p className="mb-5 text-[15px] text-ink-soft">
              Need to cancel your Monthly Kit Club subscription? This will stop future billing immediately.
            </p>
            <SubscriptionCancelButton />
          </div>
        )}

        <p className="text-center text-sm text-ink-soft">
          Questions?{" "}
          <a href="https://www.instagram.com/the_card_doc" target="_blank" rel="noopener noreferrer" className={PORTAL_LINK}>
            DM us on Instagram
          </a>
        </p>
      </div>
    </div>
  );
}
