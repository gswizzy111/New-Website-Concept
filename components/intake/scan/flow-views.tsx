"use client";

import { forwardRef, useEffect, useRef, useState, type ReactNode } from "react";
import {
  ArrowLeft, ArrowRight, Check, ChevronRight, CircleAlert, CircleCheck, Clock, ImageOff, Info, LayoutGrid, LoaderCircle, LogOut,
  PackageCheck, ScanLine, StickyNote, TriangleAlert, X,
} from "lucide-react";
import { AdminLink } from "@/components/admin-ui/admin-link";
import { deskPagePath } from "@/lib/intake/tracking/desk-codes";
import type { TrackCardSummary, TrackSlotSummary } from "@/lib/intake/tracking/types";
import { CardPhotos, cardPhotoLabel } from "./card-photos";
import { placeSubtitle } from "./format";
import {
  ADD_ANYWAY_LABEL, BAGS_HERE_LABEL, CANCEL_LABEL, CARD_PAGE_LABEL, DONE_LABEL, DONE_QUESTION, DONE_YES_LABEL, HAS_NOTES_LABEL,
  HIDE_MESSAGE_LABEL, NO_BAGS_TEXT, OPEN_DESK_LABEL, REFUNDED_TEXT, SEARCH_TRUNCATED_TEXT, SHOW_LESS_LABEL, SHOW_MORE_LABEL,
  TAKE_OUT_LABEL, TAP_TO_PICK, backLabel, barCardLine, cardDetails, cardNoteList, customerTierLine, doneInBagLine, dueLine,
  emptyListText, emptySpotText, emptySpotTitle, hasCardNotes, listKicker, orderLine, outLine, searchHeading, whereText,
  type CardNote,
} from "./flow-text";
import { cardActions, spotRole, type CardList, type Message, type Panel } from "./scan-flow";

/**
 * What the plain Scan page draws (scan-app.tsx runs the flow, scan-flow.ts
 * decides it): the top panel (the one message), the picked card with its
 * photos, notes and buttons, a list to tap a card in, and a place with no
 * card to show. Phone first (390 px), big text, every target at least 44 px.
 */

const focusRing = "focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-primary/30";

// ─── The top panel ──────────────────────────────────────────────────────

/** A card's first photo, small, in the panel (not a button: the card view has the photos to open). */
function Thumb({ card, size = "md" }: { card: TrackCardSummary; size?: "sm" | "md" }) {
  const photo = card.photos?.[0];
  const box = size === "sm" ? "h-14 w-[42px]" : "h-24 w-[72px] sm:h-28 sm:w-[84px]";
  if (!photo) {
    return (
      <span aria-hidden="true" className={`grid shrink-0 place-items-center rounded-lg border border-dashed border-current/30 bg-white/60 ${box}`}>
        <ImageOff className="size-5 opacity-60" strokeWidth={1.75} />
      </span>
    );
  }
  return (
    <span className={`block shrink-0 overflow-hidden rounded-lg bg-white p-0.5 shadow-sm ${box}`}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={photo.tile.src} srcSet={photo.tile.srcSet} sizes="84px" alt="" decoding="async" className="h-full w-full rounded-[6px] object-contain" />
    </span>
  );
}

const TONE: Record<Message["tone"], { box: string; Icon: typeof Info }> = {
  ok: { box: "border-green-300 bg-green-50 text-green-950", Icon: CircleCheck },
  info: { box: "border-border bg-white text-foreground", Icon: Info },
  warn: { box: "border-amber-300 bg-amber-50 text-amber-950", Icon: TriangleAlert },
  error: { box: "border-red-300 bg-red-50 text-red-950", Icon: CircleAlert },
};

/**
 * The top panel: "Ready to scan" (big on the plain page), the waiting move
 * ("Scan CLAMP 07 again to move CD-2549-03 here", big, with the card's
 * thumbnail and Cancel), a save running, the last result or problem (with
 * "Add anyway" for a full desk), or the picked card. `ship`: ship check is on
 * (it shows instead of "Ready to scan"). `read`: "Got it: …"
 * over it while a scan is looked up. Takes focus after a save (tabIndex -1),
 * so no button keeps it.
 */
export const ScanPanel = forwardRef<HTMLDivElement, {
  panel: Panel;
  big: boolean;
  listening: boolean;
  ship: boolean;
  read: ReactNode;
  onCancel: () => void;
  onHide: () => void;
  onRetry: () => void;
  onStopShip: () => void;
  shipTitle: string;
  shipSub: string;
}>(function ScanPanel({ panel, big, listening, ship, read, onCancel, onHide, onRetry, onStopShip, shipTitle, shipSub }, ref) {
  const showShip = ship && panel.kind === "ready";
  const common = "relative overflow-hidden rounded-2xl shadow-sm outline-none";
  let body: ReactNode;
  let cls: string;
  let kind: string = panel.kind;
  let tone: string | undefined;
  if (showShip) {
    kind = "ship";
    cls = "bg-cyan-700 text-white px-4 py-3";
    body = (
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <p className="text-xl font-black leading-tight sm:text-2xl">{shipTitle}</p>
          <p className="mt-0.5 text-sm font-semibold opacity-90">{shipSub}</p>
        </div>
        <PanelButton onClick={onStopShip} icon>Stop</PanelButton>
      </div>
    );
  } else if (panel.kind === "ready") {
    cls = `border border-border bg-white text-foreground ${big ? "px-5 py-6 sm:px-7 sm:py-8" : "px-4 py-3"}`;
    body = (
      <div className="flex items-start gap-3">
        <span aria-hidden="true" className={`grid shrink-0 place-items-center rounded-full bg-primary/10 text-primary ${big ? "h-14 w-14 sm:h-16 sm:w-16" : "h-9 w-9"}`}>
          <ScanLine className={big ? "h-7 w-7 sm:h-8 sm:w-8" : "h-5 w-5"} strokeWidth={1.75} />
        </span>
        <div className="min-w-0 flex-1">
          <p className={`font-black leading-tight ${big ? "text-3xl sm:text-4xl" : "text-xl sm:text-2xl"}`}>{panel.title}</p>
          <p className={`font-semibold text-muted-foreground ${big ? "mt-2 text-base sm:text-lg" : "mt-0.5 text-sm"}`}>{panel.sub}</p>
        </div>
      </div>
    );
  } else if (panel.kind === "pending") {
    cls = "bg-primary text-primary-foreground px-4 py-5 sm:px-6 sm:py-7";
    body = (
      <div className="flex items-start gap-4">
        <Thumb card={panel.card} />
        <div className="min-w-0 flex-1">
          <p className="text-2xl font-black leading-tight break-words sm:text-4xl">{panel.title}</p>
          <p className="mt-2 text-base font-semibold opacity-90 sm:text-lg">{panel.sub}</p>
          <div className="mt-3">
            <PanelButton onClick={onCancel} icon>{CANCEL_LABEL}</PanelButton>
          </div>
        </div>
      </div>
    );
  } else if (panel.kind === "saving") {
    cls = "border border-border bg-white text-foreground px-4 py-5 sm:px-6";
    body = (
      <div className="flex items-center gap-4">
        <Thumb card={panel.card} />
        <p className="flex min-w-0 flex-1 items-center gap-2 text-2xl font-black leading-tight break-words">
          <LoaderCircle className="size-6 shrink-0 animate-spin motion-reduce:animate-none" strokeWidth={1.75} aria-hidden="true" />
          {panel.title}
        </p>
      </div>
    );
  } else if (panel.kind === "message") {
    const m = panel.message;
    const t = TONE[m.tone];
    tone = m.tone;
    cls = `border-2 px-4 ${big ? "py-5 sm:px-6" : "py-3"} ${t.box}`;
    body = (
      <div className="flex items-start gap-3">
        {m.card ? <Thumb card={m.card} size={big ? "md" : "sm"} /> : <t.Icon className="mt-1 size-6 shrink-0" strokeWidth={1.75} aria-hidden="true" />}
        <div className="min-w-0 flex-1">
          <p className={`font-black leading-tight break-words ${big ? "text-2xl sm:text-3xl" : "text-xl"}`}>{m.title}</p>
          {m.sub && <p className="mt-1 text-base font-semibold break-words">{m.sub}</p>}
          {m.lines?.map((l) => (
            <p key={l.text} className={`mt-2 rounded-lg border px-3 py-1.5 text-base font-bold ${l.tone === "ok" ? "border-green-300 bg-white text-green-900" : "border-amber-300 bg-amber-50 text-amber-950"}`}>{l.text}</p>
          ))}
          {(m.links?.length || m.retry) ? (
            <div className="mt-3 flex flex-wrap gap-2">
              {m.retry && (
                <button type="button" onClick={onRetry} className={`inline-flex min-h-12 items-center justify-center rounded-xl bg-amber-500 px-4 text-base font-black text-gray-950 hover:bg-amber-400 ${focusRing}`}>
                  {ADD_ANYWAY_LABEL}
                </button>
              )}
              {m.links?.map((l) => (
                <AdminLink key={l.href} href={l.href} className={`inline-flex min-h-11 items-center gap-1.5 rounded-xl border border-current/30 bg-white px-3 text-sm font-bold hover:bg-white/70 ${focusRing}`}>
                  {l.label}
                  <ArrowRight className="size-4" strokeWidth={1.75} aria-hidden="true" />
                </AdminLink>
              ))}
            </div>
          ) : null}
        </div>
        <button
          type="button"
          onClick={onHide}
          className={`-m-1.5 inline-flex min-h-11 min-w-11 shrink-0 items-center justify-center rounded-lg hover:bg-black/5 ${focusRing}`}
        >
          <X className="size-5" strokeWidth={1.75} aria-hidden="true" />
          <span className="sr-only">{HIDE_MESSAGE_LABEL}</span>
        </button>
      </div>
    );
  } else {
    cls = "border border-border bg-white text-foreground px-4 py-3";
    body = (
      <div className="flex items-center gap-3">
        <Thumb card={panel.card} size="sm" />
        <div className="min-w-0 flex-1">
          <p className="text-xl font-black leading-tight break-words sm:text-2xl">{panel.title}</p>
          <p className="mt-0.5 text-sm font-semibold text-muted-foreground">{panel.sub}</p>
        </div>
      </div>
    );
  }
  return (
    <div ref={ref} tabIndex={-1} data-scan-panel="" data-panel={kind} data-tone={tone} data-scanner={listening ? "ready" : "starting"} className={`${common} ${cls}`}>
      {body}
      {read}
    </div>
  );
});

function PanelButton({ onClick, children, icon = false }: { onClick: () => void; children: ReactNode; icon?: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="inline-flex min-h-11 shrink-0 items-center gap-1 rounded-full border border-current/40 bg-current/10 px-4 text-base font-bold hover:bg-current/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-current"
    >
      {icon && <X className="size-4" strokeWidth={1.75} aria-hidden="true" />}
      {children}
    </button>
  );
}

// ─── Notes ──────────────────────────────────────────────────────────────

const NOTE_LOOK: Record<CardNote["kind"], string> = {
  // As the scan landing's boxes: the card's own note grey, known defects red, the order's notes amber
  card: "border-border bg-secondary/50 text-foreground",
  defects: "border-red-200 bg-red-50 text-red-950",
  order: "border-amber-300 bg-amber-50 text-amber-950",
};

/** One note in its labelled box; a long one folds at 6 lines with "Show more". */
export function NoteBox({ note }: { note: CardNote }) {
  const textRef = useRef<HTMLParagraphElement | null>(null);
  const [open, setOpen] = useState(false);
  const [long, setLong] = useState(false);
  useEffect(() => {
    const el = textRef.current;
    if (!el || open || typeof ResizeObserver === "undefined") return;
    // Measured while folded (and again when the width changes): taller than 6 lines?
    const observer = new ResizeObserver(() => setLong(el.scrollHeight > el.clientHeight + 1));
    observer.observe(el);
    return () => observer.disconnect();
  }, [open, note.text]);
  return (
    <div data-note={note.kind} className={`rounded-xl border-2 px-3 py-2.5 ${NOTE_LOOK[note.kind]}`}>
      <p className="text-xs font-black uppercase tracking-widest opacity-90">{note.title}</p>
      <p ref={textRef} className={`mt-1 whitespace-pre-wrap break-words text-base ${open ? "" : "line-clamp-6"}`}>{note.text}</p>
      {(long || open) && (
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          aria-expanded={open}
          className="-mx-1 mt-1 inline-flex min-h-11 items-center rounded-lg px-1 text-sm font-bold underline underline-offset-2 hover:no-underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-current"
        >
          {open ? SHOW_LESS_LABEL : SHOW_MORE_LABEL}
        </button>
      )}
    </div>
  );
}

// ─── The picked card ────────────────────────────────────────────────────

/**
 * The picked card: photos and notes first (the notes beside the photos on a
 * computer, under the name on a phone), then whose it is, due, step and
 * where it is; Done (asks first) and Take out in a bar stuck to the bottom.
 */
export function PickedCard({
  card, from, now, asking, disabled, onBack, onAskDone, onCancelDone, onDone, onTakeOut,
}: {
  card: TrackCardSummary;
  from: CardList | null;
  now: number;
  asking: boolean;
  disabled: boolean;
  onBack: () => void;
  onAskDone: () => void;
  onCancelDone: () => void;
  onDone: () => void;
  onTakeOut: () => void;
}) {
  const questionRef = useRef<HTMLDivElement | null>(null);
  // The question takes focus, never "Mark done": a broken scan's Enter can't answer it
  useEffect(() => {
    if (asking) questionRef.current?.focus({ preventScroll: true });
  }, [asking]);
  const due = dueLine(card.dueDate);
  const details = cardDetails(card);
  const notes = cardNoteList(card);
  const actions = cardActions(card);
  const picked = !!from && from.cards.length > 1;
  const auto = !!from && !picked && (from.source === "bag" || from.source === "order");
  const out = auto ? outLine(from.out, from.cards.length, from.total) : null;
  const done = auto ? doneInBagLine(from.doneInBag) : null;
  const label = cardPhotoLabel(card);
  return (
    <section data-screen="card" data-picked-card={card.id} aria-label={label} className="flex flex-col gap-3">
      {picked && from && (
        <button type="button" onClick={onBack} className={`inline-flex min-h-11 items-center gap-1.5 self-start rounded-full px-2 text-base font-bold text-primary hover:bg-primary/10 ${focusRing}`}>
          <ArrowLeft className="size-4" strokeWidth={1.75} aria-hidden="true" />
          {backLabel(from.source, from.title)}
        </button>
      )}
      {auto && from && (
        <div className="px-1">
          <p className="text-sm font-bold text-muted-foreground">
            {listKicker(from.source)} <span className="font-mono">{from.title}</span>{from.customer ? ` · ${from.customer}` : ""}
          </p>
          {out && <p className="text-sm font-semibold text-foreground">{out}</p>}
          {done && <p className="text-sm text-muted-foreground">{done}</p>}
        </div>
      )}
      <article className="rounded-2xl border border-border bg-white p-3 sm:p-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <CardPhotos photos={card.photos} label={label} size="large" />
          <div className="flex min-w-0 flex-col gap-3">
            <div>
              <p className="text-2xl font-black leading-tight text-foreground break-words sm:text-3xl">{card.name?.trim() || "No card name"}</p>
              {details && <p className="mt-0.5 text-base text-muted-foreground break-words">{details}</p>}
              <p className="mt-1.5 flex flex-wrap items-center gap-2">
                <span className="rounded-lg bg-secondary px-2 py-0.5 font-mono text-lg font-black text-foreground">{card.code ?? "No Card ID"}</span>
                <Badges card={card} />
              </p>
            </div>
            {notes.length > 0 && (
              <div className="flex flex-col gap-2">
                {notes.map((n) => <NoteBox key={n.kind} note={n} />)}
              </div>
            )}
          </div>
        </div>
        <ul className="mt-3 flex flex-col gap-1 border-t border-border pt-3 text-base text-foreground">
          <li className="font-semibold break-words">{orderLine(card)}</li>
          <li className={due.late ? "flex items-center gap-1.5 font-bold text-red-700" : undefined}>
            {due.late && <TriangleAlert className="size-4 shrink-0" strokeWidth={1.75} aria-hidden="true" />}
            {due.text}
          </li>
          <li>
            Step: <span className={`font-bold ${card.done ? "text-green-700" : ""}`}>{card.stageLabel}</span>
          </li>
          <li className="flex items-center gap-1.5 font-semibold">
            <Clock className="size-4 shrink-0 text-muted-foreground" strokeWidth={1.75} aria-hidden="true" />
            {whereText(card, now)}
          </li>
        </ul>
        {card.refunded && <p className="mt-2 text-sm font-semibold text-muted-foreground">{REFUNDED_TEXT}</p>}
        <AdminLink href={card.cardUrl} className={`mt-2 inline-flex min-h-11 items-center gap-1 rounded-lg text-sm font-bold text-primary underline-offset-2 hover:underline ${focusRing}`}>
          {CARD_PAGE_LABEL}
          <ArrowRight className="size-4" strokeWidth={1.75} aria-hidden="true" />
        </AdminLink>
      </article>

      {(actions.done || actions.takeout) && (
        <div
          role="group"
          aria-label={`What to do with ${label}`}
          className="sticky bottom-0 z-20 -mx-4 border-t border-border bg-white/95 px-4 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] shadow-[0_-8px_24px_-12px_rgb(0_0_0/0.25)] backdrop-blur sm:-mx-6 sm:px-6 lg:bottom-4 lg:mx-0 lg:rounded-2xl lg:border lg:px-4 lg:pb-3"
        >
          <div className="flex flex-col gap-2">
            {/* On a phone the card can sit under this bar: say which card the buttons act on */}
            <p className="truncate text-sm text-foreground lg:hidden">{barCardLine(card)}</p>
            {asking ? (
              <div ref={questionRef} tabIndex={-1} role="group" aria-labelledby="scan-done-question" className="flex flex-col gap-2 outline-none">
                <p id="scan-done-question" className="text-lg font-bold text-foreground">{DONE_QUESTION}</p>
                <div className="grid grid-cols-2 gap-2">
                  <button type="button" onClick={onDone} disabled={disabled} className={`inline-flex min-h-14 items-center justify-center gap-2 rounded-2xl bg-green-700 px-3 text-lg font-black text-white hover:bg-green-800 disabled:opacity-50 ${focusRing}`}>
                    <PackageCheck className="size-5 shrink-0" strokeWidth={1.75} aria-hidden="true" />
                    {DONE_YES_LABEL}
                  </button>
                  <button type="button" onClick={onCancelDone} className={`inline-flex min-h-14 items-center justify-center rounded-2xl border border-border bg-white px-3 text-lg font-bold text-foreground ${focusRing}`}>
                    {CANCEL_LABEL}
                  </button>
                </div>
              </div>
            ) : (
              <div className={`grid gap-2 ${actions.done && actions.takeout ? "grid-cols-2" : "grid-cols-1"}`}>
                {actions.done && (
                  <button type="button" onClick={onAskDone} disabled={disabled} className={`inline-flex min-h-14 items-center justify-center gap-2 rounded-2xl bg-green-700 px-3 text-lg font-black text-white hover:bg-green-800 disabled:opacity-50 ${focusRing}`}>
                    <PackageCheck className="size-5 shrink-0" strokeWidth={1.75} aria-hidden="true" />
                    {DONE_LABEL}
                  </button>
                )}
                {actions.takeout && (
                  <button type="button" onClick={onTakeOut} disabled={disabled} className={`inline-flex min-h-14 items-center justify-center gap-2 rounded-2xl border-2 border-border bg-white px-3 text-lg font-black text-foreground hover:border-primary/50 disabled:opacity-50 ${focusRing}`}>
                    <LogOut className="size-5 shrink-0" strokeWidth={1.75} aria-hidden="true" />
                    {TAKE_OUT_LABEL}
                  </button>
                )}
              </div>
            )}
          </div>
        </div>
      )}
    </section>
  );
}

function Badges({ card }: { card: TrackCardSummary }) {
  return (
    <>
      {card.done && (
        <span className="inline-flex items-center gap-0.5 rounded-full bg-green-100 px-2 py-0.5 text-xs font-bold text-green-800">
          <Check className="size-3.5" strokeWidth={1.75} aria-hidden="true" />
          Done
        </span>
      )}
      {card.refunded && <span className="rounded-full bg-gray-900 px-2 py-0.5 text-xs font-bold text-white">Refunded</span>}
      {card.awaiting && <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-bold text-amber-800">Not arrived</span>}
    </>
  );
}

// ─── A list to pick from ────────────────────────────────────────────────

/** A bag's or order's cards still in the bag, a desk's cards, a holder's (2+), a search: one big button per card. */
export function CardListView({ list, now, onPick }: { list: CardList; now: number; onPick: (card: TrackCardSummary) => void }) {
  const out = outLine(list.out, list.cards.length, list.total);
  const done = doneInBagLine(list.doneInBag);
  const role = list.source;
  const bigTitle = role === "search" ? searchHeading(list.title, list.cards.length, !!list.truncated) : list.title;
  return (
    <section data-screen="list" aria-labelledby="scan-list-title" className="flex flex-col gap-3">
      <div className="rounded-2xl border border-border bg-white px-4 py-3">
        <p className="text-xs font-bold uppercase tracking-wider text-muted-foreground">{listKicker(role)}</p>
        <h2 id="scan-list-title" className={`font-black leading-tight text-foreground break-words ${role === "bag" || role === "order" ? "font-mono text-3xl" : role === "search" ? "text-2xl" : "text-3xl uppercase sm:text-4xl"}`}>
          {bigTitle}
        </h2>
        {list.customer && <p className="text-lg font-black text-foreground">{list.customer}</p>}
        {role === "desk" && (
          <AdminLink href={deskPagePath(list.code)} className={`mt-2 inline-flex min-h-11 items-center gap-1.5 rounded-full border border-border bg-white px-4 text-sm font-bold hover:border-primary/40 ${focusRing}`}>
            <LayoutGrid className="size-4" strokeWidth={1.75} aria-hidden="true" />
            {OPEN_DESK_LABEL}
          </AdminLink>
        )}
      </div>
      {list.cards.length > 0 ? (
        <>
          <p className="px-1 text-base font-bold text-foreground">{TAP_TO_PICK}</p>
          <ul className="flex flex-col gap-3">
            {list.cards.map((card) => (
              <li key={card.id} className="overflow-hidden rounded-2xl border border-border bg-white">
                <button
                  type="button"
                  data-pick-card={card.id}
                  onClick={() => onPick(card)}
                  className={`flex min-h-16 w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-primary/5 active:bg-primary/10 ${focusRing}`}
                >
                  <span className="min-w-0 flex-1">
                    <span className="sr-only">Pick </span>
                    <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
                      <span className="font-mono text-lg font-black text-foreground">{card.code ?? "No Card ID"}</span>
                      {hasCardNotes(card) && (
                        <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2 py-0.5 text-xs font-bold text-amber-900">
                          <StickyNote className="size-3.5" strokeWidth={1.75} aria-hidden="true" />
                          {HAS_NOTES_LABEL}
                        </span>
                      )}
                      <Badges card={card} />
                    </span>
                    <span className="block text-base font-bold text-foreground break-words">{card.name?.trim() || "No card name"}</span>
                    <span className="block text-sm text-muted-foreground">{customerTierLine(card)} · {dueLine(card.dueDate).text}</span>
                    {role === "search" && <span className="block text-sm font-semibold text-foreground">{whereText(card, now)}</span>}
                  </span>
                  <ChevronRight className="size-6 shrink-0 text-primary" strokeWidth={1.75} aria-hidden="true" />
                </button>
                <div className="px-4 pb-3">
                  <CardPhotos photos={card.photos} label={cardPhotoLabel(card)} />
                </div>
              </li>
            ))}
          </ul>
        </>
      ) : (
        <p className="rounded-2xl border-2 border-dashed border-border bg-white px-4 py-4 text-lg font-bold text-foreground">{emptyListText(role, list.title)}</p>
      )}
      {(out || done || list.truncated) && (
        <div className="px-1 text-base">
          {out && <p className="font-semibold text-foreground">{out}</p>}
          {done && <p className="text-muted-foreground">{done}</p>}
          {list.truncated && <p className="text-sm text-muted-foreground">{SEARCH_TRUNCATED_TEXT}</p>}
        </div>
      )}
    </section>
  );
}

// ─── A place with no card to show ───────────────────────────────────────

/** An empty holder or desk ("CLAMP 07 · empty"), or a place that holds bags (its bags, each opens like a scan). */
export function PlaceView({ place, onOpenBag }: { place: TrackSlotSummary; onOpenBag: (code: string) => void }) {
  const role = spotRole(place);
  if (role === "holder" || role === "desk") {
    return (
      <section data-screen="place" aria-labelledby="scan-place-title" className="rounded-2xl border-2 border-dashed border-border bg-white px-4 py-4">
        <h2 id="scan-place-title" className="text-4xl font-black uppercase leading-none tracking-tight text-foreground break-words sm:text-5xl">{emptySpotTitle(place.name)}</h2>
        <p className="mt-2 text-base font-semibold text-muted-foreground">{placeSubtitle(place)}</p>
        <p className="mt-3 text-lg font-bold text-foreground">{emptySpotText(place.name)}</p>
        {role === "desk" && (
          <AdminLink href={deskPagePath(place.code)} className={`mt-3 inline-flex min-h-11 items-center gap-1.5 rounded-full border border-border bg-white px-4 text-sm font-bold hover:border-primary/40 ${focusRing}`}>
            <LayoutGrid className="size-4" strokeWidth={1.75} aria-hidden="true" />
            {OPEN_DESK_LABEL}
          </AdminLink>
        )}
      </section>
    );
  }
  return (
    <section data-screen="place" aria-labelledby="scan-place-title" className="rounded-2xl border border-border bg-white px-4 py-4">
      <h2 id="scan-place-title" className="text-4xl font-black uppercase leading-none tracking-tight text-foreground break-words sm:text-5xl">{place.name}</h2>
      <p className="mt-2 text-base font-semibold text-muted-foreground">{placeSubtitle(place)}</p>
      {place.bags.length > 0 ? (
        <div className="mt-3 flex flex-wrap items-center gap-2 text-base">
          <span className="font-bold">{BAGS_HERE_LABEL}</span>
          {place.bags.map((b) => (
            <button
              key={b.id}
              type="button"
              onClick={() => onOpenBag(b.code)}
              className={`min-h-11 rounded-xl border border-border bg-white px-3 font-mono font-bold hover:border-primary/40 ${focusRing}`}
            >
              {b.code}
            </button>
          ))}
        </div>
      ) : (
        <p className="mt-3 text-base text-muted-foreground">{NO_BAGS_TEXT}</p>
      )}
    </section>
  );
}
