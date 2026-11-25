"use client";

import { Check, ExternalLink, ImageOff, LogOut, PackageCheck, TriangleAlert } from "lucide-react";
import { AdminLink } from "@/components/admin-ui/admin-link";
import { sinceText } from "@/components/intake/scan/format";
import { PhotoGrid } from "@/app/admin/receiving/[orderId]/photos/photo-grid";
import { TierBadge } from "@/app/admin/receiving/bags/_components/bag-bits";
import type { DeskPanelCard } from "../_lib/view";

/**
 * One card on the desk: its photos (tap for full screen), what it is, whose
 * order and where it stands, the customer's notes, and what to do with it
 * next. The board (desk-board.tsx) holds the selection and runs the actions.
 */

const focusRing = "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary";
const eyebrow = "text-[11px] font-bold uppercase tracking-widest text-muted-foreground";
const button = `inline-flex min-h-11 items-center justify-center gap-1.5 rounded-xl px-3 text-sm font-bold transition-colors disabled:opacity-50 ${focusRing}`;
export const deskButtons = {
  primary: `${button} bg-primary text-primary-foreground hover:bg-primary/90`,
  secondary: `${button} border border-border bg-white text-foreground hover:border-primary/50`,
  done: `${button} border border-green-300 bg-green-50 text-green-900 hover:bg-green-100`,
  quiet: `${button} text-muted-foreground hover:bg-secondary hover:text-foreground`,
};

type Props = {
  card: DeskPanelCard;
  now: number;
  selected: boolean;
  /** An action is running: buttons wait. */
  busy: boolean;
  /** Done was tapped: ask first. */
  confirmingDone: boolean;
  eager: boolean;
  onToggle: () => void;
  onPut: () => void;
  onDone: () => void;
  onConfirmDone: () => void;
  onCancelDone: () => void;
  onTakeOut: () => void;
};

function Fact({ term, children, wide = false }: { term: string; children: React.ReactNode; wide?: boolean }) {
  return (
    <div className={`min-w-0 ${wide ? "col-span-2" : ""}`}>
      <dt className={eyebrow}>{term}</dt>
      <dd className="mt-0.5 break-words text-foreground">{children}</dd>
    </div>
  );
}

function Note({ title, tone, children }: { title: string; tone: "amber" | "gray" | "red"; children: string }) {
  const cls = tone === "amber"
    ? "border-amber-200 bg-amber-50 text-amber-950"
    : tone === "red"
      ? "border-red-200 bg-red-50 text-red-950"
      : "border-border bg-secondary/50 text-foreground";
  return (
    <div className={`rounded-lg border px-3 py-2 text-sm ${cls}`}>
      <p className="text-[11px] font-bold uppercase tracking-widest opacity-80">{title}</p>
      <p className="mt-0.5 whitespace-pre-wrap break-words">{children}</p>
    </div>
  );
}

export function DeskCardPanel({ card, now, selected, busy, confirmingDone, eager, onToggle, onPut, onDone, onConfirmDone, onCancelDone, onTakeOut }: Props) {
  const since = sinceText(card.onDeskSince, now);
  const headingId = `desk-card-${card.id}`;
  const canWork = !card.refunded;
  return (
    <li
      aria-labelledby={headingId}
      className={`flex min-w-0 flex-col rounded-2xl border p-3 sm:p-4 transition-shadow ${selected ? "border-primary ring-2 ring-primary/40" : "border-border"} ${card.refunded ? "bg-gray-50" : "bg-white"}`}
    >
      {/* Name first: what the card is */}
      <div className="flex items-start gap-2">
        <label className="-ml-1.5 -mt-1.5 flex min-h-11 min-w-11 shrink-0 cursor-pointer items-center justify-center rounded-lg hover:bg-secondary">
          <input
            type="checkbox"
            checked={selected}
            onChange={onToggle}
            className={`size-6 cursor-pointer accent-primary ${focusRing}`}
          />
          <span className="sr-only">Select {card.label}</span>
        </label>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <AdminLink href={card.cardUrl} className={`inline-flex items-center rounded font-mono text-sm font-black text-foreground hover:text-primary hover:underline ${focusRing}`}>
              {card.code ?? "No Card ID"}
            </AdminLink>
            {card.tier ? <TierBadge tier={card.tier} name={card.tierName} /> : <span className="text-xs font-bold text-muted-foreground">{card.tierName}</span>}
            {card.refunded && <span className="rounded-full bg-gray-900 px-2 py-0.5 text-xs font-bold text-white">Refunded</span>}
            {card.step.done && (
              <span className="inline-flex items-center gap-0.5 rounded-full bg-green-100 px-2 py-0.5 text-xs font-bold text-green-800">
                <Check className="size-3.5" strokeWidth={1.75} aria-hidden="true" />
                Done
              </span>
            )}
          </div>
          <h2 id={headingId} className="mt-0.5 font-heading text-xl font-black leading-tight text-foreground break-words sm:text-2xl">{card.name}</h2>
          <p className="text-sm text-muted-foreground break-words">{card.details}</p>
        </div>
      </div>

      {/* Photos, three across in a panel */}
      <div className="mt-3 [&_ul]:grid-cols-3">
        {card.photos.length > 0 ? (
          <PhotoGrid groups={card.photos} cardLabel={card.label} eager={eager} />
        ) : (
          <div className="flex flex-col items-center justify-center gap-1 rounded-lg border-2 border-dashed border-border bg-secondary/40 px-4 py-5 text-center">
            <ImageOff className="size-6 text-muted-foreground" strokeWidth={1.75} aria-hidden="true" />
            <p className="text-sm font-bold text-foreground">No photo yet</p>
            {canWork && (
              <AdminLink href={card.receivingUrl} className={`inline-flex min-h-11 items-center px-3 text-sm font-semibold text-primary hover:underline ${focusRing}`}>
                Add a photo in receiving
              </AdminLink>
            )}
          </div>
        )}
      </div>

      <dl className="mt-3 grid grid-cols-2 gap-x-3 gap-y-2.5 text-sm">
        <Fact term="Customer">
          <span className="font-semibold">{card.customer ?? <span className="text-muted-foreground">No name</span>}</span>
        </Fact>
        <Fact term="Order">
          <AdminLink href={card.orderUrl} className={`-my-2 inline-flex min-h-11 items-center rounded font-heading font-black text-primary hover:underline break-all ${focusRing}`}>
            {card.orderNumber || "Order"}
          </AdminLink>
        </Fact>
        <Fact term="Step">
          <span className={`font-semibold ${card.step.done ? "text-green-700" : ""}`}>{card.step.label}</span>
          {card.step.round && <span className="block text-xs text-muted-foreground">Round {card.step.round}</span>}
        </Fact>
        <Fact term="Due">
          {card.due ? (
            <>
              <span className={`font-semibold ${card.due.overdue ? "text-red-700" : ""}`}>{card.due.text}</span>
              {card.due.overdue && card.due.hint && (
                <span className="mt-0.5 flex items-center gap-1 text-xs font-bold text-red-700">
                  <TriangleAlert className="size-3.5 shrink-0" strokeWidth={1.75} aria-hidden="true" />
                  {card.due.hint}
                </span>
              )}
            </>
          ) : (
            <span className="text-muted-foreground">Not set</span>
          )}
        </Fact>
        {card.declaredValue && (
          <Fact term="Declared value">
            <span className="font-semibold tabular-nums">{card.declaredValue}</span>
          </Fact>
        )}
        <Fact term="On the desk">
          <span className="font-semibold">{since ?? "—"}</span>
          {card.onDeskSinceText && <span className="block text-xs text-muted-foreground">since {card.onDeskSinceText}</span>}
        </Fact>
        <Fact term="Came from" wide={!!card.declaredValue}>
          {card.arrival ? (
            <>
              <span className="font-semibold">{card.arrival.fromName ?? "No holder"}</span>
              {card.arrival.by && <span className="text-xs text-muted-foreground"> · by {card.arrival.by}</span>}
            </>
          ) : (
            <span className="text-muted-foreground">Not recorded</span>
          )}
        </Fact>
      </dl>

      {(card.customerNotes || card.notes || card.knownDefects) && (
        <div className="mt-3 flex flex-col gap-2">
          {card.customerNotes && <Note title="Customer notes (order)" tone="amber">{card.customerNotes}</Note>}
          {card.notes && <Note title="Notes on this card" tone="gray">{card.notes}</Note>}
          {card.knownDefects && <Note title="Known defects" tone="red">{card.knownDefects}</Note>}
        </div>
      )}

      {card.refunded && <p className="mt-3 text-xs font-semibold text-muted-foreground">Refunded cards aren&apos;t worked on. Take it out and set it aside.</p>}

      {/* What to do with it next */}
      <div className="mt-auto pt-4">
        {confirmingDone ? (
          <div role="group" aria-label={`Mark ${card.label} done?`} className="rounded-xl border border-green-300 bg-green-50 p-3">
            <p className="text-sm font-bold text-green-950">Mark it done? Then put it back in its bag.</p>
            <div className="mt-2 grid grid-cols-2 gap-2">
              <button type="button" onClick={onConfirmDone} disabled={busy} className={`${button} bg-green-700 text-white hover:bg-green-800`}>
                <PackageCheck className="size-4" strokeWidth={1.75} aria-hidden="true" />
                Mark done
              </button>
              <button type="button" onClick={onCancelDone} disabled={busy} className={deskButtons.secondary}>
                Cancel
              </button>
            </div>
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-2">
            <button type="button" onClick={onPut} disabled={busy || !canWork} className={deskButtons.primary}>
              Put in holder
            </button>
            <button type="button" onClick={onDone} disabled={busy || !canWork || card.step.done} className={deskButtons.done}>
              <PackageCheck className="size-4" strokeWidth={1.75} aria-hidden="true" />
              Done
            </button>
            <AdminLink href={card.orderUrl} className={deskButtons.secondary}>
              <ExternalLink className="size-4" strokeWidth={1.75} aria-hidden="true" />
              Open order
            </AdminLink>
            <button type="button" onClick={onTakeOut} disabled={busy} className={deskButtons.quiet}>
              <LogOut className="size-4" strokeWidth={1.75} aria-hidden="true" />
              Take out
            </button>
          </div>
        )}
      </div>
    </li>
  );
}
