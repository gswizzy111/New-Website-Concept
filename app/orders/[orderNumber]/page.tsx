import { createAdminClient } from "@/lib/supabase/admin";
import { SignedAgreements, type SignedAgreement } from "@/components/agreements/signed-agreements";
import { shippo } from "@/lib/shippo";
import { ORDER_STATUSES, STATUS_TIMELINE, type OrderStatus } from "@/lib/constants";
import { formatCurrency } from "@/lib/utils";
import Link from "next/link";
import { redirect } from "next/navigation";
import type { Track } from "shippo/models/components";
import { UpgradeSection } from "./upgrade-section";
import { AddCardsSection } from "./add-cards-section";
import type { RestorationTierId } from "@/lib/restoration-tiers";
import { ReportProblem } from "@/components/orders/report-problem";
import { FileDown } from "lucide-react";
import { trackingCarrier, trackingLink } from "@/lib/tracking-carrier";
import { hasUnappliedUpgrade } from "@/lib/pending-upgrade";
import { Download } from "lucide-react";
import { Eyebrow, PAGE_TITLE, PANEL, PANEL_TITLE, PORTAL_LINK, PortalHeader, StatusPill, StatusTrack, TrackingPanel } from "@/components/account/portal";
import { cta } from "@/components/brand";

/** The page frame: the slim header, then the column on chalk. */
function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="surface-chalk min-h-screen">
      <PortalHeader width="max-w-3xl" label="Order Tracking" />
      <div className="mx-auto flex max-w-3xl flex-col gap-5 px-4 py-10 sm:px-6 md:py-14">{children}</div>
    </div>
  );
}

function EmailMismatch() {
  return (
    <div className="surface-chalk flex min-h-screen flex-col">
      <PortalHeader width="max-w-3xl" />
      <div className="flex flex-1 items-center px-4 py-16">
        <div className={`${PANEL} mx-auto w-full max-w-md p-8 text-center sm:p-10`}>
          <Eyebrow>Order Tracking</Eyebrow>
          <h1 className="mb-3 font-heading text-[2.25rem] leading-[0.95] font-black text-ink">We couldn&apos;t find that order</h1>
          <p className="mb-8 text-[15px] text-ink-soft">
            The order number and email address didn&apos;t match. Double-check both and try again.
          </p>
          <Link href="/track" className={cta({ tone: "sun", size: "md" })}>
            Try Again
          </Link>
        </div>
      </div>
    </div>
  );
}

function shippoCarrierToken(provider: string): string {
  const map: Record<string, string> = {
    USPS: "usps",
    FedEx: "fedex",
    UPS: "ups",
    DHLExpress: "dhl_express",
    "DHL Express": "dhl_express",
    DHL: "dhl",
    Canada: "canadapost",
    CanadaPost: "canadapost",
  };
  return map[provider] ?? provider.toLowerCase().replace(/\s+/g, "_");
}

const TRACKING_BADGE: Record<string, { label: string; tone: "ink" | "cobalt" | "sun" | "success" | "danger" | "muted" }> = {
  UNKNOWN:     { label: "Label Created",  tone: "muted" },
  PRE_TRANSIT: { label: "Label Created",  tone: "muted" },
  TRANSIT:     { label: "In Transit",     tone: "cobalt" },
  DELIVERED:   { label: "Delivered",      tone: "success" },
  RETURNED:    { label: "Returned",       tone: "sun" },
  FAILURE:     { label: "Delivery Issue", tone: "danger" },
};

const KIT_STATUS_LABELS: Record<string, string> = {
  paid:       "Order Received",
  processing: "Processing",
  shipped:    "Shipped",
  delivered:  "Delivered",
};
const KIT_STATUS_TIMELINE = ["paid", "processing", "shipped", "delivered"];

type ShopOrderItem = { product_name: string; quantity: number; price_cents: number };

async function KitOrderView({ kitNumber, email }: { kitNumber: string; email: string }) {
  const admin = createAdminClient();
  const kitNum = parseInt(kitNumber, 10);
  const { data: order } = await admin
    .from("shop_orders")
    .select("*")
    .eq("order_number", isNaN(kitNum) ? kitNumber : kitNum)
    .single();

  if (!order) return <EmailMismatch />;
  // Only block if the order has an email recorded and it doesn't match
  if (order.customer_email && order.customer_email.trim().toLowerCase() !== email) {
    return <EmailMismatch />;
  }

  // The kit label's carrier: the one saved with it, else told from the number
  const kitLabels = Array.isArray(order.labels) ? (order.labels as { trackingNumber?: string | null; trackingUrl?: string | null; carrier?: string | null }[]) : [];
  const kitLabel = kitLabels.find((l) => l?.trackingNumber === order.tracking_number) ?? null;
  const kitCarrier = order.tracking_number ? trackingCarrier(order.tracking_number, order.carrier ?? kitLabel?.carrier ?? null) : null;
  const kitTrackUrl = order.tracking_number ? trackingLink(order.tracking_number, order.carrier ?? kitLabel?.carrier ?? null, kitLabel?.trackingUrl ?? null) : null;

  // A cancelled kit (admin Cancel & Refund) has no delivery to follow
  const kitCancelled = order.status === "cancelled";
  const kitRefundedCents = Number(order.refunded_cents ?? 0);

  // Check Shippo for live tracking and opportunistically update DB status
  let liveShippoStatus: string | null = null;
  if (order.tracking_number && order.status !== "delivered" && !kitCancelled && kitCarrier) {
    try {
      const track = await shippo.trackingStatus.get(order.tracking_number, kitCarrier.token);
      liveShippoStatus = track.trackingStatus?.status ?? null;

      // Update DB status if Shippo reports a further-along state. Only an open
      // order moves (never a cancelled one), checked again in the update
      const DELIVERABLE = ["paid", "processing", "shipped"];
      if (liveShippoStatus === "DELIVERED" && DELIVERABLE.includes(order.status)) {
        const { data: moved } = await admin.from("shop_orders").update({ status: "delivered" }).eq("id", order.id).in("status", DELIVERABLE).select("id");
        if (moved?.length) order.status = "delivered";
      } else if (
        (liveShippoStatus === "TRANSIT" || liveShippoStatus === "PRE_TRANSIT") &&
        order.status === "processing"
      ) {
        const { data: moved } = await admin.from("shop_orders").update({ status: "shipped" }).eq("id", order.id).eq("status", "processing").select("id");
        if (moved?.length) order.status = "shipped";
      }
    } catch {
      // fail silently
    }
  }

  const items = (order.items ?? []) as ShopOrderItem[];
  const currentIdx = KIT_STATUS_TIMELINE.indexOf(order.status);

  return (
    <Shell>
      <div className="mb-3">
        <Eyebrow>Order Tracking</Eyebrow>
        <h1 className={PAGE_TITLE}>Order K{order.order_number}</h1>
        <p className="mt-2 text-[15px] text-ink-soft">Placed {new Date(order.created_at).toLocaleDateString()}</p>
      </div>

      <div className={PANEL}>
        <h2 className={`${PANEL_TITLE} mb-5`}>Status</h2>
        {kitCancelled ? (
          <div className="flex flex-col gap-1 text-sm">
            <p className="font-bold text-foreground">This order was cancelled.</p>
            {kitRefundedCents > 0 && (
              <p className="text-muted-foreground">A refund of {formatCurrency(kitRefundedCents)} was issued.</p>
            )}
          </div>
        ) : (
          <StatusTrack
            steps={KIT_STATUS_TIMELINE.map((s) => {
              const sIdx = KIT_STATUS_TIMELINE.indexOf(s);
              return { key: s, label: KIT_STATUS_LABELS[s], state: s === order.status ? "current" : sIdx < currentIdx ? "done" : "next" };
            })}
          />
        )}
      </div>

      {order.tracking_number && (
        <TrackingPanel label="Shipment Tracking" number={order.tracking_number} href={kitTrackUrl} />
      )}

      <div className={PANEL}>
        <h2 className={`${PANEL_TITLE} mb-5`}>Order Summary</h2>
        <div className="flex flex-col gap-2 text-[15px]">
          {items.map((item, i) => (
            <div key={i} className="flex justify-between">
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

      {!kitCancelled && <ReportProblem orderRef={`K${order.order_number}`} email={email} />}

      <p className="text-center text-sm text-ink-soft">
        Questions? DM us on Instagram{" "}
        <a href="https://www.instagram.com/the_card_doc" target="_blank" rel="noopener noreferrer" className={PORTAL_LINK}>
          @the_card_doc
        </a>
      </p>
    </Shell>
  );
}

export default async function OrderDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ orderNumber: string }>;
  searchParams: Promise<{ email?: string; added?: string; upgraded?: string }>;
}) {
  const { orderNumber } = await params;
  const { email: rawEmail, added, upgraded } = await searchParams;
  const email = (rawEmail ?? "").trim().toLowerCase();

  // No email in URL — customer likely came from an old confirmation email link.
  // Redirect to the track page with the order number pre-filled.
  if (!email) redirect(`/track?order=${encodeURIComponent(orderNumber)}`);

  // Normalize: strip optional leading R, then detect K (kit) vs restoration
  let cleaned = orderNumber;
  if (cleaned.startsWith("R")) cleaned = cleaned.slice(1); // RCD-1209 → CD-1209, R1209 → 1209, RK5 → K5

  // Kit orders
  if (cleaned.startsWith("K")) {
    return <KitOrderView kitNumber={cleaned.slice(1)} email={email} />;
  }

  // Strip CD- or CD prefix to isolate the numeric part
  let numericPart = cleaned;
  if (numericPart.startsWith("CD-")) numericPart = numericPart.slice(3);
  else if (numericPart.startsWith("CD")) numericPart = numericPart.slice(2);
  // numericPart is now just the number, e.g. "1209"

  const admin = createAdminClient();
  const num = parseInt(numericPart, 10);

  // Search DB with every likely stored format
  const candidates: (string | number)[] = [
    `CD-${numericPart}`,                   // "CD-1209" — legacy string in DB
    numericPart,                           // "1209"    — plain string
    ...(isNaN(num) ? [] : [num]),          //  1209     — integer serial
  ];

  let order: Record<string, any> | null = null;
  for (const candidate of [...new Set(candidates)]) {
    const { data } = await admin.from("orders").select("*").eq("order_number", candidate).maybeSingle();
    if (data) { order = data; break; }
  }

  if (!order) return <EmailMismatch />;
  // Only block if the order has an email recorded and it doesn't match
  if (order.customer_email && order.customer_email.trim().toLowerCase() !== email) {
    return <EmailMismatch />;
  }

  // A paid upgrade not on the order yet (asked of Stripe while the rest loads;
  // null when Stripe didn't answer in time)
  const unappliedUpgrade: Promise<boolean | null> = order.status === "awaiting_cards"
    ? hasUnappliedUpgrade({ id: order.id, customer_email: order.customer_email, restoration_tier: order.restoration_tier })
    : Promise.resolve(false);

  const { data: cards } = await admin.from("cards").select("*").eq("order_id", order.id);
  // The customer's copy of what they signed; a high-value agreement shows once its card is on the order
  const { data: signedRows } = await admin
    .from("order_agreements")
    .select("id, kind, version, signer_name, signed_at, card_name, declared_value_cents, cards, agreement_text")
    .eq("order_id", order.id)
    .order("signed_at");
  const cardNames = new Set((cards ?? []).map((c) => String(c.card_name).trim()));
  const signedAgreements = ((signedRows ?? []) as SignedAgreement[]).filter((a) => a.kind !== "high_value" || cardNames.has(a.card_name ?? ""));
  const { data: services } = await admin.from("order_services").select("*").eq("order_id", order.id);
  // Documents signed under the Terms of Service v1.0 and later
  const { data: signatures } = await admin.from("signatures").select("id, type, document_title, typed_full_name, signed_at, card_snapshot").eq("order_id", order.id).order("signed_at");
  const docUrl = (id: string) => `/api/orders/${encodeURIComponent(String(order.order_number))}/documents/${id}?email=${encodeURIComponent(email)}`;
  const signedDate = (iso: string) => new Date(iso).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric", timeZone: "America/New_York" });

  // Fetch live inbound tracking from Shippo (only while awaiting cards)
  let inboundTrack: Track | null = null;
  if (
    order.inbound_tracking_number &&
    order.inbound_carrier &&
    (order.status === "awaiting_cards" || order.status === "received")
  ) {
    try {
      inboundTrack = await shippo.trackingStatus.get(
        order.inbound_tracking_number,
        shippoCarrierToken(order.inbound_carrier)
      );
    } catch {
      // fail silently — don't break the page
    }
  }

  const currentIndex = STATUS_TIMELINE.indexOf(order.status as OrderStatus);
  const visibleStatuses = STATUS_TIMELINE.filter(s => s !== "awaiting_payment");
  // A paid upgrade not recorded yet: no upgrade is offered until the order
  // shows it, so it can't be paid twice. Just back from paying (upgraded=1)
  // counts only when Stripe can't say, so the address doesn't hide the offers
  // for good once the webhook has run
  const pendingUpgrade = await unappliedUpgrade;
  const showUpgradeReceived = upgraded === "1" || pendingUpgrade === true;
  const hideUpgradeOffer = pendingUpgrade === true || (pendingUpgrade === null && upgraded === "1");

  return (
    <Shell>
      {/* Header */}
      <div className="mb-3">
        <Eyebrow>Order Tracking</Eyebrow>
        <h1 className={PAGE_TITLE}>
          Order {/^\d+$/.test(String(order.order_number)) ? `R${order.order_number}` : order.order_number}
        </h1>
        <p className="mt-2 text-[15px] text-ink-soft">Placed {new Date(order.created_at).toLocaleDateString()}</p>
      </div>

      {/* Status timeline */}
      <div className={PANEL}>
        <h2 className={`${PANEL_TITLE} mb-5`}>Status</h2>
        <StatusTrack
          steps={visibleStatuses.map((s) => {
            const sIndex = STATUS_TIMELINE.indexOf(s);
            return { key: s, label: ORDER_STATUSES[s]?.label, state: s === order.status ? "current" : sIndex < currentIndex ? "done" : "next" };
          })}
        />
      </div>

      {/* Cards-added success banner */}
      {added === "1" && (
        <div className="rounded-[22px] bg-success-tint p-5 shadow-[inset_0_0_0_1.5px_var(--success)]">
          <p className="text-sm font-bold text-success">Cards added successfully!</p>
          <p className="text-sm text-success mt-0.5">
            Your payment was received. The new cards have been added to your order.
          </p>
        </div>
      )}

      {/* Upgrade success banner */}
      {showUpgradeReceived && (
        <div className="rounded-[22px] bg-success-tint p-5 shadow-[inset_0_0_0_1.5px_var(--success)]">
          <p className="text-sm font-bold text-success">Upgrade received!</p>
          <p className="text-sm text-success mt-0.5">
            Your payment was received. Your order will show the new service level shortly.
          </p>
        </div>
      )}

      {/* Upgrade section — only while awaiting cards, and not while a paid upgrade is on its way */}
      {order.status === "awaiting_cards" && !hideUpgradeOffer && (
        <UpgradeSection
          orderNumber={order.order_number}
          customerEmail={order.customer_email}
          currentTier={(order.restoration_tier as RestorationTierId | null)}
          currentSubtotalCents={order.subtotal_cents ?? 0}
          cardCount={cards?.length ?? 1}
        />
      )}

      {/* Add cards section — only while awaiting cards, and not while a paid
          upgrade is still on its way (the cards would be priced at the old tier) */}
      {order.status === "awaiting_cards" && !hideUpgradeOffer && (
        <AddCardsSection
          orderNumber={String(order.order_number)}
          customerEmail={order.customer_email}
          tier={(order.restoration_tier as RestorationTierId) ?? "regular"}
          cardsOnOrder={cards?.length ?? 0}
        />
      )}

      {/* Live inbound tracking (while we're waiting for the cards) */}
      {inboundTrack && (
        <div className={`${PANEL} bg-cobalt-wash shadow-none`}>
          <p className="label-caps mb-3 text-[15px] text-cobalt-deep">Inbound Shipment Tracking</p>
          <div className="mb-2 flex items-center gap-2">
            <StatusPill tone={TRACKING_BADGE[inboundTrack.trackingStatus?.status ?? "UNKNOWN"]?.tone ?? "muted"}>
              {TRACKING_BADGE[inboundTrack.trackingStatus?.status ?? "UNKNOWN"]?.label ?? "Unknown"}
            </StatusPill>
          </div>
          {inboundTrack.trackingStatus?.statusDetails && (
            <p className="text-sm text-ink mb-2">{inboundTrack.trackingStatus.statusDetails}</p>
          )}
          {inboundTrack.eta && (
            <p className="text-sm font-semibold text-ink">
              Estimated arrival: {new Date(inboundTrack.eta).toLocaleDateString("en-US", {
                weekday: "long", month: "long", day: "numeric"
              })}
            </p>
          )}
          <p className="mt-3 font-mono text-sm font-bold break-all text-cobalt-deep">{order.inbound_tracking_number}</p>
        </div>
      )}

      {/* Return tracking number */}
      {order.tracking_number && (
        <TrackingPanel
          label="Return Tracking"
          number={order.tracking_number}
          href={order.outbound_tracking_number === order.tracking_number
            ? trackingLink(order.tracking_number, order.outbound_carrier ?? null, order.outbound_tracking_url ?? null)
            : trackingLink(order.tracking_number)}
        />
      )}

      {/* Prepaid shipping label */}
      {order.inbound_method === "buy_label" && order.shipping_label_url && (
        <div className="surface-sun rounded-[22px] p-5 sm:p-6">
          <h2 className="mb-2 font-heading text-[1.75rem] leading-none font-black text-ink">Your Prepaid Shipping Label</h2>
          <p className="mb-5 text-[15px] text-ink">Print this label, attach it to your package, and drop it off at the carrier.</p>
          <a
            href={order.shipping_label_url}
            target="_blank"
            rel="noopener noreferrer"
            className={cta({ tone: "ink", size: "md" })}
          >
            <Download aria-hidden className="size-4" strokeWidth={2.25} />
            Download Label (PDF)
          </a>
        </div>
      )}

      {/* Restoration photos & notes */}
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
                <a key={i} href={url} target="_blank" rel="noopener noreferrer" className="print print-sm print-lift block w-32" style={{ ["--tilt" as string]: `${i % 2 ? 2 : -2}deg` }}>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={url} alt="Restored card" className="aspect-[3/4] w-full rounded-[3px] object-cover" />
                </a>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Cards */}
      <div className={PANEL}>
        <h2 className={`${PANEL_TITLE} mb-5`}>Your Cards ({cards?.length ?? 0})</h2>
        <div className="flex flex-col gap-2.5">
          {cards?.map((card, i) => (
            <div key={card.id} className="rounded-[14px] bg-chalk px-4 py-3 text-[15px]">
              <p className="font-semibold text-ink">{i + 1}. {card.card_name}</p>
              {card.card_set && <p className="text-sm text-ink-soft">{card.card_set}</p>}
            </div>
          ))}
        </div>
      </div>

      {(signatures?.length ?? 0) > 0 && (
        <div className={PANEL}>
          <h2 className={`${PANEL_TITLE} mb-5`}>Documents You Signed</h2>
          <ul className="flex flex-col gap-2.5 text-sm">
            {(signatures ?? []).map((s) => (
              <li key={s.id} className="flex flex-wrap items-center justify-between gap-2">
                <span className="text-foreground">
                  {s.document_title}{s.card_snapshot?.card_name ? `: ${s.card_snapshot.card_name}` : ""}
                  <span className="text-muted-foreground"> · signed by {s.typed_full_name}, {signedDate(s.signed_at)}</span>
                </span>
                <a href={docUrl(s.id)} className="inline-flex min-h-11 items-center gap-1.5 rounded-full px-3 font-bold text-cobalt hover:bg-cobalt-wash"><FileDown className="size-4" />PDF</a>
              </li>
            ))}
          </ul>
        </div>
      )}

      {signedAgreements.length > 0 && (
        <div className={PANEL}>
          <h2 className={`${PANEL_TITLE} mb-5`}>Agreements You Signed</h2>
          <SignedAgreements agreements={signedAgreements} />
        </div>
      )}

      {/* Services & total */}
      <div className={PANEL}>
        <h2 className={`${PANEL_TITLE} mb-5`}>Order Summary</h2>
        <div className="flex flex-col gap-2 text-[15px]">
          {services?.map((s) => (
            <div key={s.id} className="flex justify-between gap-3">
              <span className="text-ink-soft">{s.service_name} × {s.quantity}</span>
              <span className="font-semibold">{formatCurrency(s.price_cents * s.quantity)}</span>
            </div>
          ))}
          <div className="mt-2 flex items-baseline justify-between border-t-2 border-ink pt-3 font-heading text-[1.75rem] leading-none font-black">
            <span>Total</span>
            <span>{formatCurrency(order.total_cents)}</span>
          </div>
        </div>
      </div>

      <ReportProblem orderRef={String(order.order_number)} email={email} />

      <p className="text-center text-sm text-ink-soft">
        Questions? DM us on Instagram <a href="https://www.instagram.com/the_card_doc" target="_blank" rel="noopener noreferrer" className={PORTAL_LINK}>@the_card_doc</a>
      </p>
    </Shell>
  );
}
