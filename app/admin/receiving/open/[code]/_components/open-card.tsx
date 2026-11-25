"use client";

import { ImageOff, LoaderCircle } from "lucide-react";
import { PhotoGrid } from "@/app/admin/receiving/[orderId]/photos/photo-grid";
import { canMove, onDesk, stateText, whereText, type OpenCard } from "../_lib/view";

/**
 * One card on the scan landing: big photos (tap for full screen, the photos
 * page's viewer), what the card is, where it is now in plain words, its
 * notes, and "Move to my desk". Done, refunded and not-arrived cards are
 * greyed with their state and no button. The board (open-board.tsx) runs
 * the move.
 */

const focusRing = "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary";
const eyebrow = "text-[11px] font-bold uppercase tracking-widest text-muted-foreground";

type Props = {
  card: OpenCard;
  deskId: string | null;
  /** This card's move is saving (alone or with the others). */
  moving: boolean;
  /** Another move is saving: the button waits. */
  busy: boolean;
  /** The server's message when this card's own move failed. */
  error: string | null;
  eager: boolean;
  onMove: () => void;
};

function Fact({ term, children, id }: { term: string; children: React.ReactNode; id?: string }) {
  return (
    <div className="min-w-0">
      <dt className={eyebrow}>{term}</dt>
      <dd id={id} tabIndex={id ? -1 : undefined} className="mt-0.5 break-words text-base text-foreground outline-none">{children}</dd>
    </div>
  );
}

function Note({ title, tone, children }: { title: string; tone: "gray" | "red"; children: string }) {
  const cls = tone === "red" ? "border-red-200 bg-red-50 text-red-950" : "border-border bg-secondary/50 text-foreground";
  return (
    <div className={`rounded-lg border px-3 py-2 text-sm ${cls}`}>
      <p className="text-[11px] font-bold uppercase tracking-widest opacity-80">{title}</p>
      <p className="mt-0.5 whitespace-pre-wrap break-words">{children}</p>
    </div>
  );
}

export function whereId(cardId: string) {
  return `open-where-${cardId}`;
}

export function OpenCardPanel({ card, deskId, moving, busy, error, eager, onMove }: Props) {
  const greyed = stateText(card.state);
  const here = onDesk(card, deskId);
  // No desk to move to (none switched on): no button; the big button area says why
  const movable = !!deskId && canMove(card, deskId);
  const headingId = `open-card-${card.id}`;
  return (
    <li
      aria-labelledby={headingId}
      className={`flex min-w-0 flex-col rounded-2xl border p-3 sm:p-4 ${greyed ? "border-dashed border-border bg-gray-50" : here ? "border-green-300 bg-white" : "border-border bg-white"}`}
    >
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <h3 id={headingId} className={`font-heading text-2xl font-black leading-tight break-words ${greyed ? "text-muted-foreground" : "text-foreground"}`}>{card.name}</h3>
          <p className="mt-0.5 text-sm text-muted-foreground break-words">{card.details}</p>
        </div>
        {greyed && (
          <span className={`shrink-0 rounded-full px-2.5 py-1 text-xs font-bold ${card.state === "done" ? "bg-green-100 text-green-800" : card.state === "refunded" ? "bg-gray-900 text-white" : "bg-amber-100 text-amber-900"}`}>
            {greyed}
          </span>
        )}
      </div>

      {/* Photos, two across and large; a greyed card's tiles are dimmed (not the full-screen view) */}
      <div className={`mt-3 [&_ul]:grid-cols-2 ${greyed ? "[&_li_img]:opacity-60 [&_li_img]:grayscale" : ""}`}>
        {card.photos.length > 0 ? (
          <PhotoGrid groups={card.photos} cardLabel={card.label} eager={eager} />
        ) : (
          <div className="flex flex-col items-center justify-center gap-1 rounded-lg border-2 border-dashed border-border bg-secondary/40 px-4 py-6 text-center">
            <ImageOff className="size-6 text-muted-foreground" strokeWidth={1.75} aria-hidden="true" />
            <p className="text-sm font-bold text-foreground">No photo yet</p>
          </div>
        )}
      </div>

      <dl className="mt-3 grid grid-cols-2 gap-x-3 gap-y-2.5">
        <Fact term="Card ID">
          {card.code ? <span className="font-mono font-black">{card.code}</span> : <span className="text-muted-foreground">No Card ID yet</span>}
        </Fact>
        <Fact term="Where it is now" id={whereId(card.id)}>
          <span aria-live="polite" className={`font-bold ${moving ? "text-muted-foreground" : here ? "text-green-700" : ""}`}>
            {moving ? (
              <span className="inline-flex items-center gap-1">
                <LoaderCircle className="size-4 shrink-0 animate-spin motion-reduce:animate-none" strokeWidth={1.75} aria-hidden="true" />
                Moving to your desk…
              </span>
            ) : (
              whereText(card, deskId)
            )}
          </span>
        </Fact>
        {card.state === "ready" && (
          <Fact term="Step">
            <span className="font-semibold">{card.stepLabel}</span>
          </Fact>
        )}
        {card.declaredValue && (
          <Fact term="Declared value">
            <span className="font-semibold tabular-nums">{card.declaredValue}</span>
          </Fact>
        )}
      </dl>

      {(card.notes || card.knownDefects) && (
        <div className="mt-3 flex flex-col gap-2">
          {card.notes && <Note title="Notes on this card" tone="gray">{card.notes}</Note>}
          {card.knownDefects && <Note title="Known defects" tone="red">{card.knownDefects}</Note>}
        </div>
      )}

      {(movable || error) && (
        <div className="mt-auto pt-4">
          {movable && (
            <button
              type="button"
              onClick={onMove}
              disabled={busy}
              // The visible words first (WCAG 2.5.3, label in name), then which card
              aria-label={moving ? undefined : `Move to my desk: ${card.short}`}
              className={`inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-xl border-2 border-primary bg-white px-4 text-base font-bold text-primary transition-colors hover:bg-primary/5 disabled:opacity-60 ${focusRing}`}
            >
              {moving && <LoaderCircle className="size-4 animate-spin motion-reduce:animate-none" strokeWidth={1.75} aria-hidden="true" />}
              {moving ? "Moving…" : "Move to my desk"}
            </button>
          )}
          {error && (
            <p role="alert" className="mt-2 rounded-lg border border-red-300 bg-red-50 px-3 py-2 text-sm font-semibold text-red-800 break-words">
              {error}
            </p>
          )}
        </div>
      )}
    </li>
  );
}
