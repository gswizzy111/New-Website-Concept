import { notFound } from "next/navigation";
import { AdminLink } from "@/components/admin-ui/admin-link";
import { BagLabelPanel } from "@/components/intake/bag-label-panel";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireAdminOrWorkshop } from "@/lib/admin-auth";
import { thumbnail } from "@/lib/thumbnail";
import { catalogThumb, isCatalogImageUrl } from "@/lib/card-catalog";
import { MAX_RECEIVING_PHOTOS } from "@/lib/intake/photos";
import { nyToday } from "@/lib/intake/business-days";
import { loadOrderIntake } from "@/lib/intake/data";
import type { BagSummary, IntakeCard, OrderIntake } from "@/lib/intake/types";
import { statusLabel, tierLabel } from "@/lib/support-view";
import { isMissingSchema, MIGRATION_NOTICE } from "../_components/schema";
import { ReceivingCards } from "./receiving-cards";
import { AddCardForm } from "./add-card-form";
import { BagReceivedDate } from "./bag-received-date";
import { OrderLabelPrint } from "@/components/intake/order-label-print";
import { PrintOrderLabels } from "@/components/intake/print-order-labels";
import { loadPreparePlan, type PreparePlan } from "@/lib/intake/prepare-labels";
import { getLabelSettings } from "@/lib/intake/labels/data";
import { LABEL_STOCKS } from "@/lib/intake/labels/stock";
import type { WorkspaceCard } from "./types";
import { paymentState } from "../_components/payment";
import { loadOrderShelves, type ShelfGroup } from "../shelf/_lib/order-shelves";
import { missingTracking } from "../shelf/_lib/places";
import { PutInShelf } from "../shelf/_components/put-in-shelf";

export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const STATUS_STYLES: Record<string, string> = {
  awaiting_payment: "bg-gray-100 text-gray-600",
  awaiting_cards: "bg-amber-100 text-amber-700",
  received: "bg-blue-100 text-blue-700",
  in_progress: "bg-purple-100 text-purple-700",
  completed: "bg-green-100 text-green-700",
  shipped_back: "bg-cyan-100 text-cyan-700",
  delivered: "bg-emerald-100 text-emerald-700",
  cancelled: "bg-red-100 text-red-700",
};

const INBOUND: Record<string, string> = {
  self_ship: "Mail-in (customer ships)",
  buy_label: "Mail-in (prepaid label)",
  dropoff: "In-person drop-off",
};

const COMPLETION_STYLES: Record<string, string> = {
  "in progress": "bg-gray-100 text-gray-600",
  "partially completed": "bg-yellow-100 text-yellow-700",
  "all cards done": "bg-green-100 text-green-700",
};

/** "Mon, Dec 7, 2026" for a stored day. */
function dayText(day: string | null | undefined, weekday = false) {
  if (!day) return "—";
  return new Date(`${day}T12:00:00Z`).toLocaleDateString("en-US", { timeZone: "UTC", ...(weekday ? { weekday: "short" as const } : {}), month: "short", day: "numeric", year: "numeric" });
}

function nyDateTime(iso: string | null | undefined) {
  if (!iso) return "—";
  return new Date(iso).toLocaleString("en-US", { timeZone: "America/New_York", month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" });
}

function toWorkspaceCard(c: IntakeCard, knownDefects: string | null): WorkspaceCard {
  return {
    id: c.id,
    seq: c.seq,
    code: c.code,
    name: c.name,
    set: c.set,
    year: c.year,
    number: c.number,
    notes: c.notes,
    knownDefects,
    tier: c.tier,
    tierName: c.tierName,
    ownTier: c.tierSource === "card",
    refunded: c.refunded,
    customerPhotos: c.customerPhotos.map((url) => ({ url, thumb: thumbnail(url, 56) })),
    referencePhoto: c.catalogImageUrl && isCatalogImageUrl(c.catalogImageUrl) ? catalogThumb(c.catalogImageUrl) : null,
    receivingPhotos: c.receivingPhotos,
    receivingThumbs: Object.fromEntries(c.receivingPhotos.map((url) => [url, thumbnail(url, 80)])),
    receivedAt: c.receivedAt,
    receivedBy: c.receivedBy,
    receivedOn: c.receivedOn,
    awaitingArrival: c.awaitingArrival,
    bagId: c.bagId,
    bagCode: c.bagCode,
    stageLabel: c.stage.currentLabel,
    round: c.stage.round,
    completed: c.completed,
    started: c.completed || c.stage.history.some((h) => h.kind === "stage" || h.kind === "completed" || h.kind === "round_started"),
    missingImage: c.flags.missingImage,
    missingTier: c.flags.missingTier,
    missingReceivedDate: c.flags.missingReceivedDate,
  };
}

/** The basic order, for the page shown before the intake database update is applied. */
async function basicOrder(orderId: string) {
  const admin = createAdminClient();
  const [{ data: order }, { data: cards }] = await Promise.all([
    admin.from("orders").select("id, order_number, customer_name, customer_email, status, payment_status, inbound_method, customer_notes, restoration_tier").eq("id", orderId).maybeSingle(),
    admin.from("cards").select("id, card_name, card_set, card_number, tier, status").eq("order_id", orderId).order("created_at").order("id").limit(500),
  ]);
  return order ? { order, cards: cards ?? [] } : null;
}

export default async function ReceivingOrderPage({ params }: { params: Promise<{ orderId: string }> }) {
  const role = await requireAdminOrWorkshop();
  const { orderId } = await params;
  if (!UUID.test(orderId)) notFound();

  const admin = createAdminClient();
  const today = nyToday();

  let intake: OrderIntake | null = null;
  let missingOrder = false;
  let schemaMissing = false;
  let loadError = "";
  try {
    const result = await loadOrderIntake(admin, orderId);
    if (result.ok) intake = result.intake;
    else if (result.status === 404) missingOrder = true;
    else if (isMissingSchema({ message: result.error })) schemaMissing = true;
    else loadError = result.error;
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    if (isMissingSchema({ message })) schemaMissing = true;
    else loadError = message;
  }
  if (missingOrder) notFound();

  if (!intake) {
    const basic = await basicOrder(orderId);
    if (!basic) notFound();
    return (
      <div className="min-h-screen bg-secondary/30">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 py-8">
          <AdminLink href="/admin/receiving" className="text-sm font-bold text-primary hover:underline min-h-11 inline-flex items-center">← Receiving</AdminLink>
          <h1 className="font-heading font-black text-3xl text-foreground mt-2">{basic.order.customer_name ?? "Order"}</h1>
          <p className="text-sm text-muted-foreground">{role === "admin" ? <AdminLink href={`/admin/orders/${orderId}`} className="font-bold text-primary hover:underline">{basic.order.order_number}</AdminLink> : <span className="font-bold text-foreground">{basic.order.order_number}</span>} · {basic.order.customer_email}</p>
          <PaymentBanner paymentStatus={basic.order.payment_status as string | null} />
          <p role="status" className="mt-5 rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-800">
            {schemaMissing ? MIGRATION_NOTICE : `The receiving details couldn't load: ${loadError}`}
          </p>
          <ul className="mt-5 bg-white rounded-xl border border-border divide-y divide-border">
            {basic.cards.map((c, i) => (
              <li key={c.id} className="px-5 py-3 text-sm">
                <span className="font-heading font-black">{i + 1}.</span> <span className="font-semibold">{c.card_name}</span>
                <span className="text-muted-foreground"> · {[c.card_set, c.card_number ? `#${c.card_number}` : null].filter(Boolean).join(" · ") || "No set or number"} · {tierLabel(c.tier ?? basic.order.restoration_tier)}{c.status === "refunded" ? " · Refunded" : ""}</span>
              </li>
            ))}
          </ul>
        </div>
      </div>
    );
  }

  const { order, cards, bags, counts } = intake;
  // Per-card known defects (not part of the intake card model)
  const { data: defectRows } = await admin.from("cards").select("id, known_defects").eq("order_id", orderId).not("known_defects", "is", null).limit(500);
  const defects = new Map(((defectRows ?? []) as { id: string; known_defects: string | null }[]).map((r) => [r.id, r.known_defects?.trim() || null]));
  const workspaceCards = cards.map((c) => toWorkspaceCard(c, defects.get(c.id) ?? null));
  const firstWith = (pick: (c: WorkspaceCard) => boolean) => workspaceCards.find((c) => !c.refunded && pick(c))?.id;
  const bagsMissingDate = bags.filter((b) => !b.receivedOn);
  const bagsNeedReview = bags.filter((b) => b.dueStatus === "needs_review");
  const payment = paymentState(order.paymentStatus);
  // Labels print without waiting for photos (the owner's call, Nov 23 2026)
  // One label per tier bag; a bag whose cards were all refunded gets none
  const labelBags = bags.filter((b) => b.cardCount > 0);
  const stock = LABEL_STOCKS[(await getLabelSettings(admin)).stock];
  const paper = { widthIn: stock.widthIn, heightIn: stock.heightIn };
  // One "Print labels" at the top, no ticking (owner, Nov 24 2026): cards in the shop but in no bag yet
  // (older orders, orders marked received from the order page) are bagged and printed; an Awaiting
  // Cards order is received all at once ("Cards arrived?"). What it covers is the server's own plan
  // (cards added after the order arrived are only asked about in its dialog, "Are they here with you?",
  // and otherwise stay for the ticks below), so the box says what the tap does.
  const printBox = ["awaiting_cards", "received", "in_progress", "completed", "shipped_back", "delivered"].includes(order.status) && payment !== "refunded";
  let prepare: PreparePlan | null = null;
  if (printBox) {
    const r = await loadPreparePlan(admin, orderId, { intake }).catch((e: unknown) => ({ ok: false as const, status: 500, error: e instanceof Error ? e.message : String(e) }));
    if (r.ok) prepare = r.plan;
    else console.warn("[receiving] print labels box not shown:", r.error);
  }
  const toBag = prepare && (prepare.mode === "bag_in_shop" || prepare.mode === "receive_first") ? prepare.toBag : 0;
  const toDate = prepare && prepare.mode !== "not_allowed" ? prepare.dueDatesToFill : 0;
  const receiveAll = prepare?.mode === "receive_first";
  // Where each newly received bag goes: its due date's shelf slot (none before the card tracking update)
  const received = cards.filter((c) => !c.refunded && c.bagId);
  let shelfGroups: ShelfGroup[] = [];
  if (received.length) {
    const shelves = await loadOrderShelves(admin, intake).catch((e: unknown) => ({ ok: false as const, error: e instanceof Error ? e.message : String(e) }));
    if (shelves.ok) shelfGroups = shelves.groups;
    else if (!missingTracking(shelves.error)) console.warn("[receiving] shelf box not shown:", shelves.error);
  }

  return (
    <div className="min-h-screen bg-secondary/30">
      <div className="max-w-4xl mx-auto px-4 sm:px-6 py-6 sm:py-8">
        <AdminLink href="/admin/receiving" className="text-sm font-bold text-primary hover:underline min-h-11 inline-flex items-center">← Receiving</AdminLink>

        {/* Payment: staff once worked on orders that were never paid */}
        <PaymentBanner paymentStatus={order.paymentStatus} />

        {/* Header */}
        <header className="mt-2 bg-white rounded-xl border border-border p-4 sm:p-6">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0">
              <h1 className="font-heading font-black text-2xl sm:text-3xl text-foreground break-words">{order.customerName ?? "No name"}</h1>
              <p className="text-sm text-muted-foreground break-all">
                {/* The order page is for full admins (workshop logins: lib/workshop-access.ts) */}
                {role === "admin" ? (
                  <AdminLink href={`/admin/orders/${order.id}`} className="font-heading font-black text-primary hover:underline">{order.orderNumber}</AdminLink>
                ) : (
                  <span className="font-heading font-black text-foreground">{order.orderNumber}</span>
                )}
                {order.customerEmail ? ` · ${order.customerEmail}` : ""}
              </p>
            </div>
            <div className="flex flex-wrap gap-1.5">
              <span className={`text-xs font-bold px-2.5 py-1 rounded-full ${STATUS_STYLES[order.status] ?? "bg-gray-100 text-gray-600"}`}>{statusLabel(order.status)}</span>
              <span className={`text-xs font-bold px-2.5 py-1 rounded-full ${COMPLETION_STYLES[intake.completion] ?? "bg-gray-100 text-gray-600"}`}>
                {intake.completion === "partially completed" ? "Partially completed" : intake.completion === "all cards done" ? "All cards done" : "Work in progress"}
              </span>
            </div>
          </div>
          <dl className="mt-4 grid grid-cols-2 sm:grid-cols-4 gap-x-4 gap-y-3 text-sm">
            <div>
              <dt className="text-[11px] font-bold uppercase tracking-widest text-muted-foreground">Received</dt>
              <dd className="font-heading font-black text-lg text-foreground">{counts.received} of {counts.total} cards</dd>
            </div>
            <div>
              <dt className="text-[11px] font-bold uppercase tracking-widest text-muted-foreground">Done</dt>
              <dd className="font-heading font-black text-lg text-foreground">{counts.completed} of {counts.total}</dd>
            </div>
            <div>
              <dt className="text-[11px] font-bold uppercase tracking-widest text-muted-foreground">Arrives by</dt>
              <dd className="font-semibold text-foreground">{order.inboundMethod ? INBOUND[order.inboundMethod] ?? order.inboundMethod : "—"}</dd>
            </div>
            <div>
              <dt className="text-[11px] font-bold uppercase tracking-widest text-muted-foreground">Order tier</dt>
              <dd className="font-semibold text-foreground">{order.restorationTier ? order.tierName : "Per card"}</dd>
            </div>
          </dl>
          {order.customerNotes && (
            <div className="mt-4 rounded-lg bg-amber-50 border border-amber-200 px-3 py-2 text-sm text-amber-900">
              <p className="text-[11px] font-bold uppercase tracking-widest mb-0.5">Customer instructions</p>
              <p className="whitespace-pre-wrap">{order.customerNotes}</p>
            </div>
          )}
          {order.historicalReceivedOn && counts.received === 0 && (
            <p className="mt-3 text-xs text-muted-foreground">Marked received before Receiving existed, on {dayText(order.historicalReceivedOn)}. Receiving starts from that date; change it if the cards really arrived another day.</p>
          )}
        </header>

        {/* Kept mounted after the cards are bagged, so the reload doesn't take its "Print 3 labels" away */}
        {printBox && prepare && (
          <PrintOrderLabels
            layout="panel"
            className="mt-4"
            hidden={toBag === 0 && toDate === 0}
            returnFocusTo="bags-h"
            orderId={order.id}
            orderNumber={order.orderNumber}
            status={order.status}
            paymentStatus={order.paymentStatus}
            paper={paper}
            variant="primary"
            refreshAfterBagging
            heading={receiveAll ? "Cards arrived?" : "Print labels"}
            hint={
              receiveAll
                ? `One tap receives all ${toBag} card${toBag === 1 ? "" : "s"}, fills in missing tiers (it asks only when unsure), puts them in their tier bags and prints each bag's label. The order moves to Cards Received and the customer gets the usual email, as with Receive.`
                : toBag > 0
                  ? `${toBag} card${toBag === 1 ? " isn't" : "s aren't"} in a bag yet. One tap fills in missing tiers (it asks only when unsure), puts every card in its tier bag and prints each bag's label. The order's status stays the same and the customer isn't emailed.`
                  : toDate > 0
                    ? `${toDate === 1 ? "A bag has" : `${toDate} bags have`} no due date yet, and ${toDate === 1 ? "its" : "their"} tier's turnaround is set now. One tap works the date out and prints the labels with it.`
                    : "Every card is in its tier bag."
            }
          >
            {receiveAll ? "Receive all and print" : undefined}
          </PrintOrderLabels>
        )}

        {/* Flags */}
        {(counts.missingImage > 0 || counts.missingTier > 0 || counts.missingReceivedDate > 0 || bagsMissingDate.length > 0 || bagsNeedReview.length > 0 || counts.awaiting > 0) && (
          <ul className="mt-4 flex flex-wrap gap-2" aria-label="Needs attention">
            {counts.missingTier > 0 && <Flag href={`#card-${firstWith((c) => c.missingTier)}`} tone="red">{counts.missingTier} missing tier{counts.missingTier === 1 ? "" : "s"}</Flag>}
            {counts.missingImage > 0 && <Flag href={`#card-${firstWith((c) => c.missingImage)}`} tone="red">{counts.missingImage} missing image{counts.missingImage === 1 ? "" : "s"}</Flag>}
            {(counts.missingReceivedDate > 0 || bagsMissingDate.length > 0) && <Flag href="#bags" tone="red">Missing receiving date</Flag>}
            {bagsNeedReview.length > 0 && <Flag href="#bags" tone="amber">{bagsNeedReview.length === 1 ? "Due date needs review" : `${bagsNeedReview.length} due dates need review`}</Flag>}
            {counts.awaiting > 0 && <Flag href={`#card-${firstWith((c) => c.awaitingArrival)}`} tone="amber">{counts.awaiting} card{counts.awaiting === 1 ? "" : "s"} still on the way</Flag>}
          </ul>
        )}

        {/* Cards */}
        <section aria-labelledby="cards-h" className="mt-6">
          <div className="flex flex-wrap items-baseline justify-between gap-2 mb-3">
            <h2 id="cards-h" className="font-heading font-black text-lg text-foreground">Cards ({counts.total}{counts.refunded ? ` + ${counts.refunded} refunded` : ""})</h2>
            <p className="text-xs text-muted-foreground">Tick the cards in your hand, photograph them, then receive.</p>
          </div>
          {cards.length === 0 ? (
            <p className="bg-white rounded-xl border border-border p-5 text-sm text-muted-foreground">This order has no cards yet. Add the cards the customer brought below.</p>
          ) : (
            <ReceivingCards
              orderId={order.id}
              orderStatus={order.status}
              today={today}
              // Nothing checked in yet on an order marked received before Receiving: start from that real day
              defaultReceivedOn={counts.received === 0 && order.historicalReceivedOn ? order.historicalReceivedOn : undefined}
              cards={workspaceCards}
              maxPhotos={MAX_RECEIVING_PHOTOS}
              canReceive
              payment={payment}
              workshop={role === "workshop"}
            />
          )}
          <PutInShelf groups={shelfGroups} />
          <OrderLabelPrint orderId={order.id} orderNumber={order.orderNumber} bags={labelBags} paper={paper} needPhoto={[]} />
          {payment !== "refunded" && order.status !== "cancelled" && (
            <div className="mt-4">
              <AddCardForm orderId={order.id} orderTier={order.restorationTier} today={today} maxPhotos={MAX_RECEIVING_PHOTOS} unpaid={payment === "unpaid"} />
            </div>
          )}
        </section>

        {/* Bags */}
        <section id="bags" aria-labelledby="bags-h" className="mt-8 scroll-mt-20 lg:scroll-mt-6">
          <h2 id="bags-h" className="font-heading font-black text-lg text-foreground mb-3">Bags ({bags.length})</h2>
          {bags.length === 0 ? (
            <p className="bg-white rounded-xl border border-border p-5 text-sm text-muted-foreground">No bags yet. Receiving cards puts each tier in its own bag, with its own Bag ID and due date.</p>
          ) : (
            <ul className="flex flex-col gap-3">
              {bags.map((b) => <BagRow key={b.id} bag={b} orderId={order.id} today={today} workshop={role === "workshop"} />)}
            </ul>
          )}
          {labelBags.length > 0 && (
            <div className="mt-4">
              <BagLabelPanel orderId={order.id} bags={labelBags} needPhoto={{}} />
            </div>
          )}
        </section>
      </div>
    </div>
  );
}

/** Red "Not paid" / dark "Refunded" warning; nothing for a paid order. */
function PaymentBanner({ paymentStatus }: { paymentStatus: string | null }) {
  const payment = paymentState(paymentStatus);
  if (payment === "paid") return null;
  return (
    <div role="alert" className={`mt-2 rounded-xl border-2 px-4 py-3 text-white ${payment === "refunded" ? "border-gray-900 bg-gray-900" : "border-red-600 bg-red-600"}`}>
      <p className="font-heading font-black text-xl uppercase tracking-wide">{payment === "refunded" ? "Refunded" : "Not paid"}</p>
      <p className="text-sm font-semibold">
        {payment === "refunded"
          ? "This order was refunded. Its cards can't be received."
          : `This order hasn't been paid (payment status: ${paymentStatus ?? "none"}). Check with an admin before working on these cards. Receiving asks you to confirm.`}
      </p>
    </div>
  );
}

/** Order statuses the Historical Order Setup works on (SETUP_STATUSES in lib/intake/migration.ts). */

function Flag({ href, tone, children }: { href: string; tone: "red" | "amber"; children: React.ReactNode }) {
  return (
    <li>
      <a href={href} className={`inline-flex items-center min-h-11 px-4 rounded-full text-sm font-bold ${tone === "red" ? "bg-red-100 text-red-700 hover:bg-red-200" : "bg-amber-100 text-amber-800 hover:bg-amber-200"}`}>
        {children}
      </a>
    </li>
  );
}

function BagRow({ bag: b, orderId, today, workshop }: { bag: BagSummary; orderId: string; today: string; workshop: boolean }) {
  const dueFlag = !b.receivedOn
    ? { text: "Missing receiving date", cls: "bg-red-100 text-red-700" }
    : b.dueStatus === "needs_review"
      ? { text: "Due date needs review", cls: "bg-amber-100 text-amber-800" }
      : b.dueStatus === "manual"
        ? { text: "Due date set by hand", cls: "bg-gray-100 text-gray-600" }
        : null;
  return (
    <li className="bg-white rounded-xl border border-border p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-heading font-black text-xl text-foreground">{b.code}</span>
          <span className="text-xs font-bold px-2 py-0.5 rounded-full bg-[#13224a] text-white">{b.tierName}</span>
          <span className="text-xs font-semibold text-muted-foreground">{b.cardCount} card{b.cardCount === 1 ? "" : "s"}</span>
          {b.source === "migration" && <span className="text-xs font-semibold text-muted-foreground">· Historical</span>}
        </div>
        <AdminLink href={`/admin/receiving/bag/${b.id}`} className="inline-flex items-center min-h-11 px-4 rounded-lg border border-border text-sm font-bold text-primary hover:border-primary/50">Open bag</AdminLink>
      </div>
      <dl className="mt-3 grid grid-cols-2 sm:grid-cols-4 gap-x-4 gap-y-2 text-sm">
        <div>
          <dt className="text-[11px] font-bold uppercase tracking-widest text-muted-foreground">Received</dt>
          <dd className="font-semibold text-foreground">{dayText(b.receivedOn)}</dd>
        </div>
        <div>
          <dt className="text-[11px] font-bold uppercase tracking-widest text-muted-foreground">Due</dt>
          <dd className="font-heading font-black text-foreground">{dayText(b.dueDate, true)}</dd>
        </div>
        <div>
          <dt className="text-[11px] font-bold uppercase tracking-widest text-muted-foreground">Done</dt>
          <dd className="font-semibold text-foreground">{b.complete ? `All ${b.cardCount}` : `${b.completedCount} of ${b.cardCount}`}</dd>
        </div>
        <div>
          <dt className="text-[11px] font-bold uppercase tracking-widest text-muted-foreground">Label</dt>
          <dd className="font-semibold text-foreground">{b.labelPrintedAt ? `Printed ${nyDateTime(b.labelPrintedAt)}` : <span className="text-red-700">Not printed</span>}{b.labelOutdated && <span className="block text-xs font-bold text-amber-700">Out of date: reprint</span>}</dd>
        </div>
      </dl>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        {b.complete && <span className="text-xs font-bold px-2 py-0.5 rounded-full bg-green-100 text-green-700">Completed{b.completedAt ? ` ${nyDateTime(b.completedAt)}` : ""}</span>}
        {b.stagesDiffer && <span className="text-xs font-bold px-2 py-0.5 rounded-full bg-purple-100 text-purple-700">Cards at different steps</span>}
        {dueFlag && <span className={`text-xs font-bold px-2 py-0.5 rounded-full ${dueFlag.cls}`}>{dueFlag.text}</span>}
        {/* A bag's received date sets its due date: full admins only (lib/workshop-access.ts) */}
        {b.dueStatus !== "manual" && !workshop && (
          <BagReceivedDate orderId={orderId} bagId={b.id} bagCode={b.code} today={today} current={b.receivedOn} labelPrinted={!!b.labelPrintedAt} />
        )}
        {b.dueStatus === "needs_review" && b.receivedOn && (
          <AdminLink href={`/admin/receiving/bag/${b.id}#due`} className="inline-flex items-center min-h-11 px-3 text-sm font-bold text-primary hover:underline">Review due date</AdminLink>
        )}
      </div>
    </li>
  );
}
