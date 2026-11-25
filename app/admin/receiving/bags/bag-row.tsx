import { Camera, TriangleAlert } from "lucide-react";
import { AdminLink } from "@/components/admin-ui/admin-link";
import { PrintOrderLabels } from "@/components/intake/print-order-labels";
import { orderPhotosPath } from "@/lib/intake/codes";
import { groupPickerCards } from "@/lib/intake/step-picker";
import { StepPicker } from "@/components/intake/tracking-actions";
import type { BoardBag } from "./load-board";
import { DoneBar, DUE_TEXT, LabelStatus, shortDay, StepSummary, TierBadge, type DueInfo } from "./_components/bag-bits";

/**
 * One open bag on the Bags board, as its own work order. A card on a phone
 * and up to 1279 px (Bag ID and customer, then due | cards side by side,
 * then the steps, then the label and links); one dense row from 1280 px
 * (four columns, steps under the card count), where the steps get room
 * next to the 224 px admin sidebar. "Set the step" opens the bag's step
 * picker: any of the 8 steps or Done for every card not done yet.
 */

export const ROW_COLUMNS = "xl:grid-cols-[minmax(0,15rem)_minmax(0,11rem)_minmax(0,1fr)_minmax(0,13rem)]";

const focusRing = "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary";
const button = `min-h-11 px-2.5 sm:px-3 rounded-lg border text-sm font-bold inline-flex items-center justify-center gap-1.5 whitespace-nowrap transition-colors ${focusRing}`;
const caption = "text-[11px] font-bold uppercase tracking-wide text-muted-foreground xl:sr-only";

const ACCENT: Partial<Record<DueInfo["kind"], string>> = {
  overdue: "border-l-4 border-l-red-600",
  today: "border-l-4 border-l-amber-500",
};

export function BagRow({ bag, due, today }: { bag: BoardBag; due: DueInfo; today: string }) {
  const bagHref = `/admin/receiving/bag/${bag.id}`;
  const pickerCards = groupPickerCards(bag.stageGroups);
  return (
    <li
      className={`bg-white rounded-xl border border-border ${ACCENT[due.kind] ?? ""} p-4 sm:px-5 grid grid-cols-2 gap-x-4 gap-y-3 [grid-template-areas:'bag_bag'_'due_cards'_'steps_steps'_'act_act'] ${ROW_COLUMNS} xl:grid-rows-[auto_1fr] xl:gap-x-5 xl:gap-y-2 xl:[grid-template-areas:'bag_due_cards_act'_'bag_due_steps_act']`}
    >
      {/* Bag ID, tier, customer, order, the order's other bags */}
      <div className="[grid-area:bag] min-w-0">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <AdminLink
            href={bagHref}
            className={`font-mono font-black text-2xl leading-tight text-foreground hover:text-primary hover:underline underline-offset-4 [overflow-wrap:anywhere] rounded ${focusRing}`}
          >
            {bag.code}
          </AdminLink>
          <TierBadge tier={bag.tier} name={bag.tierName} />
        </div>
        <p className="mt-1 text-base font-bold leading-snug text-foreground [overflow-wrap:anywhere]">
          {bag.customerName ?? <span className="font-semibold text-muted-foreground">No customer name</span>}
        </p>
        <p className="text-xs text-muted-foreground">Order #{bag.orderNumber}</p>
        {bag.otherBags.length > 0 && (
          <p className="mt-1.5 text-xs text-muted-foreground">
            Other bags in this order:{" "}
            {bag.otherBags.map((o, i) => (
              <span key={o.id}>
                {i > 0 && ", "}
                <AdminLink
                  href={`/admin/receiving/bag/${o.id}`}
                  className={`font-mono font-bold text-primary hover:underline rounded whitespace-nowrap ${focusRing}`}
                  title={`${o.tierName} · ${o.cardCount} card${o.cardCount === 1 ? "" : "s"}`}
                >
                  {o.code}
                </AdminLink>
                {o.done ? " (done)" : ""}
              </span>
            ))}
          </p>
        )}
      </div>

      {/* Due date and how far off it is */}
      <div className="[grid-area:due] min-w-0">
        <p className={caption}>Due</p>
        <p className={`font-heading font-black text-xl leading-tight ${bag.dueDate ? DUE_TEXT[due.kind] : "text-amber-800"}`}>
          {bag.dueDate ? shortDay(bag.dueDate, today) : "No due date"}
        </p>
        {due.kind === "done" ? (
          <p className="text-sm font-bold text-green-700">All cards done</p>
        ) : due.hint && due.hint !== "No due date" ? (
          <p className={`text-sm font-bold ${due.kind === "upcoming" ? "text-muted-foreground" : DUE_TEXT[due.kind]}`}>
            {due.kind === "overdue" && <TriangleAlert aria-hidden className="inline size-3.5 mr-1 -mt-0.5" strokeWidth={1.75} />}
            {due.hint}
          </p>
        ) : null}
        {due.needsReview && <p className="text-xs font-semibold text-amber-800">Due date needs review</p>}
        {bag.receivedOn && <p className="mt-0.5 text-xs text-muted-foreground">Received {shortDay(bag.receivedOn, today)}</p>}
      </div>

      {/* Cards done */}
      <div className="[grid-area:cards] min-w-0">
        <p className={caption}>Cards</p>
        {bag.cardCount > 0 ? (
          <>
            <p className="text-sm text-foreground">
              <span className="font-black tabular-nums">{bag.completedCount}/{bag.cardCount}</span> card{bag.cardCount === 1 ? "" : "s"} done
            </p>
            <div className="mt-1.5 max-w-48">
              <DoneBar done={bag.completedCount} total={bag.cardCount} />
            </div>
          </>
        ) : (
          <p className="text-sm font-semibold text-muted-foreground">No cards</p>
        )}
      </div>

      {/* Which steps the cards are at */}
      <div className="[grid-area:steps] min-w-0 flex flex-col gap-2">
        {bag.cardCount > 0 && <StepSummary groups={bag.stageGroups} />}
        {pickerCards.some((c) => !c.completed) && (
          <div className="max-w-md">
            <StepPicker orderId={bag.orderId} cards={pickerCards} label={`Step for every card in bag ${bag.code}`} collapsed="Set the step" />
          </div>
        )}
      </div>

      {/* Label and links */}
      <div className="[grid-area:act] min-w-0 flex flex-col gap-2">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <LabelStatus printedAt={bag.labelPrintedAt} outdated={bag.labelOutdated} />
          {/* This bag's label, prepared on the first tap (no pre-fetch for every row); none for a bag
              with no live cards (all refunded): the label route has nothing to print */}
          {bag.cardCount > 0 && (
            <PrintOrderLabels
              orderId={bag.orderId}
              orderNumber={bag.orderNumber}
              bags={[{ id: bag.id, code: bag.code }]}
              size="sm"
              variant={bag.labelPrintedAt && !bag.labelOutdated ? "secondary" : "primary"}
            >
              {bag.labelPrintedAt ? "Reprint label" : "Print label"}
            </PrintOrderLabels>
          )}
        </div>
        <div className="grid grid-cols-3 sm:flex sm:flex-wrap xl:grid xl:grid-cols-2 gap-2">
          <AdminLink href={bagHref} aria-label={`Open bag ${bag.code}`} className={`${button} xl:col-span-2 bg-primary text-primary-foreground border-primary hover:bg-primary/90`}>
            Open bag
          </AdminLink>
          <AdminLink
            href={orderPhotosPath(bag.orderId, bag.id)}
            aria-label={`Photos of bag ${bag.code}`}
            className={`${button} bg-white text-foreground border-border hover:border-primary/40`}
          >
            <Camera aria-hidden className="size-4" strokeWidth={1.75} />
            Photos
          </AdminLink>
          <AdminLink
            href={`/admin/orders/${bag.orderId}`}
            aria-label={`Open order #${bag.orderNumber}`}
            className={`${button} bg-white text-foreground border-border hover:border-primary/40`}
          >
            Order
          </AdminLink>
        </div>
      </div>
    </li>
  );
}
