"use client";

import { useEffect, useRef, useState } from "react";
import { Check, CircleCheck, CircleAlert, Info, MapPin, Package, TriangleAlert } from "lucide-react";
import { AdminLink } from "@/components/admin-ui/admin-link";
import { filingLetter } from "@/lib/intake/filing-letter";
import { bagPlaceText } from "@/lib/intake/tracking/bag-home";
import { dayText, dueHint } from "@/lib/intake/tracking-format";
import type { TrackBagSummary, TrackCardSummary, TrackOrderSummary, TrackSlotSummary } from "@/lib/intake/tracking/types";
import { fillText, placeSubtitle, sinceText, whereLine } from "./format";

// The Scan page's pieces (components/intake/scan/scan-app.tsx holds the flow).

export const panel = "rounded-2xl border border-border bg-white";
export const bigButton =
  "min-h-14 px-4 rounded-2xl text-lg font-black inline-flex items-center justify-center gap-2 transition active:scale-[0.98] motion-reduce:active:scale-100 disabled:opacity-50 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-primary/30";
export const smallButton =
  "min-h-11 px-3 rounded-xl border border-border bg-white text-sm font-bold text-foreground hover:border-primary/40 transition-colors inline-flex items-center justify-center gap-1.5 disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40";

/** A minute clock for "2 h ago" wording (re-renders once a minute). */
export function useNow(): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(t);
  }, []);
  return now;
}

export type FlashState = { key: number; tone: "ok" | "error"; text: string };

/** The huge ✓ / ⚠ after a save or a failed scan; gone after a moment. Screen readers get the text from the page's status line. */
export function Flash({ flash }: { flash: FlashState | null }) {
  const ref = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el || !flash) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    el.animate(
      [
        { opacity: 0, transform: "scale(0.92)" },
        { opacity: 1, transform: "scale(1)" },
      ],
      { duration: 140, easing: "cubic-bezier(0.2, 0, 0, 1)" },
    );
  }, [flash]);
  if (!flash) return null;
  const ok = flash.tone === "ok";
  return (
    <div aria-hidden="true" className="pointer-events-none fixed inset-0 z-50 flex items-center justify-center p-6">
      <div
        ref={ref}
        key={flash.key}
        className={`flex max-w-sm flex-col items-center gap-3 rounded-3xl px-8 py-7 text-center text-white shadow-2xl ${ok ? "bg-green-600/95" : "bg-red-600/95"}`}
      >
        {ok ? <Check className="h-24 w-24" strokeWidth={3} /> : <TriangleAlert className="h-24 w-24" strokeWidth={2.25} />}
        <p className="text-xl font-black leading-snug break-words">{flash.text}</p>
      </div>
    </div>
  );
}

function Due({ day }: { day: string | null }) {
  if (!day) return <span className="text-muted-foreground">No due date</span>;
  const hint = dueHint(day);
  const late = hint?.includes("overdue");
  return (
    <span className={late ? "font-bold text-red-700" : undefined}>
      Due {dayText(day)}
      {hint ? ` · ${hint}` : ""}
    </span>
  );
}

/** " · in for 2 h", " · put in just now". */
function sinceLine(locatedAt: string | null, now: number): string {
  const since = sinceText(locatedAt, now);
  if (!since) return "";
  return since === "just now" ? " · put in just now" : ` · in for ${since}`;
}

/** Where a card's bag is, in plain words; null when not recorded. */
function bagPlaceLine(card: Pick<TrackCardSummary, "bagLocation" | "customer">): string | null {
  return bagPlaceText(card.bagLocation, filingLetter(card.customer));
}

function cardTitle(card: TrackCardSummary): string {
  const extra = [card.year, card.set, card.number ? `#${card.number}` : null].filter(Boolean).join(" ");
  return [card.name ?? "Card", extra].filter(Boolean).join(" · ");
}

/**
 * One card in a list (bag, order, search, a slot's picks): Card ID, name,
 * where it is (tap to open that slot), and its button.
 */
export function CardRow({
  card,
  now,
  action,
  onAction,
  onOpenSlot,
  showOrder,
}: {
  card: TrackCardSummary;
  now: number;
  action?: { label: string; disabled?: boolean; primary?: boolean } | null;
  onAction?: (card: TrackCardSummary) => void;
  onOpenSlot?: (code: string) => void;
  showOrder?: boolean;
}) {
  return (
    <li className="flex flex-col gap-2 border-b border-border px-4 py-3 last:border-b-0 sm:flex-row sm:items-center">
      <div className="min-w-0 flex-1">
        <p className="flex flex-wrap items-baseline gap-x-2">
          <span className="font-mono text-lg font-black text-foreground">{card.code ?? "No Card ID"}</span>
          {card.done && <span className="rounded-full bg-green-100 px-2 py-0.5 text-xs font-bold text-green-800">Done</span>}
          {card.refunded && <span className="rounded-full bg-gray-100 px-2 py-0.5 text-xs font-bold text-gray-600">Refunded</span>}
          {card.awaiting && <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-bold text-amber-800">Not arrived</span>}
        </p>
        <p className="truncate text-sm font-semibold text-foreground">{cardTitle(card)}</p>
        {showOrder && (
          <p className="truncate text-sm text-muted-foreground">
            {card.customer ?? "No name"} · {card.orderNumber}
            {card.bagCode ? ` · bag ${card.bagCode}` : ""}
          </p>
        )}
        {/* Where its bag is: "Open bags box · R", "Shelf DUE MON DEC 7", "Ready to ship" */}
        {showOrder && card.bagCode && bagPlaceLine(card) && (
          <p className="mt-0.5 inline-flex items-center gap-1 text-sm font-semibold text-foreground">
            <Package className="h-4 w-4 shrink-0 text-muted-foreground" strokeWidth={1.75} aria-hidden="true" />
            Bag: {bagPlaceLine(card)}
          </p>
        )}
        {card.location && onOpenSlot ? (
          <button
            type="button"
            onClick={() => onOpenSlot(card.location!.code)}
            className="mt-0.5 inline-flex min-h-8 items-center gap-1 rounded text-left text-sm font-semibold text-primary underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
          >
            <MapPin className="h-4 w-4 shrink-0" strokeWidth={1.75} aria-hidden="true" />
            {whereLine(card, now)}
          </button>
        ) : (
          <p className={`mt-0.5 inline-flex items-center gap-1 text-sm ${card.location ? "font-semibold text-foreground" : "text-muted-foreground"}`}>
            <MapPin className="h-4 w-4 shrink-0" strokeWidth={1.75} aria-hidden="true" />
            {whereLine(card, now)}
          </p>
        )}
      </div>
      {action && onAction && (
        <button
          type="button"
          onClick={() => onAction(card)}
          disabled={action.disabled}
          className={
            action.primary
              ? "min-h-12 shrink-0 rounded-xl bg-primary px-4 text-base font-black text-primary-foreground hover:bg-primary/90 disabled:opacity-50 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-primary/30"
              : `${smallButton} min-h-12 shrink-0`
          }
        >
          {action.label}
        </button>
      )}
    </li>
  );
}

/**
 * A slot's own card, big: what's in CLAMP 07. `dense` for a stack (a heat
 * press or desk holding several cards): smaller type, so eight cards don't
 * fill three screens.
 */
export function SlotCard({
  card,
  now,
  selectable,
  selected,
  onToggle,
  dense = false,
}: {
  card: TrackCardSummary;
  now: number;
  selectable: boolean;
  selected: boolean;
  onToggle: () => void;
  dense?: boolean;
}) {
  const body = (
    <>
      <p className="flex flex-wrap items-baseline gap-x-2">
        <span className={`font-mono font-black text-foreground ${dense ? "text-xl" : "text-2xl sm:text-3xl"}`}>{card.code ?? "No Card ID"}</span>
        {card.done && <span className="rounded-full bg-green-100 px-2 py-0.5 text-xs font-bold text-green-800">Done</span>}
        {selectable && !selected && <span className="rounded-full bg-gray-100 px-2 py-0.5 text-xs font-bold text-gray-700">Not picked</span>}
      </p>
      <p className={`font-black leading-tight text-foreground ${dense ? "text-base" : "text-lg"}`}>{card.customer ?? "No name"}</p>
      <p className={`font-semibold text-foreground ${dense ? "text-sm" : "text-base"}`}>{cardTitle(card)}</p>
      <p className="text-sm text-muted-foreground">
        {card.tierName} · <Due day={card.dueDate} />
      </p>
      <p className="text-sm text-muted-foreground">
        Step: <span className="font-semibold text-foreground">{card.stageLabel}</span>
        {sinceLine(card.locatedAt, now)}
      </p>
    </>
  );
  if (!selectable) return <li className="flex flex-col gap-0.5 px-4 py-3">{body}</li>;
  return (
    <li className="border-b border-border last:border-b-0">
      <label className="flex cursor-pointer items-start gap-3 px-4 py-3">
        <input type="checkbox" checked={selected} onChange={onToggle} className={`${dense ? "mt-1" : "mt-2"} h-6 w-6 shrink-0 accent-primary`} />
        <span className="flex min-w-0 flex-col gap-0.5">{body}</span>
      </label>
    </li>
  );
}

const KIND_STYLE: Record<string, string> = {
  station: "bg-blue-50 text-blue-900 border-blue-200",
  shelf: "bg-amber-50 text-amber-900 border-amber-200",
  done: "bg-green-50 text-green-900 border-green-200",
  shipping: "bg-cyan-50 text-cyan-900 border-cyan-200",
  other: "bg-gray-50 text-gray-900 border-gray-200",
};

/** The slot's header: huge name, what it is, how full. */
export function SlotHeader({ slot, onOpenBag }: { slot: TrackSlotSummary; onOpenBag?: (code: string) => void }) {
  return (
    <div className={`rounded-2xl border px-4 py-3 ${KIND_STYLE[slot.kind] ?? KIND_STYLE.other}`}>
      <p className="text-4xl font-black uppercase leading-none tracking-tight break-words sm:text-5xl">{slot.name}</p>
      <p className="mt-1 text-base font-semibold">{placeSubtitle(slot)}</p>
      <p className="text-sm font-bold">
        {fillText(slot.capacity, slot.cardCount)}
        {slot.overCapacity && <span className="ml-1 text-red-700">· more than it holds</span>}
        {!slot.active && <span className="ml-1 text-red-700">· switched off</span>}
      </p>
      {slot.bags.length > 0 && (
        <div className="mt-2 flex flex-wrap items-center gap-2 text-sm">
          <span>Bags here:</span>
          {slot.bags.map((b) =>
            onOpenBag ? (
              <button
                key={b.id}
                type="button"
                onClick={() => onOpenBag(b.code)}
                className="min-h-11 rounded-xl border border-current/30 bg-white/70 px-3 font-mono font-bold hover:bg-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-current"
              >
                {b.code}
              </button>
            ) : (
              <span key={b.id} className="font-mono font-bold">{b.code}</span>
            ),
          )}
        </div>
      )}
    </div>
  );
}

/** A bag's header: Bag ID big, customer, due date, how many done, links. */
export function BagHeader({ bag, shipHref }: { bag: TrackBagSummary; shipHref: string }) {
  return (
    <div className="flex flex-col gap-1 px-4 pt-4 pb-3">
      <p className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Bag · {bag.tierName}</p>
      <p className="font-mono text-3xl font-black leading-none text-foreground">{bag.code}</p>
      <p className="text-lg font-black text-foreground">{bag.customer ?? "No name"}</p>
      <p className="text-sm text-muted-foreground">
        <Due day={bag.dueDate} /> · {bag.doneCount} of {bag.cardCount} done
      </p>
      {bag.location && (
        <p className="inline-flex items-center gap-1 text-base font-bold text-foreground">
          <Package className="h-4 w-4 shrink-0 text-muted-foreground" strokeWidth={1.75} aria-hidden="true" />
          Bag: {bagPlaceText(bag.location, filingLetter(bag.customer))}
        </p>
      )}
      <div className="mt-2 flex flex-wrap gap-2">
        <AdminLink href={bag.photosUrl} className={smallButton}>Photos</AdminLink>
        <AdminLink href={`/admin/receiving/bag/${encodeURIComponent(bag.id)}`} className={smallButton}>Bag page</AdminLink>
        <AdminLink href={shipHref} className={smallButton}>Ship check</AdminLink>
      </div>
    </div>
  );
}

export function OrderHeader({ order, shipHref }: { order: TrackOrderSummary; shipHref: string }) {
  return (
    <div className="flex flex-col gap-1 px-4 pt-4 pb-3">
      <p className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Order</p>
      <p className="font-mono text-3xl font-black leading-none text-foreground">{order.orderNumber}</p>
      <p className="text-lg font-black text-foreground">{order.customer ?? "No name"}</p>
      <div className="mt-2 flex flex-wrap gap-2">
        <AdminLink href={order.photosUrl} className={smallButton}>Photos</AdminLink>
        <AdminLink href={`/admin/receiving/${encodeURIComponent(order.id)}`} className={smallButton}>Receiving</AdminLink>
        <AdminLink href={shipHref} className={smallButton}>Ship check</AdminLink>
      </div>
    </div>
  );
}

export type LogItem = { id: number; at: number; tone: "ok" | "warn" | "error"; text: string };

/** What this tab did (kept while the tab is open). */
export function SessionLog({ items, onClear }: { items: LogItem[]; onClear: () => void }) {
  if (!items.length) return null;
  return (
    <details className={`${panel} group`}>
      <summary className="flex min-h-12 cursor-pointer select-none items-center justify-between gap-2 px-4 text-sm font-bold text-foreground">
        <span>This session ({items.length})</span>
        <span className="text-xs font-semibold text-muted-foreground group-open:hidden">Show</span>
      </summary>
      <ul className="border-t border-border">
        {items.map((item) => (
          <li key={item.id} className="flex items-start gap-2 border-b border-border px-4 py-2 text-sm last:border-b-0">
            {item.tone === "ok" ? (
              <CircleCheck className="mt-0.5 h-4 w-4 shrink-0 text-green-700" strokeWidth={1.75} aria-label="Saved" />
            ) : item.tone === "warn" ? (
              <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0 text-amber-700" strokeWidth={1.75} aria-label="Partly saved" />
            ) : (
              <CircleAlert className="mt-0.5 h-4 w-4 shrink-0 text-red-700" strokeWidth={1.75} aria-label="Problem" />
            )}
            <span className="min-w-0 flex-1 break-words">{item.text}</span>
            <time className="shrink-0 text-xs text-muted-foreground" dateTime={new Date(item.at).toISOString()}>
              {new Date(item.at).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })}
            </time>
          </li>
        ))}
      </ul>
      <div className="px-4 py-2">
        <button type="button" onClick={onClear} className="min-h-11 text-sm font-semibold text-muted-foreground hover:text-foreground">
          Clear list
        </button>
      </div>
    </details>
  );
}

/** A plain note inside the flow ("Nothing found for smith"). */
export function Note({ tone = "info", children }: { tone?: "info" | "warn"; children: React.ReactNode }) {
  const cls = tone === "warn" ? "border-amber-200 bg-amber-50 text-amber-900" : "border-blue-200 bg-blue-50 text-blue-900";
  return (
    <div className={`flex items-start gap-2 rounded-2xl border px-4 py-3 text-sm ${cls}`}>
      {tone === "warn" ? <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" strokeWidth={1.75} aria-hidden="true" /> : <Info className="mt-0.5 h-4 w-4 shrink-0" strokeWidth={1.75} aria-hidden="true" />}
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  );
}
