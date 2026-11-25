import { createAdminClient } from "@/lib/supabase/admin";
import { ShipQueueStatusControl } from "./mark-shipped-button";
import { ReturnLabelButton as KitReturnLabelButton } from "../shop-orders/return-label-button";
import { ReturnLabelButton as RestorationReturnLabelButton } from "../orders/[id]/return-label-button";
import { AddressEditor } from "./address-editor";
import { CancelKitOrderButton } from "./cancel-kit-order-button";
import { AdminLink } from "@/components/admin-ui/admin-link";
import { requireAdmin } from "@/lib/admin-auth";
import { loadShipQueueBags, type ShipQueueBag } from "@/lib/intake/shipping/ship-queue";

export const dynamic = "force-dynamic";

type ShippingAddress = {
  street1: string;
  street2?: string | null;
  city: string;
  state: string;
  zip: string;
  country?: string;
};

type OrderItem = {
  product_id?: string;
  product_name: string;
  quantity: number;
};

const TIER_LABELS: Record<string, string> = {
  regular:       "Bronze",
  expedited:     "Silver",
  premium:       "Gold",
  ultra_premium: "Platinum",
  elite:         "Diamond",
};
const TIER_COLORS: Record<string, string> = {
  regular:       "bg-amber-100 text-amber-700",
  expedited:     "bg-slate-100 text-slate-600",
  premium:       "bg-yellow-100 text-yellow-700",
  ultra_premium: "bg-blue-100 text-blue-600",
  elite:         "bg-cyan-100 text-cyan-700",
};

export default async function ShipQueuePage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string }>;
}) {
  await requireAdmin();
  const { tab } = await searchParams;
  const activeTab = tab === "restoration" ? "restoration" : "kits";

  const admin = createAdminClient();
  const twoDaysAgo = new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString();

  const kitColumns = "id, customer_name, customer_email, customer_phone, shipping_address, items, created_at, status, return_label_url, labels, tracking_number";
  const [kitQuery, restorationQuery, shippedQuery, bagQueue] = await Promise.all([
    // Paid kits without a label, and kits being packed: 'processing' includes
    // those whose label was bought at checkout (the webhook sets it with the label)
    admin
      .from("shop_orders")
      .select(kitColumns)
      .or("status.eq.processing,and(status.eq.paid,return_label_url.is.null)")
      .order("created_at", { ascending: true }),
    admin
      .from("orders")
      .select("id, order_number, customer_name, customer_email, customer_phone, restoration_tier, return_label_url, ship_from_address, created_at, insurance_type, insurance_declared_value_cents, cards(id, card_name, card_set, card_year, estimated_value_cents, completed)")
      .eq("status", "completed")
      .eq("payment_status", "paid")
      .is("return_label_url", null)
      .order("created_at", { ascending: true }),
    // shipped_at is stamped by a trigger when an order's status becomes 'shipped'
    // (supabase/migrations/20261027_kits.sql); until that runs this list is empty
    admin
      .from("shop_orders")
      .select(kitColumns)
      .eq("status", "shipped")
      .gte("shipped_at", twoDaysAgo)
      .order("shipped_at", { ascending: true }),
    // Restoration bags finished (or with a label bought) and not shipped, each
    // with its packing page ("ship each bag when done"); their orders leave
    // the whole-order list
    loadShipQueueBags(admin),
  ]);
  if (kitQuery.error) console.error("[ship queue] kit orders:", kitQuery.error.message);
  if (restorationQuery.error) console.error("[ship queue] restoration orders:", restorationQuery.error.message);
  if (shippedQuery.error) console.error("[ship queue] recently shipped kits:", shippedQuery.error.message);
  if (bagQueue.error) console.error("[ship queue] restoration bags:", bagQueue.error);

  const readyToShip = kitQuery.data ?? [];
  // Orders with bags are listed bag by bag below (each bag ships on its own)
  const restorationReady = (restorationQuery.data ?? []).filter((o) => !bagQueue.orderIdsWithBags.has(o.id));
  const restorationEntries: ({ kind: "order"; at: string; order: (typeof restorationReady)[number] } | { kind: "bag"; at: string; bag: ShipQueueBag })[] = [
    ...restorationReady.map((order) => ({ kind: "order" as const, at: order.created_at as string, order })),
    ...bagQueue.bags.map((bag) => ({ kind: "bag" as const, at: bag.createdAt, bag })),
  ].sort((a, b) => a.at.localeCompare(b.at));
  const recentlyShipped = shippedQuery.data ?? [];

  const hasKitLabel = (o: { return_label_url: string | null; labels: unknown }) =>
    Boolean(o.return_label_url) || (Array.isArray(o.labels) && o.labels.length > 0);
  const kitsCount = readyToShip.length;
  const kitsNeedingLabels = readyToShip.filter((o) => !hasKitLabel(o)).length;
  const restorationCount = restorationEntries.length;
  // Bags whose label is bought (or being bought) only need Mark shipped
  const restorationNeedingLabels = restorationReady.length + bagQueue.bags.filter((b) => !b.shipment).length;
  const loadError = kitQuery.error || restorationQuery.error || (bagQueue.error ? { message: bagQueue.error } : null);

  return (
    <div className="min-h-screen bg-secondary/30">
      <div className="max-w-4xl mx-auto px-6 py-10">

        <div className="mb-6">
          <h1 className="font-heading font-black text-3xl text-foreground">Ship Queue</h1>
          <p className="text-muted-foreground text-sm mt-1">
            {kitsNeedingLabels + restorationNeedingLabels} order{(kitsNeedingLabels + restorationNeedingLabels) !== 1 ? "s" : ""} need labels — oldest first
          </p>
        </div>

        {loadError && (
          <div role="alert" className="mb-6 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
            Some orders could not be loaded: {loadError.message}. Reload the page to try again.
          </div>
        )}

        {/* Tabs */}
        <div className="flex gap-1 mb-7 border-b border-border">
          <AdminLink
            href="/admin/ship-queue"
            className={`px-4 py-2.5 text-sm font-semibold rounded-t-lg border border-b-0 -mb-px transition-colors flex items-center gap-2 ${
              activeTab === "kits"
                ? "bg-white border-border text-foreground"
                : "border-transparent text-muted-foreground hover:text-foreground"
            }`}
          >
            Kits
            {kitsCount > 0 && (
              <span className={`text-xs font-bold px-2 py-0.5 rounded-full ${
                activeTab === "kits" ? "bg-primary/10 text-primary" : "bg-primary text-white"
              }`}>
                {kitsCount}
              </span>
            )}
          </AdminLink>
          <AdminLink
            href="/admin/ship-queue?tab=restoration"
            className={`px-4 py-2.5 text-sm font-semibold rounded-t-lg border border-b-0 -mb-px transition-colors flex items-center gap-2 ${
              activeTab === "restoration"
                ? "bg-white border-border text-foreground"
                : "border-transparent text-muted-foreground hover:text-foreground"
            }`}
          >
            Restoration Orders
            {restorationCount > 0 && (
              <span className={`text-xs font-bold px-2 py-0.5 rounded-full ${
                activeTab === "restoration" ? "bg-green-100 text-green-700" : "bg-green-600 text-white"
              }`}>
                {restorationCount}
              </span>
            )}
          </AdminLink>
        </div>

        {/* ── KITS TAB ── */}
        {activeTab === "kits" && (
          <>
            {readyToShip.length === 0 ? (
              <div className="bg-white rounded-xl border border-border p-16 text-center">
                <p className="text-2xl mb-2">📦</p>
                <p className="font-heading font-black text-lg text-foreground">All caught up!</p>
                <p className="text-sm text-muted-foreground mt-1">No kit orders waiting to ship.</p>
              </div>
            ) : (
              <div className="flex flex-col gap-4">
                {readyToShip.map((order) => {
                  const addr = order.shipping_address as ShippingAddress | null;
                  const items = (order.items as OrderItem[] | null) ?? [];
                  const isSubscription = items.some((i) => i.product_id === "subscription");

                  return (
                    <div key={order.id} className="bg-white rounded-xl border border-border p-6">
                      <div className="flex flex-col sm:flex-row sm:items-start gap-5">
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 mb-2 flex-wrap">
                            <p className="font-heading font-black text-lg text-foreground">{order.customer_name}</p>
                            {isSubscription && (
                              <span className="text-xs font-bold px-2 py-0.5 rounded-full bg-purple-100 text-purple-700">Subscription</span>
                            )}
                            {order.status === "processing" && (
                              <span className="text-xs font-bold px-2 py-0.5 rounded-full bg-yellow-100 text-yellow-700">Processing</span>
                            )}
                            {order.status === "paid" && (
                              <span className="text-xs font-bold px-2 py-0.5 rounded-full bg-green-100 text-green-700">Paid</span>
                            )}
                          </div>
                          <p className="text-sm font-medium text-foreground mb-2">
                            {items.length > 0 ? items.map((i) => `${i.product_name} ×${i.quantity}`).join(", ") : "—"}
                          </p>
                          <AddressEditor orderId={order.id} address={addr} />
                          <p className="text-xs text-muted-foreground mt-2">
                            Ordered {new Date(order.created_at).toLocaleString("en-US", { timeZone: "America/New_York", month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" })} EST
                          </p>
                          <div className="mt-3">
                            <KitReturnLabelButton
                              orderId={order.id}
                              existingLabels={
                                Array.isArray((order as any).labels) && (order as any).labels.length > 0
                                  ? (order as any).labels
                                  : order.return_label_url
                                    ? [{ labelUrl: order.return_label_url, trackingNumber: (order as any).tracking_number ?? null, createdAt: "" }]
                                    : []
                              }
                              labelName="Shipping"
                            />
                          </div>
                        </div>
                        <div className="shrink-0 flex flex-col items-end gap-2">
                          <ShipQueueStatusControl orderId={order.id} currentStatus={order.status} />
                          <CancelKitOrderButton orderId={order.id} customerName={order.customer_name} />
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}

            {/* Recently shipped kits — last 48h */}
            {recentlyShipped.length > 0 && (
              <div className="mt-10">
                <p className="text-xs font-bold uppercase tracking-widest text-muted-foreground mb-3">Recently Shipped (last 48h)</p>
                <div className="flex flex-col gap-3">
                  {recentlyShipped.map((order) => {
                    const addr = order.shipping_address as ShippingAddress | null;
                    const items = (order.items as OrderItem[] | null) ?? [];
                    return (
                      <div key={order.id} className="bg-white rounded-xl border border-purple-200 p-5 opacity-80">
                        <div className="flex flex-col sm:flex-row sm:items-start gap-4">
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 mb-1 flex-wrap">
                              <p className="font-heading font-black text-base text-foreground">{order.customer_name}</p>
                              <span className="text-xs font-bold px-2 py-0.5 rounded-full bg-purple-100 text-purple-700">Shipped</span>
                            </div>
                            <p className="text-sm text-muted-foreground">
                              {items.length > 0 ? items.map((i) => `${i.product_name} ×${i.quantity}`).join(", ") : "—"}
                            </p>
                            {addr && (
                              <p className="text-xs text-muted-foreground mt-1">
                                {addr.street1}, {addr.city}, {addr.state} {addr.zip}
                              </p>
                            )}
                            <div className="mt-2">
                              <KitReturnLabelButton
                                orderId={order.id}
                                existingLabels={
                                  Array.isArray((order as any).labels) && (order as any).labels.length > 0
                                    ? (order as any).labels
                                    : order.return_label_url
                                      ? [{ labelUrl: order.return_label_url, trackingNumber: (order as any).tracking_number ?? null, createdAt: "" }]
                                      : []
                                }
                                labelName="Shipping"
                              />
                            </div>
                          </div>
                          <div className="shrink-0">
                            <ShipQueueStatusControl orderId={order.id} currentStatus={order.status} />
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </>
        )}

        {/* ── RESTORATION TAB ── */}
        {activeTab === "restoration" && (
          <>
            {restorationEntries.length === 0 ? (
              <div className="bg-white rounded-xl border border-border p-16 text-center">
                <p className="text-2xl mb-2">✅</p>
                <p className="font-heading font-black text-lg text-foreground">No cards ready to ship back</p>
                <p className="text-sm text-muted-foreground mt-1">Completed restoration orders will appear here.</p>
              </div>
            ) : (
              <div className="flex flex-col gap-4">
                {restorationEntries.map((entry) => {
                  if (entry.kind === "bag") return <BagEntry key={entry.bag.bagId} bag={entry.bag} />;
                  const order = entry.order;
                  const addr = order.ship_from_address as ShippingAddress | null;
                  const tier = order.restoration_tier as string | null;
                  const cards = ((order as any).cards ?? []) as {
                    id: string; card_name: string; card_set: string | null;
                    card_year: string | null; estimated_value_cents: number | null; completed: boolean;
                  }[];

                  return (
                    <div key={order.id} className="bg-white rounded-xl border-2 border-green-200 p-6">
                      <div className="flex flex-col gap-4">
                        {/* Header row */}
                        <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-3">
                          <div>
                            <div className="flex items-center gap-2 mb-1 flex-wrap">
                              <AdminLink href={`/admin/orders/${order.id}`} className="font-heading font-black text-lg text-foreground hover:text-primary transition-colors">
                                {order.customer_name}
                              </AdminLink>
                              <span className="text-xs font-bold px-2 py-0.5 rounded-full bg-green-100 text-green-700">Ready to Ship</span>
                              {tier && TIER_LABELS[tier] && (
                                <span className={`text-xs font-bold px-2 py-0.5 rounded-full ${TIER_COLORS[tier] ?? "bg-gray-100 text-gray-700"}`}>
                                  {TIER_LABELS[tier]}
                                </span>
                              )}
                            </div>
                            <p className="text-sm text-muted-foreground">{order.customer_email}</p>
                            <AdminLink href={`/admin/orders/${order.id}`} className="text-xs font-mono text-primary hover:underline">
                              #{order.order_number}
                            </AdminLink>
                          </div>
                          <div className="text-left sm:text-right shrink-0">
                            <p className="text-xs text-muted-foreground">
                              Ordered {new Date(order.created_at).toLocaleString("en-US", { timeZone: "America/New_York", month: "short", day: "numeric", year: "numeric" })}
                            </p>
                            {addr && (
                              <p className="text-xs text-muted-foreground mt-0.5">
                                {addr.street1}{addr.street2 ? `, ${addr.street2}` : ""}<br />
                                {addr.city}, {addr.state} {addr.zip}
                              </p>
                            )}
                          </div>
                        </div>

                        {/* Cards list */}
                        {cards.length > 0 && (
                          <div className="border border-border rounded-lg overflow-hidden">
                            <div className="bg-secondary/50 px-3 py-1.5 flex items-center justify-between">
                              <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
                                Cards ({cards.length})
                              </p>
                              {cards.every(c => c.completed) && (
                                <span className="text-[10px] font-bold text-green-700 flex items-center gap-1">
                                  <svg viewBox="0 0 10 8" fill="none" className="w-3 h-3"><path d="M1 4l3 3 5-6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg>
                                  All done
                                </span>
                              )}
                            </div>
                            <div className="divide-y divide-border">
                              {cards.map((card, i) => (
                                <div key={card.id} className={`flex items-center gap-3 px-3 py-2 ${card.completed ? "bg-green-50" : "bg-white"}`}>
                                  <span className="text-xs text-muted-foreground w-4 shrink-0">{i + 1}</span>
                                  <div className="flex-1 min-w-0">
                                    <p className={`text-sm font-semibold truncate ${card.completed ? "text-green-700 line-through decoration-green-400" : "text-foreground"}`}>
                                      {card.card_name}
                                    </p>
                                    {(card.card_set || card.card_year) && (
                                      <p className="text-xs text-muted-foreground truncate">
                                        {[card.card_set, card.card_year].filter(Boolean).join(" · ")}
                                      </p>
                                    )}
                                  </div>
                                  {card.estimated_value_cents && (
                                    <p className="text-xs font-semibold text-muted-foreground shrink-0">
                                      ${(card.estimated_value_cents / 100).toFixed(0)}
                                    </p>
                                  )}
                                  {card.completed && (
                                    <svg viewBox="0 0 10 8" fill="none" className="w-3.5 h-3.5 text-green-600 shrink-0">
                                      <path d="M1 4l3 3 5-6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                                    </svg>
                                  )}
                                </div>
                              ))}
                            </div>
                          </div>
                        )}

                        {/* Label button */}
                        <div>
                          <RestorationReturnLabelButton
                            orderId={order.id}
                            existingLabelUrl={(order as any).return_label_url ?? null}
                            insuranceType={(order.insurance_type as string | null) ?? null}
                            insuranceDeclaredValueCents={(order.insurance_declared_value_cents as number | null) ?? null}
                          />
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </>
        )}

      </div>
    </div>
  );
}

const BAG_STATE: Record<"purchased" | "claimed" | "stale" | "ready" | "work", { text: (b: ShipQueueBag) => string; cls: string }> = {
  purchased: { text: () => "Label bought, not shipped", cls: "bg-blue-100 text-blue-700" },
  claimed: { text: () => "Label being bought", cls: "bg-blue-100 text-blue-700" },
  stale: { text: () => "Label purchase didn't finish", cls: "bg-amber-100 text-amber-800" },
  ready: { text: () => "Ready to Ship", cls: "bg-green-100 text-green-700" },
  work: { text: (b) => `${b.doneCount} of ${b.cardCount} done`, cls: "bg-amber-100 text-amber-800" },
};

/**
 * One bag of a restoration order (each bag ships on its own when it's done):
 * the same card as a whole order, with its Bag ID, its cards and a link to
 * its packing page (buy the label, print it, Mark shipped) instead of the
 * label button.
 */
function BagEntry({ bag }: { bag: ShipQueueBag }) {
  const state = bag.shipment ? (bag.shipment.status === "claimed" && bag.shipment.stale ? "stale" : bag.shipment.status) : bag.finished ? "ready" : "work";
  const chip = BAG_STATE[state];
  const addr = bag.address;
  return (
    <div className={`bg-white rounded-xl border-2 p-6 ${bag.shipment ? "border-blue-200" : bag.finished ? "border-green-200" : "border-amber-200"}`}>
      <div className="flex flex-col gap-4">
        {/* Header row */}
        <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-3">
          <div>
            <div className="flex items-center gap-2 mb-1 flex-wrap">
              <AdminLink href={`/admin/orders/${bag.orderId}`} className="font-heading font-black text-lg text-foreground hover:text-primary transition-colors">
                {bag.customerName}
              </AdminLink>
              <span className={`text-xs font-bold px-2 py-0.5 rounded-full ${chip.cls}`}>{chip.text(bag)}</span>
              <span className={`text-xs font-bold px-2 py-0.5 rounded-full ${TIER_COLORS[bag.tier] ?? "bg-gray-100 text-gray-700"}`}>
                {bag.tierName}
              </span>
              <span className="text-xs font-mono font-bold px-2 py-0.5 rounded-full bg-secondary text-foreground">Bag {bag.bagCode}</span>
            </div>
            <p className="text-sm text-muted-foreground">{bag.customerEmail}</p>
            <AdminLink href={`/admin/orders/${bag.orderId}`} className="text-xs font-mono text-primary hover:underline">
              #{bag.orderNumber}
            </AdminLink>
          </div>
          <div className="text-left sm:text-right shrink-0">
            <p className="text-xs text-muted-foreground">
              Ordered {new Date(bag.createdAt).toLocaleString("en-US", { timeZone: "America/New_York", month: "short", day: "numeric", year: "numeric" })}
            </p>
            {addr?.street1 && (
              <p className="text-xs text-muted-foreground mt-0.5">
                {addr.street1}{addr.street2 ? `, ${addr.street2}` : ""}<br />
                {addr.city}, {addr.state} {addr.zip}
              </p>
            )}
          </div>
        </div>

        {/* Cards list */}
        {bag.cards.length > 0 && (
          <div className="border border-border rounded-lg overflow-hidden">
            <div className="bg-secondary/50 px-3 py-1.5 flex items-center justify-between">
              <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
                Cards in this bag ({bag.cards.length})
              </p>
              {bag.finished && (
                <span className="text-[10px] font-bold text-green-700 flex items-center gap-1">
                  <svg viewBox="0 0 10 8" fill="none" className="w-3 h-3"><path d="M1 4l3 3 5-6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg>
                  All done
                </span>
              )}
            </div>
            <div className="divide-y divide-border">
              {bag.cards.map((card, i) => (
                <div key={card.id} className={`flex items-center gap-3 px-3 py-2 ${card.done ? "bg-green-50" : "bg-white"}`}>
                  <span className="text-xs text-muted-foreground w-4 shrink-0">{i + 1}</span>
                  <div className="flex-1 min-w-0">
                    <p className={`text-sm font-semibold truncate ${card.done ? "text-green-700 line-through decoration-green-400" : "text-foreground"}`}>
                      {card.name}
                    </p>
                    {(card.set || card.year) && (
                      <p className="text-xs text-muted-foreground truncate">
                        {[card.set, card.year].filter(Boolean).join(" · ")}
                      </p>
                    )}
                  </div>
                  {card.valueCents ? (
                    <p className="text-xs font-semibold text-muted-foreground shrink-0">
                      ${(card.valueCents / 100).toFixed(0)}
                    </p>
                  ) : null}
                  {card.done && (
                    <svg viewBox="0 0 10 8" fill="none" className="w-3.5 h-3.5 text-green-600 shrink-0">
                      <path d="M1 4l3 3 5-6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                    </svg>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Packing page: buy the label, print it, Mark shipped */}
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
          <AdminLink
            href={bag.packHref}
            className="text-sm font-bold px-4 py-2 bg-primary text-primary-foreground rounded-lg hover:opacity-90 transition-opacity w-fit"
          >
            {bag.shipment?.status === "purchased" ? "Print label and mark shipped →" : "Pack and ship this bag →"}
          </AdminLink>
          {bag.shipment?.trackingNumber && (
            <span className="text-xs text-muted-foreground">
              Tracking <span className="font-mono font-semibold text-foreground">{bag.shipment.trackingNumber}</span>
            </span>
          )}
        </div>
      </div>
    </div>
  );
}
