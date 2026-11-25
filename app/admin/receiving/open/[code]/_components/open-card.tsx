"use client";

import { CircleAlert, CircleCheck, ImageOff, LoaderCircle, PackageCheck } from "lucide-react";
import { PhotoGrid } from "@/app/admin/receiving/[orderId]/photos/photo-grid";
import type { ToneLine } from "@/lib/intake/tracking/bag-home";
import { canFinish, canMove, doneButOut, onDesk, stateText, whereText, type OpenCard } from "../_lib/view";

/**
 * One card on the scan landing: big photos (tap for full screen, the photos
 * page's viewer), what the card is, where it is now in plain words, its
 * notes, "Move to my desk" and "Done" (one tap: the card goes back in its
 * bag). Done, refunded and not-arrived cards are greyed with their state and
 * no button. The board (open-board.tsx) runs the move and the Done, and
 * hands back the card's own line ("Done. Put it back in REYES's bag: Open
 * bags box, under R.", or the server's words when it failed).
 */

/** The line under one card after its own Move or Done. */
export type CardNote = { tone: "ok" | "warn" | "error"; text: string; notes: ToneLine[] };

const focusRing = "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary";
const eyebrow = "text-[11px] font-bold uppercase tracking-widest text-muted-foreground";

type Props = {
  card: OpenCard;
  deskId: string | null;
  /** This card's move or Done is saving (alone or with the others). */
  pending: "move" | "done" | null;
  /** Another action is saving: the buttons wait. */
  busy: boolean;
  /** What this card's own Move or Done said. */
  note: CardNote | null;
  eager: boolean;
  onMove: () => void;
  onDone: () => void;
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

export function noteId(cardId: string) {
  return `open-note-${cardId}`;
}

/** The order's line after Done: green when it completed the order, amber otherwise. */
export function ToneNote({ line }: { line: ToneLine }) {
  return (
    <p className={`mt-2 rounded-lg border px-3 py-2 text-sm font-bold break-words ${line.tone === "ok" ? "border-green-300 bg-white text-green-900" : "border-amber-300 bg-amber-50 text-amber-950"}`}>
      {line.text}
    </p>
  );
}

const NOTE_TONE = {
  ok: { box: "border-green-300 bg-green-50 text-green-950", Icon: CircleCheck },
  warn: { box: "border-amber-300 bg-amber-50 text-amber-950", Icon: CircleAlert },
  error: { box: "border-red-300 bg-red-50 text-red-800", Icon: CircleAlert },
} as const;

export function OpenCardPanel({ card, deskId, pending, busy, note, eager, onMove, onDone }: Props) {
  // A done card still in a holder or on a desk isn't greyed: it needs its Done (back in its bag) before the bag can ship
  const out = doneButOut(card);
  const greyed = out ? null : stateText(card.state);
  const here = onDesk(card, deskId);
  // No desk to move to (none switched on): no Move button; the big button area says why
  const movable = !!deskId && canMove(card, deskId);
  const finishable = canFinish(card);
  const moving = pending === "move";
  const finishing = pending === "done";
  const headingId = `open-card-${card.id}`;
  const tone = note ? NOTE_TONE[note.tone] : null;
  return (
    <li
      aria-labelledby={headingId}
      className={`flex min-w-0 flex-col rounded-2xl border p-3 sm:p-4 ${greyed ? "border-dashed border-border bg-gray-50" : out ? "border-amber-300 bg-white" : here ? "border-green-300 bg-white" : "border-border bg-white"}`}
    >
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <h3 id={headingId} className={`font-heading text-2xl font-black leading-tight break-words ${greyed ? "text-muted-foreground" : "text-foreground"}`}>{card.name}</h3>
          <p className="mt-0.5 text-sm text-muted-foreground break-words">{card.details}</p>
        </div>
        {(greyed || out) && (
          <span className={`shrink-0 rounded-full px-2.5 py-1 text-xs font-bold ${card.state === "done" ? "bg-green-100 text-green-800" : card.state === "refunded" ? "bg-gray-900 text-white" : "bg-amber-100 text-amber-900"}`}>
            {stateText(card.state)}
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
          <span aria-live="polite" className={`font-bold ${moving || finishing ? "text-muted-foreground" : out ? "text-amber-800" : here ? "text-green-700" : ""}`}>
            {moving || finishing ? (
              <span className="inline-flex items-center gap-1">
                <LoaderCircle className="size-4 shrink-0 animate-spin motion-reduce:animate-none" strokeWidth={1.75} aria-hidden="true" />
                {moving ? "Moving to your desk…" : "Marking done…"}
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

      {(movable || finishable || note) && (
        <div className="mt-auto pt-4">
          {(movable || finishable) && (
            <div className={`grid gap-2 ${movable && finishable ? "grid-cols-2" : "grid-cols-1"}`}>
              {movable && (
                <button
                  type="button"
                  onClick={onMove}
                  disabled={busy}
                  // The visible words first (WCAG 2.5.3, label in name), then which card
                  aria-label={moving ? undefined : `Move to my desk: ${card.short}`}
                  className={`inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-xl border-2 border-primary bg-white px-3 text-base font-bold text-primary transition-colors hover:bg-primary/5 disabled:opacity-60 ${focusRing}`}
                >
                  {moving && <LoaderCircle className="size-4 animate-spin motion-reduce:animate-none" strokeWidth={1.75} aria-hidden="true" />}
                  {moving ? "Moving…" : "Move to my desk"}
                </button>
              )}
              {finishable && (
                <button
                  type="button"
                  onClick={onDone}
                  disabled={busy}
                  aria-label={finishing ? undefined : `Done: ${card.short}`}
                  className={`inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-xl border-2 border-green-700 bg-white px-3 text-base font-bold text-green-800 transition-colors hover:bg-green-50 disabled:opacity-60 ${focusRing}`}
                >
                  {finishing
                    ? <LoaderCircle className="size-4 animate-spin motion-reduce:animate-none" strokeWidth={1.75} aria-hidden="true" />
                    : <PackageCheck className="size-4" strokeWidth={1.75} aria-hidden="true" />}
                  {finishing ? "Saving…" : "Done"}
                </button>
              )}
            </div>
          )}
          {note && tone && (
            <div
              id={noteId(card.id)}
              tabIndex={-1}
              role={note.tone === "error" ? "alert" : "status"}
              className={`${movable || finishable ? "mt-2" : ""} rounded-lg border px-3 py-2 outline-none ${tone.box}`}
            >
              <p className="flex items-start gap-1.5 text-base font-bold break-words">
                <tone.Icon className="mt-0.5 size-4 shrink-0" strokeWidth={1.75} aria-hidden="true" />
                <span className="min-w-0">{note.text}</span>
              </p>
              {note.notes.map((n) => <ToneNote key={n.text} line={n} />)}
            </div>
          )}
        </div>
      )}
    </li>
  );
}
