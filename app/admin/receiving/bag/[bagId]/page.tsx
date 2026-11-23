import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { z } from "zod";
import { requireAdmin } from "@/lib/admin-auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { AdminLink } from "@/components/admin-ui/admin-link";
import { thumbnail } from "@/lib/thumbnail";
import { catalogThumb, isCatalogImageUrl } from "@/lib/card-catalog";
import { STAGES } from "@/lib/restoration-stages";
import { loadBag } from "@/lib/intake/data";
import { nextStepAfter, stageIndex } from "@/lib/intake/stage-plan";
import { isMissingIntakeSchema } from "@/lib/intake/completed";
import { dayText, dueHint, daysUntil, nyDateTime } from "@/lib/intake/tracking-format";
import type { BagStageGroup, IntakeCard, TierBagDueChange } from "@/lib/intake/types";
import { StageTrack } from "@/components/intake/stage-track";
import { AdvanceButton, DueDateEditor, MarkSeenButton } from "@/components/intake/tracking-actions";
import { BagLabelPanel } from "@/components/intake/bag-label-panel";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Bag | Receiving", robots: { index: false } };

const panel = "bg-white rounded-xl border border-border p-4 sm:p-5";
const linkButton =
  "min-h-11 px-4 rounded-lg border border-border bg-white text-sm font-bold text-foreground hover:border-primary/40 transition-colors inline-flex items-center justify-center";

const DUE_STATUS_NOTE: Record<string, string> = {
  needs_review: "Due date needs review: worked out with today's turnaround settings, which may not be the ones that applied then.",
  missing_received_date: "Missing receiving date: enter the day the cards arrived in the receiving workspace to work out the due date.",
  pending: "No due date yet.",
  manual: "Set by hand.",
};

function Notice({ tone, children }: { tone: "amber" | "red" | "blue"; children: React.ReactNode }) {
  const cls =
    tone === "amber" ? "border-amber-200 bg-amber-50 text-amber-900" : tone === "blue" ? "border-blue-200 bg-blue-50 text-blue-900" : "border-red-200 bg-red-50 text-red-800";
  return <div role={tone === "red" ? "alert" : "status"} className={`rounded-xl border p-4 text-sm ${cls}`}>{children}</div>;
}

function Thumb({ card }: { card: IntakeCard }) {
  const own = card.customerPhotos[0] ?? card.receivingPhotos[0] ?? null;
  const ref = !own && card.catalogImageUrl && isCatalogImageUrl(card.catalogImageUrl) ? card.catalogImageUrl : null;
  if (!own && !ref) return <span aria-hidden className="w-11 h-16 shrink-0 rounded border border-dashed border-border bg-secondary/50" />;
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={own ? thumbnail(own, 44) : catalogThumb(ref!)}
      alt=""
      loading="lazy"
      decoding="async"
      title={ref ? "Reference photo from the card catalog" : undefined}
      className={`w-11 h-16 shrink-0 rounded border ${ref ? "border-dashed border-border object-contain bg-white" : "border-border object-cover"}`}
    />
  );
}

/** What the group's bulk button reads: "Move these 3 cards to Humidor", "Mark this card done". */
function groupLabel(group: BagStageGroup): string {
  const n = group.cardIds.length;
  const next = nextStepAfter(group.stage);
  if (next.kind === "complete") return n === 1 ? "Mark this card done" : `Mark these ${n} cards done`;
  return n === 1 ? `Move this card to ${next.label}` : `Move these ${n} cards to ${next.label}`;
}

/** One card of a step group; its own button only when the group has others (one card: the group button moves it). */
function CardRow({ card, orderId, ownButton }: { card: IntakeCard; orderId: string; ownButton: boolean }) {
  const st = card.stage;
  const next = st.next;
  return (
    <li className="py-3 flex flex-col gap-2 sm:flex-row sm:items-center sm:gap-3">
      <AdminLink href={`/admin/receiving/card/${card.id}`} className="flex items-center gap-3 min-w-0 flex-1 rounded-lg hover:bg-secondary/40 -mx-1 px-1">
        <Thumb card={card} />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-foreground truncate">{card.name}</p>
          <p className="text-xs text-muted-foreground truncate">
            <span className="font-mono">{card.code ?? "No Card ID"}</span>
            {card.set || card.number ? ` · ${[card.set, card.number ? `#${card.number}` : ""].filter(Boolean).join(" ")}` : ""}
          </p>
          <div className="mt-1.5 flex items-center gap-2">
            <div className="w-28 shrink-0"><StageTrack state={st} variant="bar" /></div>
            <span className={`text-xs font-bold ${st.completed ? "text-green-700" : "text-purple-700"}`}>
              {st.currentLabel}
              {st.round > 1 ? ` · R${st.round}` : ""}
            </span>
          </div>
        </div>
      </AdminLink>
      {ownButton && next && !card.refunded && !card.awaitingArrival && (
        <div className="sm:shrink-0">
          <AdvanceButton
            orderId={orderId}
            cardIds={[card.id]}
            fromStage={st.current}
            size="small"
            label={next.kind === "complete" ? "Mark done" : `Move to ${next.label}`}
          />
        </div>
      )}
    </li>
  );
}

function DueChanges({ changes }: { changes: TierBagDueChange[] }) {
  if (changes.length === 0) return null;
  return (
    <details className="mt-3 rounded-lg border border-border">
      <summary className="min-h-11 px-3 flex items-center text-sm font-semibold text-foreground cursor-pointer select-none">
        Due date changes ({changes.length})
      </summary>
      <ol className="divide-y divide-border">
        {changes.map((c) => (
          <li key={c.id} className="px-3 py-2 text-sm">
            <p className="font-semibold text-foreground">
              {dayText(c.old_due, false)} → {dayText(c.new_due, false)}
            </p>
            <p className="text-foreground break-words">{c.reason}</p>
            <p className="text-xs text-muted-foreground">
              {nyDateTime(c.created_at)}
              {c.changed_by ? ` · by ${c.changed_by}` : ""}
            </p>
          </li>
        ))}
      </ol>
    </details>
  );
}

export default async function ReceivingBagPage({ params }: { params: Promise<{ bagId: string }> }) {
  await requireAdmin();
  const { bagId } = await params;
  if (!z.string().uuid().safeParse(bagId).success) notFound();

  const result = await loadBag(createAdminClient(), bagId);
  if (!result.ok && result.status === 404) notFound();
  if (!result.ok) {
    const missing = isMissingIntakeSchema({ message: result.error });
    return (
      <div className="min-h-screen bg-secondary/30">
        <div className="max-w-3xl mx-auto px-4 sm:px-6 py-6 sm:py-10 flex flex-col gap-4">
          <AdminLink href="/admin/receiving" className="inline-flex items-center min-h-11 text-sm font-semibold text-primary hover:underline">← Receiving</AdminLink>
          {missing ? (
            <Notice tone="amber">
              The receiving tables aren&apos;t in the database yet, so bags can&apos;t be shown. Apply{" "}
              <code className="font-mono">supabase/migrations/20261123_intake_tracking.sql</code>, then reload.
            </Notice>
          ) : (
            <Notice tone="red">Couldn&apos;t load this bag: {result.error}</Notice>
          )}
        </div>
      </div>
    );
  }

  const { bag, order, cards, dueChanges } = result;
  const byId = new Map(cards.map((c) => [c.id, c]));
  const live = cards.filter((c) => !c.refunded);
  const refunded = cards.filter((c) => c.refunded);
  const pct = bag.cardCount ? Math.round((bag.completedCount / bag.cardCount) * 100) : 0;
  const overdue = (daysUntil(bag.dueDate) ?? 0) < 0 && !bag.complete;
  const isNewCompletion = !!bag.completedAt && !bag.completionSeenAt;

  return (
    <div className="min-h-screen bg-secondary/30">
      <div className="max-w-5xl mx-auto px-4 sm:px-6 py-4 sm:py-8">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <AdminLink href="/admin/receiving" className="inline-flex items-center min-h-11 text-sm font-semibold text-primary hover:underline">← Receiving</AdminLink>
          <AdminLink href={`/admin/receiving/${order.id}`} className="inline-flex items-center min-h-11 text-sm font-semibold text-primary hover:underline">
            Order #{order.orderNumber} →
          </AdminLink>
        </div>

        <header className="mt-1 mb-4">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs font-bold px-2 py-0.5 rounded-full bg-[#13224a] text-white">{bag.tierName} bag</span>
            {bag.complete && <span className="text-xs font-bold px-2 py-0.5 rounded-full bg-green-600 text-white">Completed</span>}
          </div>
          <h1 className="font-mono font-black text-3xl text-foreground mt-1">{bag.code}</h1>
          <p className="text-sm text-muted-foreground">
            {order.customerName || "—"} ·{" "}
            <AdminLink href={`/admin/orders/${order.id}`} className="font-semibold text-primary hover:underline">#{order.orderNumber}</AdminLink>
            {" · "}
            {bag.cardCount} card{bag.cardCount === 1 ? "" : "s"}
          </p>
        </header>

        {isNewCompletion && (
          <div className="mb-4 flex flex-wrap items-center justify-between gap-2 rounded-xl border border-green-200 bg-green-50 p-3">
            <p className="text-sm font-semibold text-green-900">Every card in this bag is done. The order is completed separately, once all its cards are done.</p>
            <MarkSeenButton bagIds={[bag.id]} label="Got it" />
          </div>
        )}

        <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,360px)] lg:items-start">
          <div className="flex flex-col gap-4 lg:order-1 order-2">
            {/* Cards grouped by the step they're at */}
            <section className={panel} aria-labelledby="cards-by-step">
              <div className="flex flex-wrap items-baseline justify-between gap-2 mb-2">
                <h2 id="cards-by-step" className="font-heading font-black text-lg text-foreground">Cards by step</h2>
                <span className="text-sm font-bold tabular-nums text-foreground">{bag.completedCount} of {bag.cardCount} cards done</span>
              </div>
              <div className="h-2 rounded-full bg-muted overflow-hidden mb-4" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct} aria-label="Cards done">
                <div className="h-full bg-green-600 rounded-full" style={{ width: `${pct}%` }} />
              </div>

              {bag.stagesDiffer && (
                <div className="mb-4">
                  <Notice tone="blue">
                    The cards in this bag are at different steps. Each group below moves on its own; moving one group never changes cards at another step.
                  </Notice>
                </div>
              )}

              {live.length === 0 && <p className="text-sm text-muted-foreground">No cards in this bag.</p>}

              <div className="flex flex-col gap-4">
                {bag.stageGroups.map((g) => {
                  const groupCards = g.cardIds.map((id) => byId.get(id)).filter((c): c is IntakeCard => !!c);
                  const movable = groupCards.filter((c) => !c.awaitingArrival).map((c) => c.id);
                  const idx = stageIndex(g.stage);
                  return (
                    <div key={g.key} className={`rounded-xl border ${g.completed ? "border-green-200 bg-green-50/40" : "border-border"} p-3`}>
                      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                        <h3 className="text-sm font-black text-foreground">
                          {g.completed ? "Done" : g.stage ? `Step ${idx + 1} of ${STAGES.length} · ${g.label}` : "Not started"}
                          <span className="ml-2 font-semibold text-muted-foreground">({groupCards.length})</span>
                        </h3>
                        {!g.completed && movable.length > 0 && (
                          <div className="sm:w-auto w-full">
                            <AdvanceButton orderId={order.id} cardIds={movable} fromStage={g.stage} label={groupLabel({ ...g, cardIds: movable })} size="big" />
                          </div>
                        )}
                      </div>
                      <ul className="mt-1 divide-y divide-border">
                        {groupCards.map((c) => <CardRow key={c.id} card={c} orderId={order.id} ownButton={groupCards.length > 1} />)}
                      </ul>
                    </div>
                  );
                })}
              </div>

              {refunded.length > 0 && (
                <div className="mt-4">
                  <h3 className="text-xs font-bold uppercase tracking-wide text-muted-foreground mb-1">Refunded (not worked on)</h3>
                  <ul className="divide-y divide-border">
                    {refunded.map((c) => (
                      <li key={c.id} className="py-2 flex items-center gap-3 opacity-70">
                        <Thumb card={c} />
                        <AdminLink href={`/admin/receiving/card/${c.id}`} className="min-w-0 text-sm text-foreground hover:underline truncate">
                          <span className="font-mono">{c.code ?? "—"}</span> · {c.name}
                        </AdminLink>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </section>

            <BagLabelPanel orderId={order.id} bags={[bag]} />

            <div className="flex flex-col sm:flex-row gap-2">
              <AdminLink href={`/admin/receiving/${order.id}`} className={linkButton}>Open receiving workspace</AdminLink>
              <AdminLink href={`/admin/orders/${order.id}`} className={linkButton}>Open order #{order.orderNumber}</AdminLink>
            </div>
          </div>

          <div className="flex flex-col gap-4 lg:order-2 order-1">
            {/* Due date */}
            <section className={panel} aria-labelledby="due">
              <p id="due" className="text-xs font-bold uppercase tracking-wide text-muted-foreground">Due date</p>
              <p className={`font-heading font-black text-3xl mt-0.5 ${overdue ? "text-red-700" : "text-foreground"}`}>{dayText(bag.dueDate)}</p>
              {bag.dueDate && !bag.complete && (
                <p className={`text-sm font-bold ${overdue ? "text-red-700" : "text-muted-foreground"}`}>{dueHint(bag.dueDate)}</p>
              )}
              {DUE_STATUS_NOTE[bag.dueStatus] && (
                <p className={`mt-1 text-xs ${bag.dueStatus === "manual" ? "text-muted-foreground" : "font-semibold text-amber-700"}`}>
                  {DUE_STATUS_NOTE[bag.dueStatus]}
                  {bag.dueStatus === "manual" && bag.dueNote ? ` ${bag.dueNote}` : ""}
                </p>
              )}
              <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
                <div>
                  <dt className="text-xs font-semibold text-muted-foreground">Received</dt>
                  <dd className="text-foreground">{dayText(bag.receivedOn, false)}</dd>
                </div>
                <div>
                  <dt className="text-xs font-semibold text-muted-foreground">Turnaround</dt>
                  <dd className="text-foreground">{bag.turnaroundDays ? `${bag.turnaroundDays} business days` : "—"}</dd>
                </div>
                {bag.completedAt && (
                  <div className="col-span-2">
                    <dt className="text-xs font-semibold text-muted-foreground">Completed</dt>
                    <dd className="text-foreground">{nyDateTime(bag.completedAt)}</dd>
                  </div>
                )}
              </dl>
              <div className="mt-3">
                <DueDateEditor bagId={bag.id} dueDate={bag.dueDate} />
              </div>
              <DueChanges changes={dueChanges} />
            </section>
          </div>
        </div>
      </div>
    </div>
  );
}
