import type { Metadata } from "next";
import { Suspense } from "react";
import { notFound } from "next/navigation";
import { z } from "zod";
import { requireAdmin } from "@/lib/admin-auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { AdminLink } from "@/components/admin-ui/admin-link";
import { productImage, thumbnail } from "@/lib/thumbnail";
import { isCatalogImageUrl } from "@/lib/card-catalog";
import { STAGES } from "@/lib/restoration-stages";
import { loadCard } from "@/lib/intake/data";
import { isMissingIntakeSchema } from "@/lib/intake/completed";
import { dayText, dueHint, daysUntil, nyDateTime } from "@/lib/intake/tracking-format";
import type { BagSummary, IntakeCard, StageHistoryEntry } from "@/lib/intake/types";
import { StageTrack } from "@/components/intake/stage-track";
import { AdvanceButton, StageCorrection } from "@/components/intake/tracking-actions";
import { BagLabelPrint } from "@/components/intake/bag-label-panel";
import { getLabelSettings } from "@/lib/intake/labels/data";
import { LABEL_STOCKS } from "@/lib/intake/labels/stock";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Card | Receiving", robots: { index: false } };

const panel = "bg-white rounded-xl border border-border p-4 sm:p-5";
const linkButton =
  "min-h-11 px-4 rounded-lg border border-border bg-white text-sm font-bold text-foreground hover:border-primary/40 transition-colors inline-flex items-center justify-center";

function Notice({ tone, children }: { tone: "amber" | "red"; children: React.ReactNode }) {
  const cls = tone === "amber" ? "border-amber-200 bg-amber-50 text-amber-900" : "border-red-200 bg-red-50 text-red-800";
  return <div role={tone === "red" ? "alert" : "status"} className={`rounded-xl border p-4 text-sm ${cls}`}>{children}</div>;
}

/** The customer's photo(s) large; else the catalog picture, labelled; else a placeholder. */
function CardImages({ card, orderId }: { card: IntakeCard; orderId: string }) {
  const [first, ...rest] = card.customerPhotos;
  if (first) {
    const img = productImage(first, [480, 960]);
    return (
      <div className="flex flex-col gap-2">
        <a href={first} target="_blank" rel="noopener noreferrer" className="block">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={img.src}
            srcSet={img.srcSet}
            sizes="(min-width: 1024px) 420px, 100vw"
            alt={`Customer photo of ${card.name}`}
            decoding="async"
            className="w-full max-h-[70vh] object-contain rounded-xl border border-border bg-white"
          />
        </a>
        <p className="text-xs font-semibold text-muted-foreground">Customer&apos;s photo{card.customerPhotos.length > 1 ? `s (${card.customerPhotos.length})` : ""}</p>
        {rest.length > 0 && (
          <div className="flex gap-2 flex-wrap">
            {rest.map((url) => (
              <a key={url} href={url} target="_blank" rel="noopener noreferrer">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={thumbnail(url, 80)} alt="Another customer photo" loading="lazy" decoding="async" className="w-20 h-20 object-cover rounded-lg border border-border" />
              </a>
            ))}
          </div>
        )}
      </div>
    );
  }
  if (card.catalogImageUrl && isCatalogImageUrl(card.catalogImageUrl)) {
    return (
      <div className="flex flex-col gap-2">
        <a href={card.catalogImageUrl} target="_blank" rel="noopener noreferrer" title="Reference photo from the card catalog, not the customer's card">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={card.catalogImageUrl}
            alt={`Reference photo of ${card.name} from the card catalog`}
            decoding="async"
            className="w-full max-h-[60vh] object-contain rounded-xl border border-dashed border-border bg-white"
          />
        </a>
        <p className="text-xs font-bold uppercase tracking-wide text-muted-foreground">Reference photo · not the customer&apos;s card</p>
      </div>
    );
  }
  return (
    <div className="flex flex-col items-center justify-center gap-2 h-36 lg:h-72 w-full rounded-xl border border-dashed border-border bg-secondary/50 text-center p-4">
      <p className="text-sm font-bold text-foreground">No customer image</p>
      <AdminLink href={`/admin/receiving/${orderId}`} className="text-sm font-semibold text-primary hover:underline">
        Add a photo in receiving
      </AdminLink>
    </div>
  );
}

function HistoryList({ history }: { history: StageHistoryEntry[] }) {
  if (history.length === 0) return <p className="text-sm text-muted-foreground">No steps recorded yet.</p>;
  // Newest first
  const rows = [...history].reverse();
  return (
    <ol className="flex flex-col divide-y divide-border">
      {rows.map((h, i) => (
        <li key={`${h.at}-${h.kind}-${i}`} className="py-2.5 flex items-start gap-3">
          <span
            aria-hidden
            className={`mt-1.5 w-2.5 h-2.5 shrink-0 rounded-full ${
              h.kind === "completed" ? "bg-green-600" : h.kind === "received" ? "bg-blue-600" : h.kind === "round_started" ? "bg-amber-500" : "bg-purple-500"
            }`}
          />
          <div className="min-w-0">
            <p className="text-sm font-semibold text-foreground">
              {h.label}
              {h.bulk && <span className="ml-2 text-[11px] font-bold text-muted-foreground">with its bag</span>}
            </p>
            <p className="text-xs text-muted-foreground">
              {nyDateTime(h.at)}
              {h.by ? ` · by ${h.by}` : ""}
            </p>
          </div>
        </li>
      ))}
    </ol>
  );
}

/**
 * Prints the label of the card's bag once every card in the bag has a
 * receiving photo; the label stock (for QZ Tray) and the bag's photo count
 * stream in after the page. Left out if the bag's cards can't be read.
 */
async function BagLabelSection({ bag }: { bag: BagSummary }) {
  const admin = createAdminClient();
  const [settings, { data: bagCards, error }] = await Promise.all([
    getLabelSettings(admin),
    admin.from("cards").select("status, receiving_photo_urls").eq("bag_id", bag.id),
  ]);
  if (error) return null;
  const needPhoto = ((bagCards ?? []) as { status: string | null; receiving_photo_urls: (string | null)[] | null }[]).filter(
    (c) => c.status !== "refunded" && !(c.receiving_photo_urls ?? []).some(Boolean),
  ).length;
  const stock = LABEL_STOCKS[settings.stock];
  return <BagLabelPrint bag={bag} paper={{ widthIn: stock.widthIn, heightIn: stock.heightIn }} needPhoto={needPhoto} />;
}

export default async function ReceivingCardPage({ params }: { params: Promise<{ cardId: string }> }) {
  await requireAdmin();
  const { cardId } = await params;
  if (!z.string().uuid().safeParse(cardId).success) notFound();

  const result = await loadCard(createAdminClient(), cardId);
  if (!result.ok && result.status === 404) notFound();
  if (!result.ok) {
    const missing = isMissingIntakeSchema({ message: result.error });
    return (
      <div className="min-h-screen bg-secondary/30">
        <div className="max-w-3xl mx-auto px-4 sm:px-6 py-6 sm:py-10 flex flex-col gap-4">
          <AdminLink href="/admin/receiving" className="inline-flex items-center min-h-11 text-sm font-semibold text-primary hover:underline">← Receiving</AdminLink>
          {missing ? (
            <Notice tone="amber">
              The receiving tables aren&apos;t in the database yet, so cards can&apos;t be tracked here. Apply{" "}
              <code className="font-mono">supabase/migrations/20261123_intake_tracking.sql</code>, then reload.
            </Notice>
          ) : (
            <Notice tone="red">Couldn&apos;t load this card: {result.error}</Notice>
          )}
        </div>
      </div>
    );
  }

  const { card, order, bag } = result;
  const st = card.stage;
  const canAdvance = !card.refunded && !card.awaitingArrival && !st.completed && st.next !== null;
  const advanceText = st.next?.kind === "complete" ? "Mark card done" : `Move to ${st.next?.label ?? ""}`;
  const due = bag?.dueDate ?? null;
  const overdue = (daysUntil(due) ?? 0) < 0 && !st.completed;

  return (
    <div className="min-h-screen bg-secondary/30">
      <div className="max-w-5xl mx-auto px-4 sm:px-6 py-4 sm:py-8">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <AdminLink href="/admin/receiving" className="inline-flex items-center min-h-11 text-sm font-semibold text-primary hover:underline">← Receiving</AdminLink>
          {bag && (
            <AdminLink href={`/admin/receiving/bag/${bag.id}`} className="inline-flex items-center min-h-11 text-sm font-semibold text-primary hover:underline">
              Bag {bag.code} →
            </AdminLink>
          )}
        </div>

        {/* Who and what */}
        <header className="mt-1 mb-4">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-mono font-black text-xl text-foreground">{card.code ?? "No Card ID yet"}</span>
            <span className="text-xs font-bold px-2 py-0.5 rounded-full bg-secondary text-foreground">{card.tierName}</span>
            {card.refunded && <span className="text-xs font-bold px-2 py-0.5 rounded-full bg-gray-200 text-gray-700">Refunded</span>}
            {card.flags.missingImage && <span className="text-xs font-bold px-2 py-0.5 rounded-full bg-amber-100 text-amber-800">Missing image</span>}
          </div>
          <h1 className="font-heading font-black text-2xl sm:text-3xl text-foreground mt-1 break-words">{card.name}</h1>
          <p className="text-sm text-muted-foreground">
            {[card.year, card.set, card.number ? `#${card.number}` : "", card.variation].filter(Boolean).join(" · ") || "No set details"}
          </p>
        </header>

        <div className="grid gap-4 lg:grid-cols-[minmax(0,420px)_minmax(0,1fr)] lg:items-start">
          <div className="flex flex-col gap-4">
            <CardImages card={card} orderId={order.id} />

            {card.receivingPhotos.length > 0 && (
              <section className={panel} aria-labelledby="receiving-photos">
                <h2 id="receiving-photos" className="font-heading font-black text-base text-foreground mb-2">Receiving photos</h2>
                <div className="flex gap-2 flex-wrap">
                  {card.receivingPhotos.map((url) => (
                    <a key={url} href={url} target="_blank" rel="noopener noreferrer">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={thumbnail(url, 96)} alt="Photo taken at receiving" loading="lazy" decoding="async" className="w-24 h-24 object-cover rounded-lg border border-border" />
                    </a>
                  ))}
                </div>
              </section>
            )}
          </div>

          <div className="flex flex-col gap-4">
            {/* Where it is now, and the one big button */}
            <section className={panel} aria-labelledby="current-step">
              <p id="current-step" className="text-xs font-bold uppercase tracking-wide text-muted-foreground">Current step</p>
              <p className={`font-heading font-black text-3xl mt-0.5 ${st.completed ? "text-green-700" : "text-foreground"}`}>
                {st.completed ? "Done ✓" : st.current ? `${st.currentIndex + 1}. ${st.currentLabel}` : "Not started"}
              </p>
              <p className="text-xs text-muted-foreground mt-0.5">
                {st.completed
                  ? `Finished ${nyDateTime(card.completedAt)}`
                  : st.current
                  ? `Step ${st.currentIndex + 1} of ${STAGES.length}${st.updatedAt ? ` · since ${nyDateTime(st.updatedAt)}` : ""}`
                  : `${STAGES.length} steps to go`}
                {st.round > 1 ? ` · Round ${st.round}` : ""}
              </p>

              <div className="mt-4 flex flex-col gap-3">
                {card.awaitingArrival && (
                  <Notice tone="amber">
                    This card hasn&apos;t arrived yet. Receive it in the{" "}
                    <AdminLink href={`/admin/receiving/${order.id}`} className="font-semibold underline">receiving workspace</AdminLink> before moving it.
                  </Notice>
                )}
                {card.refunded && <Notice tone="amber">This card was refunded, so it isn&apos;t worked on.</Notice>}
                {canAdvance && <AdvanceButton orderId={order.id} cardIds={[card.id]} fromStage={st.current} label={advanceText} />}
                {st.completed && (
                  <p className="text-sm text-muted-foreground">
                    To rework it, start the next round from the{" "}
                    <AdminLink href={`/admin/orders/${order.id}`} className="font-semibold text-primary hover:underline">order page</AdminLink>.
                  </p>
                )}
                {!card.refunded && !st.completed && (
                  <StageCorrection orderId={order.id} cardId={card.id} currentStage={st.current} />
                )}
              </div>
            </section>

            <section className={panel} aria-labelledby="card-details">
              <h2 id="card-details" className="sr-only">Card details</h2>
              <dl className="grid grid-cols-2 gap-x-4 gap-y-3 text-sm">
                <div>
                  <dt className="text-xs font-semibold text-muted-foreground">Customer</dt>
                  <dd className="font-semibold text-foreground break-words">{order.customerName || "—"}</dd>
                </div>
                <div>
                  <dt className="text-xs font-semibold text-muted-foreground">Order</dt>
                  <dd>
                    <AdminLink href={`/admin/orders/${order.id}`} className="font-semibold text-primary hover:underline">#{order.orderNumber}</AdminLink>
                  </dd>
                </div>
                <div>
                  <dt className="text-xs font-semibold text-muted-foreground">Card ID</dt>
                  <dd className="font-mono font-semibold text-foreground">{card.code ?? "—"}</dd>
                </div>
                <div>
                  <dt className="text-xs font-semibold text-muted-foreground">Tier</dt>
                  <dd className="font-semibold text-foreground">{card.tierName}</dd>
                </div>
                <div>
                  <dt className="text-xs font-semibold text-muted-foreground">Received</dt>
                  <dd className="text-foreground">
                    {card.receivedOn ? dayText(card.receivedOn) : card.awaitingArrival ? "Not yet" : "—"}
                    {card.receivedBy && <span className="block text-xs text-muted-foreground">by {card.receivedBy}</span>}
                  </dd>
                </div>
                <div>
                  <dt className="text-xs font-semibold text-muted-foreground">Bag</dt>
                  <dd>
                    {bag ? (
                      <AdminLink href={`/admin/receiving/bag/${bag.id}`} className="font-mono font-semibold text-primary hover:underline">{bag.code}</AdminLink>
                    ) : (
                      <span className="text-muted-foreground">Not in a bag</span>
                    )}
                  </dd>
                </div>
                <div className="col-span-2">
                  <dt className="text-xs font-semibold text-muted-foreground">Due date</dt>
                  <dd>
                    <span className={`text-lg font-black ${overdue ? "text-red-700" : "text-foreground"}`}>{dayText(due)}</span>
                    {due && !st.completed && <span className={`ml-2 text-xs font-bold ${overdue ? "text-red-700" : "text-muted-foreground"}`}>{dueHint(due)}</span>}
                    {bag?.dueStatus === "needs_review" && <span className="block text-xs font-semibold text-amber-700">Due date needs review</span>}
                    {bag?.dueStatus === "missing_received_date" && <span className="block text-xs font-semibold text-amber-700">Missing receiving date</span>}
                  </dd>
                </div>
                {card.notes && (
                  <div className="col-span-2">
                    <dt className="text-xs font-semibold text-muted-foreground">Customer notes</dt>
                    <dd className="text-foreground whitespace-pre-wrap break-words">{card.notes}</dd>
                  </div>
                )}
              </dl>
            </section>

            <section className={panel} aria-labelledby="steps">
              <h2 id="steps" className="font-heading font-black text-base text-foreground mb-3">The 8 steps</h2>
              <StageTrack state={st} />
            </section>

            <section className={panel} aria-labelledby="history">
              <h2 id="history" className="font-heading font-black text-base text-foreground mb-1">Restoration history</h2>
              <HistoryList history={st.history} />
            </section>

            {/* Refunded cards aren't on the bag's label */}
            {bag && !card.refunded && (
              <Suspense fallback={null}>
                <BagLabelSection bag={bag} />
              </Suspense>
            )}

            <div className="flex flex-col sm:flex-row gap-2">
              <AdminLink href={`/admin/receiving/${order.id}`} className={linkButton}>Open receiving workspace</AdminLink>
              <AdminLink href={`/admin/orders/${order.id}`} className={linkButton}>Open order #{order.orderNumber}</AdminLink>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
