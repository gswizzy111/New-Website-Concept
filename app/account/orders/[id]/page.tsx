import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { shippo } from "@/lib/shippo";
import { redirect, notFound } from "next/navigation";
import { formatCurrency } from "@/lib/utils";
import { ORDER_STATUSES, STATUS_TIMELINE } from "@/lib/constants";
import type { OrderStatus } from "@/lib/constants";
import Link from "next/link";
import { LogoutButton } from "../../logout-button";
import { CardEditor } from "./card-editor";
import { UpdateRequestPanel } from "@/components/account/update-request-panel";
import { getUpdateRequestState } from "@/lib/order-update-requests";
import { trackingLink } from "@/lib/tracking-carrier";
import { OpenFileButton } from "@/components/open-file-button";
import { ArrowLeft, Download } from "lucide-react";
import { Eyebrow, PAGE_TITLE, PANEL, PANEL_LABEL, PANEL_TITLE, PortalHeader, StatusPill, StatusTrack, TrackingPanel } from "@/components/account/portal";
import { cta } from "@/components/brand";

export const dynamic = "force-dynamic";

const STATUS_TONE: Record<string, "ink" | "cobalt" | "sun" | "success" | "danger" | "muted" | "wash"> = {
  awaiting_cards:  "sun",
  received:        "wash",
  in_progress:     "cobalt",
  completed:       "success",
  shipped_back:    "ink",
  delivered:       "success",
  cancelled:       "danger",
};

function shippoCarrierToken(carrier: string) {
  const map: Record<string, string> = {
    USPS: "usps", FedEx: "fedex", UPS: "ups", DHL: "dhl", DHLExpress: "dhl_express",
  };
  return map[carrier] ?? carrier.toLowerCase().replace(/\s+/g, "_");
}

export default async function AccountOrderPage({
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
    .from("orders")
    .select("*")
    .eq("id", id)
    .single();

  if (!order) notFound();
  if (order.customer_email?.toLowerCase() !== user.email?.toLowerCase()) notFound();

  const [cardsResult, servicesResult, updateState] = await Promise.all([
    admin.from("cards").select("*").eq("order_id", id).order("created_at"),
    admin.from("order_services").select("*").eq("order_id", id),
    getUpdateRequestState(admin, String(order.order_number)),
  ]);

  const canAsk = !["cancelled", "awaiting_payment"].includes(order.status);

  const cards = (cardsResult.data ?? []) as Array<{
    id: string;
    card_name: string;
    card_set: string | null;
    card_year: string | null;
    card_number: string | null;
    estimated_value_cents: number | null;
    notes: string | null;
    photo_urls: string[];
  }>;
  const services = servicesResult.data ?? [];

  // Check Shippo inbound tracking to determine lock status
  let locked = false;
  let lockReason: string | undefined;

  // Also show inbound tracking info while awaiting
  let inboundStatus: string | null = null;
  let inboundDetails: string | null = null;

  if (order.inbound_tracking_number) {
    try {
      const track = await shippo.trackingStatus.get(
        order.inbound_tracking_number,
        order.inbound_carrier ? shippoCarrierToken(order.inbound_carrier) : "usps"
      );
      const st = track.trackingStatus?.status ?? "UNKNOWN";
      inboundStatus = st;
      inboundDetails = track.trackingStatus?.statusDetails ?? null;

      if (["TRANSIT", "DELIVERED", "RETURNED", "FAILURE"].includes(st)) {
        locked = true;
        lockReason = "Your package has been picked up by the carrier and is on its way to us. Card details are now locked.";
      }
    } catch {
      // fail open
    }
  }

  // Also lock if order has moved past awaiting_cards
  if (!["awaiting_cards"].includes(order.status)) {
    locked = true;
    if (!lockReason) {
      lockReason = order.status === "received"
        ? "We've received your cards — editing is no longer available."
        : "This order is no longer editable.";
    }
  }

  const canEdit = !locked && order.status === "awaiting_cards";

  const orderLabel = /^\d+$/.test(String(order.order_number))
    ? `R${order.order_number}`
    : String(order.order_number);

  const visibleStatuses = STATUS_TIMELINE.filter((s) => s !== "awaiting_payment");
  const currentIndex = STATUS_TIMELINE.indexOf(order.status as OrderStatus);

  return (
    <div className="surface-chalk min-h-screen">
      <PortalHeader>
        <Link href="/account" className="inline-flex min-h-11 items-center gap-1.5 rounded-full px-3 text-sm font-bold text-ink-soft transition-colors hover:bg-chalk hover:text-ink">
          <ArrowLeft aria-hidden className="size-4" strokeWidth={2.25} />
          My Orders
        </Link>
        <span className="hidden max-w-[22ch] truncate text-sm text-ink-soft lg:block">{user.email}</span>
        <LogoutButton />
      </PortalHeader>

      <div className="mx-auto flex max-w-5xl flex-col gap-8 px-4 py-10 sm:px-6 md:py-14">
        {/* Order header */}
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <Eyebrow>Restoration Order</Eyebrow>
            <h1 className={PAGE_TITLE}>{orderLabel}</h1>
            <p className="mt-2 text-[15px] text-ink-soft">
              Placed {new Date(order.created_at).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })}
            </p>
          </div>
          <StatusPill tone={STATUS_TONE[order.status] ?? "muted"} className="min-h-9 px-4 text-sm">
            {ORDER_STATUSES[order.status as OrderStatus]?.label ?? order.status}
          </StatusPill>
        </div>

        <div className="grid grid-cols-1 gap-6 lg:grid-cols-[320px_minmax(0,1fr)]">
          {/* Left column — status + tracking */}
          <div className="flex flex-col gap-5">
            {/* Status timeline */}
            <div className={PANEL}>
              <h2 className={PANEL_LABEL}>Status</h2>
              <StatusTrack
                size="sm"
                steps={visibleStatuses.map((s) => {
                  const sIndex = STATUS_TIMELINE.indexOf(s);
                  return { key: s, label: ORDER_STATUSES[s]?.label, state: s === order.status ? "current" : sIndex < currentIndex ? "done" : "next" };
                })}
              />
            </div>

            {/* Request an update (once a week) */}
            {canAsk && (
              <UpdateRequestPanel
                endpoint={`/api/account/orders/${id}/inquiry`}
                email={order.customer_email}
                askedAt={updateState.askedAt}
                nextAllowedAt={updateState.nextAllowedAt}
                lastReply={updateState.lastReply}
                subject="card"
              />
            )}

            {/* Inbound tracking */}
            {order.inbound_tracking_number && (
              <div className={`${PANEL} bg-cobalt-wash shadow-none`}>
                <p className={`${PANEL_LABEL} mb-2 text-cobalt-deep`}>Inbound Tracking</p>
                {inboundStatus && (
                  <StatusPill tone={inboundStatus === "TRANSIT" ? "cobalt" : inboundStatus === "DELIVERED" ? "success" : "muted"} className="mb-2">
                    {inboundStatus === "TRANSIT" ? "In Transit" :
                     inboundStatus === "DELIVERED" ? "Delivered" :
                     inboundStatus === "UNKNOWN" || inboundStatus === "PRE_TRANSIT" ? "Label Created" :
                     inboundStatus}
                  </StatusPill>
                )}
                {inboundDetails && <p className="mb-2 text-sm text-ink">{inboundDetails}</p>}
                <p className="font-mono text-sm font-bold break-all text-cobalt-deep">{order.inbound_tracking_number}</p>
              </div>
            )}

            {/* Prepaid label download */}
            {order.inbound_method === "buy_label" && order.shipping_label_url && (
              <div className={PANEL}>
                <h2 className={`${PANEL_LABEL} mb-2`}>Shipping Label</h2>
                <p className="mb-4 text-sm text-ink-soft">Print and attach to your package.</p>
                {/* A button, not a link: analytics runs on this page (components/open-file-button.tsx) */}
                <OpenFileButton
                  url={order.shipping_label_url}
                  className={cta({ tone: "sun", size: "sm", className: "w-full" })}
                >
                  <Download aria-hidden className="size-4" strokeWidth={2.25} />
                  Download Label (PDF)
                </OpenFileButton>
              </div>
            )}

            {/* Return tracking */}
            {order.tracking_number && (
              <TrackingPanel
                label="Return Tracking"
                number={order.tracking_number}
                href={order.outbound_tracking_number === order.tracking_number
                  ? trackingLink(order.tracking_number, order.outbound_carrier ?? null, order.outbound_tracking_url ?? null)
                  : trackingLink(order.tracking_number)}
              />
            )}

            {/* Order summary */}
            <div className={PANEL}>
              <h2 className={PANEL_LABEL}>Order Summary</h2>
              <div className="flex flex-col gap-2 text-sm">
                {(services as { id: string; service_name: string; quantity: number; price_cents: number }[]).map((s) => (
                  <div key={s.id} className="flex justify-between gap-3">
                    <span className="text-ink-soft">{s.service_name} × {s.quantity}</span>
                    <span className="font-semibold">{formatCurrency(s.price_cents * s.quantity)}</span>
                  </div>
                ))}
                {order.total_cents && (
                  <div className="mt-2 flex items-baseline justify-between border-t-2 border-ink pt-3 font-heading text-[1.6rem] leading-none font-black">
                    <span>Total</span>
                    <span>{formatCurrency(order.total_cents)}</span>
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* Right column — cards */}
          <div className="flex min-w-0 flex-col gap-5">
            {/* Restoration results */}
            {(order.restoration_photos?.length > 0 || order.completion_notes) && (
              <div className={PANEL}>
                <h2 className={`${PANEL_TITLE} mb-5`}>Restoration Results</h2>
                {order.completion_notes && (
                  <div className="mb-5 rounded-[14px] bg-sun-tint p-4">
                    <p className="label-caps mb-2 text-[15px] text-ink">Notes from The Card Doc</p>
                    <p className="text-[15px] whitespace-pre-wrap text-ink">{order.completion_notes}</p>
                  </div>
                )}
                {order.restoration_photos?.length > 0 && (
                  <div className="flex flex-wrap gap-4">
                    {(order.restoration_photos as string[]).map((url: string, i: number) => (
                      <a key={i} href={url} target="_blank" rel="noopener noreferrer" className="print print-sm print-lift block w-28" style={{ ["--tilt" as string]: `${i % 2 ? 2 : -2}deg` }}>
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src={url} alt="Restored card" className="aspect-[3/4] w-full rounded-[3px] object-cover" />
                      </a>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* Card editor */}
            <div className={PANEL}>
              <h2 className={`${PANEL_TITLE} mb-5`}>
                Your Cards ({cards.length})
              </h2>
              <CardEditor
                orderId={id}
                initialCards={cards.map((c) => ({ ...c, photo_urls: c.photo_urls ?? [] }))}
                locked={locked}
                lockReason={lockReason}
              />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
