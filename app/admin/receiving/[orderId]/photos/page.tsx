import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Check, ChevronDown, ChevronRight, ImageOff, Tags } from "lucide-react";
import { requireAdmin } from "@/lib/admin-auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { AdminLink } from "@/components/admin-ui/admin-link";
import { productImage } from "@/lib/thumbnail";
import { catalogThumb, isCatalogImageUrl } from "@/lib/card-catalog";
import { STAGES } from "@/lib/restoration-stages";
import { loadOrderIntake } from "@/lib/intake/data";
import { dayText, daysUntil } from "@/lib/intake/tracking-format";
import type { BagSummary, IntakeCard } from "@/lib/intake/types";
import { statusLabel, tierLabel } from "@/lib/support-view";
import { isMissingSchema, MIGRATION_NOTICE } from "../../_components/schema";
import { paymentState } from "../../_components/payment";
import { PhotoGrid, type GridPhoto, type PhotoGroup } from "./photo-grid";

/**
 * What a label's QR opens (/q/<code> sends signed-in staff here), for staff
 * holding a bag and a phone. With ?bag=<bagId> (the tier bag's QR: each bag is
 * its own work order) only that bag's cards, headed by its Bag ID, tier and
 * due date; without it (the order code) every card of the order, grouped by
 * bag, cards not in a bag yet after them. Refunded cards come last, dimmed.
 * Each card shows its receiving photos, then the customer's; a card with
 * neither shows its catalog reference picture, clearly marked as not the
 * customer's card. Read only: loads with heal off, so a scan never writes.
 */

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Card photos | Receiving", robots: { index: false } };

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

const NAVY = "bg-[#13224a]";
const focusRing = "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary";
const focusRingLight = "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white";
const pill = "text-xs font-bold px-2.5 py-1 rounded-full";
const primaryButton = `inline-flex items-center justify-center gap-2 min-h-11 px-4 rounded-lg bg-primary text-primary-foreground text-sm font-bold hover:bg-primary/90 ${focusRing}`;
const secondaryButton = `inline-flex items-center justify-center gap-2 min-h-11 px-4 rounded-lg border border-border bg-white text-sm font-bold text-foreground hover:border-primary/50 ${focusRing}`;
const eyebrow = "text-[11px] font-bold uppercase tracking-widest";

/** One card as this page shows it (from the intake model, or the basic fallback). */
type PhotoCard = {
  id: string;
  code: string | null;
  name: string;
  /** "Base Set · #4/102" */
  details: string;
  tierName: string;
  refunded: boolean;
  awaiting: boolean;
  received: boolean;
  bag: { id: string; code: string; dueDate: string | null } | null;
  /** Null when unknown (the fallback before the intake update). */
  step: { label: string; detail: string | null; done: boolean } | null;
  groups: PhotoGroup[];
  /** Has a receiving or customer photo (a reference picture doesn't count). */
  hasOwnPhoto: boolean;
  receivingCount: number;
  /** The card page (/admin/receiving/card/<id>) can open it. */
  linkable: boolean;
};

type HeaderOrder = { id: string; orderNumber: string; customerName: string | null; status: string; statusLabel: string; paymentStatus: string | null };

/** A run of cards on the page: one tier bag, the cards not in a bag yet, or a plain list. */
type Section =
  | { kind: "bag"; bag: BagSummary; cards: PhotoCard[] }
  | { kind: "loose"; title: string; cards: PhotoCard[] }
  | { kind: "plain"; cards: PhotoCard[] };

/** "CD-2549-03 Charizard", or just the name before a Card ID is given. */
function cardLabel(code: string | null, name: string) {
  return code ? `${code} ${name}` : name;
}

function plural(n: number, word: string) {
  return `${n} ${word}${n === 1 ? "" : "s"}`;
}

/** Web addresses only: customer photo_urls aren't checked at checkout, and these become links. */
function webUrls(urls: (string | null)[] | null | undefined): string[] {
  return (urls ?? []).filter((u): u is string => typeof u === "string" && /^https?:\/\//i.test(u));
}

function setDetails(set: string | null, number: string | null) {
  return [set?.trim(), number?.trim() ? `#${number.trim()}` : null].filter(Boolean).join(" · ") || "No set or number";
}

function ownPhotos(urls: string[], kind: "receiving" | "customer", label: string): GridPhoto[] {
  const noun = kind === "receiving" ? "Receiving photo" : "Customer photo";
  return urls.map((url, i) => ({
    url,
    kind,
    // Resized copies on Netlify (lib/thumbnail.ts), keeping the card's shape; the original elsewhere
    tile: productImage(url, [360, 720]),
    full: productImage(url, [1280, 2048]),
    alt: `${noun} ${i + 1} of ${label}`,
    position: `${noun} ${i + 1} of ${urls.length}`,
  }));
}

/** Receiving photos, then the customer's; the catalog picture only when there are neither. */
function photoGroups(receiving: string[], customer: string[], catalogUrl: string | null, code: string | null, name: string): PhotoGroup[] {
  const label = cardLabel(code, name);
  const groups: PhotoGroup[] = [];
  if (receiving.length) {
    groups.push({ kind: "receiving", title: receiving.length === 1 ? "Receiving photo" : `Receiving photos (${receiving.length})`, photos: ownPhotos(receiving, "receiving", label) });
  }
  if (customer.length) {
    groups.push({ kind: "customer", title: customer.length === 1 ? "Customer photo" : `Customer photos (${customer.length})`, photos: ownPhotos(customer, "customer", label) });
  }
  if (!groups.length && catalogUrl && isCatalogImageUrl(catalogUrl)) {
    groups.push({
      kind: "reference",
      title: "Reference photo, not the customer's card",
      photos: [{
        url: catalogUrl,
        kind: "reference",
        tile: { src: catalogThumb(catalogUrl) },
        full: { src: catalogUrl },
        alt: `Reference photo of ${name} from the card catalog, not the customer's card`,
        position: "Reference photo, not the customer's card",
      }],
    });
  }
  return groups;
}

function stepOf(c: IntakeCard): PhotoCard["step"] {
  const st = c.stage;
  const round = st.round > 1 ? `Round ${st.round}` : null;
  if (st.completed || c.completed) return { label: "Done", detail: round, done: true };
  if (st.current) {
    return { label: st.currentLabel, detail: [`Step ${st.currentIndex + 1} of ${STAGES.length}`, round].filter(Boolean).join(" · "), done: false };
  }
  return { label: st.currentLabel || "Not started", detail: round, done: false };
}

function fromIntake(c: IntakeCard, bags: Map<string, BagSummary>): PhotoCard {
  const bag = c.bagId ? bags.get(c.bagId) ?? null : null;
  const receiving = webUrls(c.receivingPhotos);
  const customer = webUrls(c.customerPhotos);
  return {
    id: c.id,
    code: c.code,
    name: c.name,
    details: setDetails(c.set, c.number),
    tierName: c.tierName,
    refunded: c.refunded,
    awaiting: c.awaitingArrival && !c.refunded,
    received: !!c.receivedAt || !!c.bagId,
    bag: bag ? { id: bag.id, code: bag.code, dueDate: bag.dueDate } : null,
    step: stepOf(c),
    groups: photoGroups(receiving, customer, c.catalogImageUrl, c.code, c.name),
    hasOwnPhoto: receiving.length + customer.length > 0,
    receivingCount: receiving.length,
    linkable: true,
  };
}

/** Card ID order, cards without a Card ID after them (the intake list is already by card number). */
function inPageOrder(cards: PhotoCard[]) {
  return [...cards].sort((a, b) => Number(!a.code) - Number(!b.code));
}

/** "03" for CD-2549-03 on order CD-2549; the whole code otherwise. */
function shortCode(code: string, orderNumber: string) {
  const prefix = `${orderNumber.toUpperCase()}-`;
  return code.toUpperCase().startsWith(prefix) && code.length > prefix.length ? code.slice(prefix.length) : code;
}

function bagDue(bag: Pick<BagSummary, "dueDate" | "complete">) {
  const overdue = !!bag.dueDate && !bag.complete && (daysUntil(bag.dueDate) ?? 0) < 0;
  return { text: bag.dueDate ? `Due ${dayText(bag.dueDate)}` : "Due date not set", overdue };
}

/** The basic order, for the page shown before the intake database update is applied. */
async function basicOrder(orderId: string) {
  const admin = createAdminClient();
  const [{ data: order, error: orderError }, { data: cards, error: cardsError }] = await Promise.all([
    admin.from("orders").select("id, order_number, customer_name, status, payment_status, restoration_tier").eq("id", orderId).maybeSingle(),
    admin.from("cards").select("id, card_name, card_set, card_number, tier, status, photo_urls").eq("order_id", orderId).order("created_at").order("id").limit(500),
  ]);
  // A failed read is an error, not "no such order" (or "no cards")
  const readError = orderError ?? cardsError;
  if (readError) throw new Error(`The order couldn't load: ${readError.message}`);
  if (!order) return null;
  type BasicCard = { id: string; card_name: string | null; card_set: string | null; card_number: string | null; tier: string | null; status: string | null; photo_urls: string[] | null };
  const photoCards: PhotoCard[] = ((cards ?? []) as BasicCard[]).map((c) => {
    const name = c.card_name?.trim() || "Card";
    const customer = webUrls(c.photo_urls);
    return {
      id: c.id,
      code: null,
      name,
      details: setDetails(c.card_set, c.card_number),
      tierName: tierLabel(c.tier ?? (order.restoration_tier as string | null)),
      refunded: c.status === "refunded",
      awaiting: false,
      received: false,
      bag: null,
      step: null,
      groups: photoGroups([], customer, null, null, name),
      hasOwnPhoto: customer.length > 0,
      receivingCount: 0,
      linkable: false,
    };
  });
  const header: HeaderOrder = {
    id: order.id as string,
    orderNumber: order.order_number as string,
    customerName: order.customer_name as string | null,
    status: order.status as string,
    statusLabel: statusLabel(order.status as string),
    paymentStatus: order.payment_status as string | null,
  };
  return { header, cards: photoCards };
}

export default async function OrderPhotosPage({
  params,
  searchParams,
}: {
  params: Promise<{ orderId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requireAdmin();
  const [{ orderId }, query] = await Promise.all([params, searchParams]);
  if (!UUID.test(orderId)) notFound();
  const rawBag = Array.isArray(query.bag) ? query.bag[0] : query.bag;
  const bagParam = rawBag && UUID.test(rawBag) ? rawBag.toLowerCase() : null;

  let notice: { tone: "amber" | "red"; text: string } | null = null;
  let loaded: { header: HeaderOrder; cards: PhotoCard[]; bags: BagSummary[]; intake: boolean } | null = null;
  let missingOrder = false;

  try {
    const result = await loadOrderIntake(createAdminClient(), orderId, { heal: false });
    if (result.ok) {
      const { order, bags } = result.intake;
      const bagById = new Map(bags.map((b) => [b.id, b]));
      loaded = {
        header: { id: order.id, orderNumber: order.orderNumber, customerName: order.customerName, status: order.status, statusLabel: order.statusLabel, paymentStatus: order.paymentStatus },
        cards: result.intake.cards.map((c) => fromIntake(c, bagById)),
        bags,
        intake: true,
      };
    } else if (result.status === 404) {
      missingOrder = true;
    } else {
      notice = isMissingSchema({ message: result.error })
        ? { tone: "amber", text: MIGRATION_NOTICE }
        : { tone: "red", text: `The receiving details couldn't load: ${result.error}` };
    }
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    notice = isMissingSchema({ message }) ? { tone: "amber", text: MIGRATION_NOTICE } : { tone: "red", text: `The receiving details couldn't load: ${message}` };
  }
  if (missingOrder) notFound();

  if (!loaded) {
    // Before the intake update (or when it fails): the order with the customer's photos
    const basic = await basicOrder(orderId);
    if (!basic) notFound();
    loaded = { ...basic, bags: [], intake: false };
  }
  const { header, bags } = loaded;

  // A bag of another order (or an unknown one, say emptied and removed since) is ignored: the whole order shows, and says so
  const bag = bagParam ? bags.find((b) => b.id.toLowerCase() === bagParam && b.orderId === header.id) ?? null : null;
  if (rawBag && !bag && loaded.intake) {
    notice = { tone: "amber", text: "That bag isn't on this order anymore. Showing the whole order." };
  }

  const all = inPageOrder(loaded.cards);
  const shown = bag ? all.filter((c) => c.bag?.id === bag.id) : all;
  const live = shown.filter((c) => !c.refunded);
  const refunded = shown.filter((c) => c.refunded);

  const sections: Section[] = [];
  if (bag || !loaded.intake) {
    if (live.length) sections.push({ kind: "plain", cards: live });
  } else {
    for (const b of bags) {
      const cards = live.filter((c) => c.bag?.id === b.id);
      if (cards.length) sections.push({ kind: "bag", bag: b, cards });
    }
    const loose = live.filter((c) => !c.bag);
    if (loose.length) sections.push({ kind: "loose", title: loose.some((c) => c.received) ? "Not in a bag yet" : "Not received yet", cards: loose });
  }
  const pageOrder = [...sections.flatMap((s) => s.cards), ...refunded];
  const orderLiveCount = all.filter((c) => !c.refunded).length;
  const bagSections = sections.filter((s): s is Extract<Section, { kind: "bag" }> => s.kind === "bag");
  const nothingReceived = loaded.intake && !bag && bags.length === 0 && !all.some((c) => c.received) && all.length > 0;
  // The first photos on screen load at once (the bag QR's page should show cards fast)
  const firstCardId = pageOrder[0]?.id;

  return (
    <div className="min-h-screen bg-secondary/30">
      <div className="max-w-6xl mx-auto px-4 sm:px-6 py-4 sm:py-8">
        <AdminLink href="/admin/receiving" className={`inline-flex items-center min-h-11 text-sm font-semibold text-primary hover:underline ${focusRing}`}>← Receiving</AdminLink>

        <header className="mt-1 bg-white rounded-xl border border-border p-4 sm:p-6">
          <h1 className="font-heading font-black text-4xl sm:text-5xl leading-[1.1] text-foreground break-words">{header.customerName?.trim() || "No name"}</h1>
          {bag ? (
            <BagHead bag={bag} order={header} orderCards={orderLiveCount} orderBags={bags.filter((b) => b.cardCount > 0).length} shownCards={live.length} />
          ) : (
            <OrderHead order={header} cards={live.length} bags={bagSections.map((s) => ({ bag: s.bag, count: s.cards.length }))} intake={loaded.intake} refunded={refunded.length} />
          )}
          <Glance cards={live} refunded={refunded.length} intake={loaded.intake} />
        </header>

        {notice && (
          <p role={notice.tone === "red" ? "alert" : "status"} className={`mt-4 rounded-xl border px-4 py-3 text-sm break-words ${notice.tone === "red" ? "border-red-200 bg-red-50 text-red-800" : "border-amber-300 bg-amber-50 text-amber-900"}`}>
            {notice.text}
          </p>
        )}

        {nothingReceived && (
          <div role="status" className="mt-4 rounded-xl border border-blue-200 bg-blue-50 p-4 text-sm text-blue-900">
            <p className="font-heading font-black text-lg">Nothing received yet</p>
            <p className="mt-0.5">No card of this order has been checked in through Receiving, so it has no bags or receiving photos yet. {all.some((c) => c.hasOwnPhoto) ? "The customer's photos are below." : ""}</p>
            <AdminLink href={`/admin/receiving/${header.id}`} className={`mt-1 inline-flex items-center min-h-11 font-bold text-primary hover:underline ${focusRing}`}>Receive cards</AdminLink>
          </div>
        )}

        {pageOrder.length >= 4 && <JumpList cards={pageOrder} orderNumber={header.orderNumber} />}

        {shown.length === 0 ? (
          <div className="mt-6 bg-white rounded-xl border border-border p-5 text-sm text-muted-foreground">
            <p>{bag ? "This bag has no cards." : "This order has no cards yet."}</p>
            <AdminLink href={`/admin/receiving/${header.id}`} className={`mt-1 inline-flex items-center min-h-11 font-bold text-primary hover:underline ${focusRing}`}>
              {bag ? "Open receiving" : "Add cards in receiving"}
            </AdminLink>
          </div>
        ) : live.length === 0 ? (
          <p className="mt-6 bg-white rounded-xl border border-border p-5 text-sm text-muted-foreground">
            Every card {bag ? "in this bag" : "on this order"} was refunded. They&apos;re listed below.
          </p>
        ) : (
          sections.map((s) => (
            <CardSection key={s.kind === "bag" ? s.bag.id : s.kind} section={s} orderId={header.id} firstCardId={firstCardId} />
          ))
        )}

        {refunded.length > 0 && (
          <section id="refunded" aria-labelledby="refunded-h" className="mt-8 scroll-mt-20 lg:scroll-mt-6">
            <h2 id="refunded-h" className="font-heading font-black text-lg text-foreground mb-1">Refunded ({refunded.length})</h2>
            <p className="text-xs text-muted-foreground mb-3">Refunded cards aren&apos;t worked on. Shown for reference.</p>
            <ul className="flex flex-col gap-4">
              {refunded.map((c) => <CardBlock key={c.id} card={c} orderId={header.id} showBag={!bag && loaded.intake} eager={c.id === firstCardId} />)}
            </ul>
          </section>
        )}
      </div>
    </div>
  );
}

function OrderLine({ order }: { order: HeaderOrder }) {
  const payment = paymentState(order.paymentStatus);
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
      <AdminLink href={`/admin/orders/${order.id}`} className={`inline-flex items-center min-h-11 font-heading font-black text-xl text-primary hover:underline break-all ${focusRing}`}>
        {order.orderNumber}
      </AdminLink>
      <span className={`${pill} ${STATUS_STYLES[order.status] ?? "bg-gray-100 text-gray-600"}`}>{order.statusLabel}</span>
      {payment !== "paid" && (
        <span className={`${pill} ${payment === "refunded" ? "bg-gray-900 text-white" : "bg-red-600 text-white"}`}>{payment === "refunded" ? "Order refunded" : "Not paid"}</span>
      )}
    </div>
  );
}

/** ?bag=: the bag is the work order. Its ID, tier and due date right under the name. */
function BagHead({ bag, order, orderCards, orderBags, shownCards }: { bag: BagSummary; order: HeaderOrder; orderCards: number; orderBags: number; shownCards: number }) {
  const due = bagDue(bag);
  return (
    <>
      <div className={`mt-3 rounded-xl ${NAVY} text-white px-4 py-3`}>
        <p className={`${eyebrow} text-white/70`}>Bag</p>
        <p className="font-mono font-black text-3xl sm:text-4xl leading-tight break-all">{bag.code}</p>
        <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1">
          <span className="text-base font-black uppercase tracking-widest">{bag.tierName}</span>
          <span className="font-heading font-black text-xl">{due.text}</span>
          {due.overdue && <span className={`${pill} bg-red-600 text-white`}>Overdue</span>}
          {bag.complete && <span className={`${pill} bg-green-100 text-green-800`}>All done</span>}
          {bag.dueStatus === "needs_review" && <span className={`${pill} bg-amber-100 text-amber-900`}>Due date needs review</span>}
        </div>
        <p className="mt-1 text-sm text-white/80">
          {plural(shownCards, "card")}{bag.receivedOn ? ` · Received ${dayText(bag.receivedOn)}` : ""}
        </p>
      </div>
      <div className="mt-2">
        <OrderLine order={order} />
      </div>
      <div className="mt-3 flex flex-col sm:flex-row sm:flex-wrap gap-2">
        <AdminLink href={`/admin/receiving/bag/${bag.id}`} className={primaryButton}>
          Move steps
          <ChevronRight className="w-4 h-4" strokeWidth={1.75} aria-hidden="true" />
        </AdminLink>
        <AdminLink href={`/admin/receiving/${order.id}/photos`} className={secondaryButton}>
          Whole order ({plural(orderCards, "card")} in {plural(orderBags, "bag")})
        </AdminLink>
      </div>
    </>
  );
}

/** The whole order: number, status, how many cards in how many bags, a chip per bag. */
function OrderHead({ order, cards, bags, intake, refunded }: { order: HeaderOrder; cards: number; bags: { bag: BagSummary; count: number }[]; intake: boolean; refunded: number }) {
  return (
    <>
      <div className="mt-2">
        <OrderLine order={order} />
      </div>
      <p className="mt-1 font-heading font-black text-2xl text-foreground">
        {plural(cards, "card")}
        {intake && bags.length > 0 && <span> in {plural(bags.length, "bag")}</span>}
        {refunded > 0 && <span className="ml-2 font-sans text-sm font-semibold text-muted-foreground">+ {refunded} refunded</span>}
      </p>
      {bags.length > 1 && (
        <ul className="mt-2 flex flex-wrap gap-2" aria-label="Bags">
          {bags.map(({ bag, count }) => (
            <li key={bag.id} className="min-w-0">
              <a href={`#bag-${bag.id}`} className={`inline-flex items-center gap-2 min-h-11 max-w-full px-3 rounded-lg ${NAVY} text-white text-sm font-bold hover:bg-[#1d3270] ${focusRing}`}>
                <span className="font-mono break-all">{bag.code}</span>
                <span className="text-white/80 font-semibold">{bag.tierName} · {count}</span>
              </a>
            </li>
          ))}
        </ul>
      )}
      <div className="mt-4 flex flex-wrap gap-2">
        <AdminLink href={`/admin/receiving/${order.id}`} className={primaryButton}>
          <Tags className="w-4 h-4" strokeWidth={1.75} aria-hidden="true" /> Receiving &amp; labels
        </AdminLink>
      </div>
    </>
  );
}

/** Chips that jump to what needs a look: no photo yet, not arrived, refunded. */
function Glance({ cards, refunded, intake }: { cards: PhotoCard[]; refunded: number; intake: boolean }) {
  const noPhoto = cards.filter((c) => !c.hasOwnPhoto);
  const awaiting = cards.filter((c) => c.awaiting);
  const withReceiving = cards.filter((c) => c.receivingCount > 0).length;
  const chip = `inline-flex items-center min-h-11 px-4 rounded-full text-sm font-bold ${focusRing}`;
  return (
    <>
      {intake && cards.length > 0 && <p className="mt-3 text-sm text-muted-foreground">{withReceiving} of {plural(cards.length, "card")} with receiving photos</p>}
      {(noPhoto.length > 0 || awaiting.length > 0 || refunded > 0) && (
        <ul className="mt-2 flex flex-wrap gap-2" aria-label="At a glance">
          {noPhoto.length > 0 && (
            <li><a href={`#card-${noPhoto[0].id}`} className={`${chip} bg-amber-100 text-amber-900 hover:bg-amber-200`}>{noPhoto.length} with no photo yet</a></li>
          )}
          {awaiting.length > 0 && (
            <li><a href={`#card-${awaiting[0].id}`} className={`${chip} bg-amber-100 text-amber-900 hover:bg-amber-200`}>{awaiting.length} not arrived yet</a></li>
          )}
          {refunded > 0 && (
            <li><a href="#refunded" className={`${chip} bg-gray-100 text-gray-700 hover:bg-gray-200`}>{refunded} refunded</a></li>
          )}
        </ul>
      )}
    </>
  );
}

/** Every card as a small chip (its Card ID's last part), to jump down a long order. */
function JumpList({ cards, orderNumber }: { cards: PhotoCard[]; orderNumber: string }) {
  return (
    <nav aria-label="Jump to a card" className="mt-4">
      <details className="group/jump bg-white rounded-xl border border-border">
        <summary className={`flex min-h-11 cursor-pointer list-none items-center justify-between gap-2 rounded-xl px-4 text-sm font-bold text-foreground [&::-webkit-details-marker]:hidden ${focusRing}`}>
          <span>Jump to a card ({cards.length})</span>
          <ChevronDown className="w-4 h-4 shrink-0 transition-transform group-open/jump:rotate-180 motion-reduce:transition-none" strokeWidth={1.75} aria-hidden="true" />
        </summary>
        <ul className="flex flex-wrap gap-1.5 px-3 pb-3">
          {cards.map((c) => {
            const label = cardLabel(c.code, c.name);
            const state = c.refunded ? "refunded" : !c.hasOwnPhoto ? "no photo yet" : null;
            const tone = c.refunded
              ? "border-border bg-gray-50 text-gray-500 line-through"
              : !c.hasOwnPhoto
                ? "border-dashed border-amber-400 bg-amber-50 text-amber-900"
                : "border-border bg-white text-foreground";
            return (
              <li key={c.id} className="min-w-0">
                <a
                  href={`#card-${c.id}`}
                  title={label}
                  aria-label={state ? `${label}, ${state}` : label}
                  className={`inline-flex min-h-11 min-w-11 max-w-[12rem] items-center justify-center rounded-lg border px-2.5 text-sm font-bold hover:border-primary/60 ${tone} ${c.code ? "font-mono" : ""} ${focusRing}`}
                >
                  <span className="truncate">{c.code ? shortCode(c.code, orderNumber) : c.name}</span>
                </a>
              </li>
            );
          })}
        </ul>
      </details>
    </nav>
  );
}

/**
 * A tier bag's cards under a banner with its Bag ID, tier and due date; or the
 * cards not in a bag; or a plain list (?bag=, whose header already names the
 * bag). Cards here don't repeat their bag and due date.
 */
function CardSection({ section, orderId, firstCardId }: { section: Section; orderId: string; firstCardId: string | undefined }) {
  const list = (
    <ul className="flex flex-col gap-4">
      {section.cards.map((c) => (
        <CardBlock key={c.id} card={c} orderId={orderId} showBag={false} eager={c.id === firstCardId} />
      ))}
    </ul>
  );

  if (section.kind === "plain") {
    return (
      <section aria-labelledby="cards-h" className="mt-6">
        <h2 id="cards-h" className="font-heading font-black text-lg text-foreground mb-3">Card photos</h2>
        {list}
      </section>
    );
  }

  if (section.kind === "loose") {
    return (
      <section id="no-bag" aria-labelledby="no-bag-h" className="mt-8 scroll-mt-20 lg:scroll-mt-6">
        <div className="mb-3 rounded-xl border-2 border-dashed border-border bg-white px-4 py-3">
          <h2 id="no-bag-h" className="font-heading font-black text-xl text-foreground">{section.title}</h2>
          <p className="text-sm text-muted-foreground">{plural(section.cards.length, "card")} not in a bag</p>
        </div>
        {list}
      </section>
    );
  }

  const { bag } = section;
  const due = bagDue(bag);
  const headingId = `bag-h-${bag.id}`;
  return (
    <section id={`bag-${bag.id}`} aria-labelledby={headingId} className="mt-8 scroll-mt-20 lg:scroll-mt-6">
      <div className={`mb-3 rounded-xl ${NAVY} text-white px-4 py-3 flex flex-wrap items-center justify-between gap-x-4 gap-y-2`}>
        <div className="min-w-0">
          <h2 id={headingId} className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5">
            <span className="font-mono font-black text-2xl break-all">{bag.code}</span>
            <span className="text-sm font-black uppercase tracking-widest">{bag.tierName}</span>
          </h2>
          <p className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm">
            <span className="font-bold">{due.text}</span>
            {due.overdue && <span className={`${pill} bg-red-600 text-white`}>Overdue</span>}
            {bag.complete && <span className={`${pill} bg-green-100 text-green-800`}>All done</span>}
            <span className="text-white/80">· {plural(section.cards.length, "card")}</span>
          </p>
        </div>
        <div className="flex flex-wrap gap-x-1">
          <AdminLink href={`/admin/receiving/${orderId}/photos?bag=${bag.id}`} className={`inline-flex items-center min-h-11 px-2 text-sm font-bold text-white underline underline-offset-2 hover:text-white/80 ${focusRingLight}`}>
            Only this bag
          </AdminLink>
          <AdminLink href={`/admin/receiving/bag/${bag.id}`} className={`inline-flex items-center min-h-11 px-2 text-sm font-bold text-white underline underline-offset-2 hover:text-white/80 ${focusRingLight}`}>
            Move steps
          </AdminLink>
        </div>
      </div>
      {list}
    </section>
  );
}

function CardBlock({ card, orderId, showBag, eager }: { card: PhotoCard; orderId: string; showBag: boolean; eager: boolean }) {
  const label = cardLabel(card.code, card.name);
  const due = card.bag?.dueDate ?? null;
  const overdue = showBag && !!due && !card.refunded && !card.step?.done && (daysUntil(due) ?? 0) < 0;
  const title = (
    <>
      <span className={`block font-mono text-sm font-black ${card.code ? "text-foreground" : "text-muted-foreground"}`}>{card.code ?? "No Card ID yet"}</span>
      <span className="block font-heading font-black text-xl sm:text-2xl leading-tight text-foreground break-words">{card.name}</span>
    </>
  );
  const facts = showBag || !!card.step;
  return (
    <li id={`card-${card.id}`} className={`scroll-mt-20 lg:scroll-mt-6 bg-white rounded-xl border border-border p-3 sm:p-5 ${card.refunded ? "opacity-60" : ""}`}>
      <h3>
        {card.linkable ? (
          <AdminLink href={`/admin/receiving/card/${card.id}`} className={`group flex items-start gap-3 min-h-11 rounded-lg -m-1 p-1 hover:bg-secondary/50 ${focusRing}`}>
            <span className="min-w-0 flex-1">{title}</span>
            <span className="mt-1 inline-flex shrink-0 items-center gap-0.5 text-xs font-bold text-primary">
              <span className="hidden sm:inline">Card page</span>
              <ChevronRight className="w-5 h-5" strokeWidth={1.75} aria-hidden="true" />
            </span>
          </AdminLink>
        ) : (
          <span className="block">{title}</span>
        )}
      </h3>
      <p className="mt-0.5 text-sm text-muted-foreground break-words">{card.details}</p>

      <div className="mt-2 flex flex-wrap items-center gap-1.5">
        <span className={`text-xs font-bold px-2 py-0.5 rounded-full ${NAVY} text-white`}>{card.tierName}</span>
        {card.refunded && <span className="text-xs font-bold px-2 py-0.5 rounded-full bg-gray-200 text-gray-700">Refunded</span>}
        {card.awaiting && <span className="text-xs font-bold px-2 py-0.5 rounded-full bg-amber-100 text-amber-800">Not arrived yet</span>}
      </div>

      {facts && (
        <dl className="mt-3 grid grid-cols-2 sm:grid-cols-3 gap-x-4 gap-y-2 text-sm">
          {showBag && (
            <>
              <div className="min-w-0">
                <dt className={`${eyebrow} text-muted-foreground`}>Bag</dt>
                <dd>
                  {card.bag ? (
                    <AdminLink href={`/admin/receiving/bag/${card.bag.id}`} className={`inline-flex items-center min-h-11 -my-2 font-mono font-bold text-primary hover:underline break-all ${focusRing}`}>
                      {card.bag.code}
                    </AdminLink>
                  ) : (
                    <span className="text-muted-foreground">Not in a bag yet</span>
                  )}
                </dd>
              </div>
              <div className="min-w-0">
                <dt className={`${eyebrow} text-muted-foreground`}>Due</dt>
                <dd className={`font-semibold ${overdue ? "text-red-700" : "text-foreground"}`}>
                  {card.bag ? (due ? dayText(due) : "Not set") : "—"}
                  {overdue && <span className="block text-xs font-bold">Overdue</span>}
                </dd>
              </div>
            </>
          )}
          {card.step && (
            <div className={`min-w-0 ${showBag ? "col-span-2 sm:col-span-1" : ""}`}>
              <dt className={`${eyebrow} text-muted-foreground`}>Step</dt>
              <dd className={`font-semibold ${card.step.done ? "text-green-700" : "text-foreground"}`}>
                <span className="inline-flex items-center gap-1">
                  {card.step.done && <Check className="w-4 h-4" strokeWidth={1.75} aria-hidden="true" />}
                  {card.step.label}
                </span>
                {card.step.detail && <span className="block text-xs font-normal text-muted-foreground">{card.step.detail}</span>}
              </dd>
            </div>
          )}
        </dl>
      )}

      <div className="mt-4">
        {card.groups.length > 0 ? (
          <PhotoGrid groups={card.groups} cardLabel={label} eager={eager} />
        ) : (
          <div className="flex flex-col items-center justify-center gap-1 rounded-lg border-2 border-dashed border-border bg-secondary/40 px-4 py-8 text-center">
            <ImageOff className="w-6 h-6 text-muted-foreground" strokeWidth={1.75} aria-hidden="true" />
            <p className="text-sm font-bold text-foreground">No photo yet</p>
            {!card.refunded && card.linkable && (
              <AdminLink href={`/admin/receiving/${orderId}#card-${card.id}`} className={`inline-flex items-center min-h-11 px-3 text-sm font-semibold text-primary hover:underline ${focusRing}`}>
                Add a photo in receiving
              </AdminLink>
            )}
          </div>
        )}
      </div>
    </li>
  );
}
