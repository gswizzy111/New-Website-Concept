"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { ArrowRight, ArrowRightLeft, Check, CircleAlert, CircleCheck, Clock, LayoutGrid, LoaderCircle, LogOut, PackageCheck, ScanLine, TriangleAlert, X } from "lucide-react";
import { AdminLink } from "@/components/admin-ui/admin-link";
import { HolderPicker, type Holder, type PickResult } from "@/app/admin/receiving/desk/_components/holder-picker";
import { storeDesk, useStoredDesk } from "@/app/admin/receiving/open/[code]/_components/desk-choice";
import { DESK_PAGE, deskPagePath, isDeskCode } from "@/lib/intake/tracking/desk-codes";
import type { TrackActionResponse, TrackCardSummary, TrackSlotSummary } from "@/lib/intake/tracking/types";
import * as api from "./api";
import { CardPhotos, SCAN_READ_EVENT, cardPhotoLabel } from "./card-photos";
import { beep } from "./feedback";
import { cardsLabel, placeSubtitle } from "./format";
import {
  EMPTY_HOLDER_TEXT, REFUNDED_TEXT, actionLabel, cardDetails, doneQuestion, doneYesLabel, dueLine, holderButtons,
  holderCountText, holderOutcome, inHolderText, myDesk, orderLine, pickedText, savingText, type HolderAction, type HolderResult,
} from "./holder-format";
import { addLogItem, scanSessionId, soundStore } from "./session-store";
import { Flash, type FlashState } from "./views";

/**
 * A scanned holder on the Scan page (owner, Nov 26 2026: "when you scan on a
 * station that has a card in it, it is a little more clear"): CLAMP 07,
 * HEAT PRESS 02 or a desk, phone first. Top to bottom:
 *   - the holder, huge: "CLAMP 07 · has 1 card", "HEAT PRESS 02 · 8 cards",
 *     "CLAMP 07 · empty" (dark when a card is in it, so it reads at a glance);
 *   - the result of the last action (the server's sentence: Done says where
 *     the bag is; the order's auto-complete line; "Open desk page");
 *   - each card, big: photos, name, year / set / #, Card ID, customer, order,
 *     tier, due date with days left or late, step, time in this holder;
 *   - the buttons (a bar at the bottom of a phone): one card: "Move to my
 *     desk", "Move to another holder" (the Desk page's holder picker, or scan
 *     the next holder), "Done" (asks first; back in its bag), "Take out"
 *     (back in its bag, not done); a stack: tick boxes, "Move all N to my
 *     desk", "Done for selected", "Move selected", "Take out selected".
 * Every save goes through the tracking API (api.ts: move, done, release) in
 * the Scan page's queue (`run`), so a scan that comes in meanwhile waits its
 * turn; then the holder is read again (`refresh`) and the page is ready for
 * the next scan (nothing that takes typing keeps focus: the result line
 * takes it, and the desk choice lets go). Words: holder-format.ts.
 */

type Props = {
  slot: TrackSlotSummary;
  /** The Scan page's minute clock ("for 2 hours"). */
  now: number;
  /** The Scan page is busy (a scan being looked up): the buttons wait. */
  busy: string | null;
  /** Cards the Scan page is waiting to move out of this holder ("Move to another holder", then a scan); null when not. */
  moving: TrackCardSummary[] | null;
  /** Runs a save after the scans before it; false when another step is still running (nothing was started). */
  run: (task: () => Promise<void>) => boolean;
  /** Reads the holder again and shows it. */
  refresh: (code: string) => Promise<void>;
  /** "Move to another holder": the next holder scanned gets these cards. */
  onScanNext: (cards: TrackCardSummary[]) => void;
  /** Stop waiting for that scan. */
  onCancelScanNext: () => void;
  /** The Scan page's own last save (a scan after Move, a card tapped in): shown here when it went into this holder. */
  lastSave?: { key: number; res: TrackActionResponse } | null;
  /** A bag kept at this place: open it as if scanned. */
  onOpenBag?: (code: string) => void;
  /** Under the cards: the Scan page's "Tap a card from bag …" list. */
  children?: ReactNode;
};

type Shown = HolderResult & { key: number };

const focusRing = "focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-primary/30";
const primaryButton = `inline-flex min-h-14 w-full items-center justify-center gap-2 rounded-2xl bg-primary px-4 text-lg font-black text-primary-foreground transition hover:bg-primary/90 active:scale-[0.98] motion-reduce:active:scale-100 motion-reduce:transition-none disabled:opacity-50 ${focusRing}`;
const otherButton = `inline-flex min-h-12 min-w-0 items-center justify-center gap-1.5 rounded-xl border px-2 text-center text-sm font-bold leading-tight transition-colors disabled:opacity-50 ${focusRing}`;
const BUTTON_TONE: Record<HolderAction, string> = {
  desk: "border-primary/40 bg-white text-primary hover:bg-primary/5",
  other: "border-border bg-white text-foreground hover:border-primary/50",
  done: "border-green-300 bg-green-50 text-green-900 hover:bg-green-100",
  takeout: "border-border bg-white text-foreground hover:border-primary/50",
};
const ICON: Record<HolderAction, typeof ArrowRight> = { desk: LayoutGrid, other: ArrowRightLeft, done: PackageCheck, takeout: LogOut };

/** When a result came (comparable with the Scan page's lastSave keys). Only ever called from taps and saves, never while drawing. */
const stamp = () => Date.now();

function scrollToTop() {
  const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  window.scrollTo({ top: 0, behavior: reduce ? "auto" : "smooth" });
}

export function HolderView({ slot, now, busy, moving, run, refresh, onScanNext, onCancelScanNext, lastSave, onOpenBag, children }: Props) {
  const storedDesk = useStoredDesk();
  const desk = myDesk(slot.desks, storedDesk);
  const onMyDesk = !!desk && (desk.id ? desk.id === slot.id : desk.code === slot.code);
  const cards = slot.cards;
  const stack = cards.length > 1;
  const [picked, setPicked] = useState<Set<string>>(() => new Set());
  const chosen = cards.filter((c) => picked.has(c.id));
  /** Done was tapped: these cards, once "Mark done" is tapped. */
  const [confirm, setConfirm] = useState<string[] | null>(null);
  /** The holder picker is open for these cards. */
  const [picker, setPicker] = useState<TrackCardSummary[] | null>(null);
  const [saving, setSaving] = useState<string | null>(null);
  const [result, setResult] = useState<Shown | null>(null);
  /** Results up to this key are hidden (Hide, or a new scan). */
  const [hiddenUpTo, setHiddenUpTo] = useState(0);
  const [flash, setFlash] = useState<FlashState | null>(null);
  const flashTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const resultRef = useRef<HTMLDivElement>(null);
  const bar = useRef<HTMLDivElement>(null);
  const [barHeight, setBarHeight] = useState(0);

  // A new scan: the last result, an open question or the picker go (the answer to the scan shows)
  useEffect(() => {
    const onScan = () => {
      setHiddenUpTo(Date.now());
      setConfirm(null);
      setPicker(null);
    };
    window.addEventListener(SCAN_READ_EVENT, onScan);
    return () => window.removeEventListener(SCAN_READ_EVENT, onScan);
  }, []);

  // Esc drops the Done question
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setConfirm(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  useEffect(() => () => {
    if (flashTimer.current) clearTimeout(flashTimer.current);
  }, []);

  // On a phone the buttons are a bar fixed at the bottom: keep the same room under the cards so nothing hides behind it
  useEffect(() => {
    const el = bar.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(() => setBarHeight(el.offsetHeight));
    ro.observe(el);
    return () => ro.disconnect();
  }, [cards.length]);

  // The newest result: this view's own, or the Scan page's save into this holder (its desk link is in the header already)
  const incoming: Shown | null = lastSave && lastSave.res.location?.code === slot.code
    ? { key: lastSave.key, ...holderOutcome("other", [], lastSave.res, slot.name), deskCode: null }
    : null;
  const shown = [result, incoming].filter((s): s is Shown => !!s && s.key > hiddenUpTo).sort((a, b) => b.key - a.key)[0] ?? null;

  const blocked = !!busy || !!saving;
  const movable = cards.filter((c) => !c.refunded);
  const buttons = holderButtons({ stack, onMyDesk, refunded: !stack && !!cards[0]?.refunded });
  const waitingHere = !!moving && moving.length > 0;

  function showFlash(tone: "ok" | "error", text: string) {
    if (flashTimer.current) clearTimeout(flashTimer.current);
    setFlash({ key: stamp(), tone, text });
    flashTimer.current = setTimeout(() => setFlash(null), tone === "ok" ? 900 : 1800);
  }

  /** After a save: the sound, the big tick, the session list, the result line; then the page is ready for the next scan. */
  function report(action: HolderAction, list: TrackCardSummary[], res: TrackActionResponse) {
    const out = holderOutcome(action, list, res, slot.name);
    beep(out.outcome.tone === "ok" ? "ok" : "error", soundStore.get());
    showFlash(out.outcome.tone === "ok" ? "ok" : "error", out.outcome.title);
    addLogItem(out.outcome.tone, out.outcome.title);
    for (const n of out.outcome.orderNotes ?? []) addLogItem(n.tone === "ok" ? "ok" : "warn", n.text);
    setResult({ key: stamp(), ...out });
    settleFocus();
  }

  function reportFailure(error: string) {
    beep("error", soundStore.get());
    showFlash("error", error);
    addLogItem("error", error);
    setResult({ key: stamp(), outcome: { tone: "error", title: error, lines: [], notes: [] }, deskCode: null });
    settleFocus();
  }

  /** The result line takes focus (a pressed button may be gone with its card; a focused box would catch the scanner's typing) and shows. */
  function settleFocus() {
    requestAnimationFrame(() => {
      resultRef.current?.focus({ preventScroll: true });
      scrollToTop();
    });
  }

  /** One save in the Scan page's queue: say it's running, call, report, read the holder again. */
  function save(action: HolderAction, list: TrackCardSummary[], call: () => Promise<api.ApiResult<TrackActionResponse>>, toName?: string) {
    if (!list.length) return;
    setConfirm(null);
    run(async () => {
      setSaving(savingText(action, cardsLabel(list), toName));
      const res = await call();
      setSaving(null);
      if (!res.ok) {
        reportFailure(res.error);
        // The cards moved meanwhile (another phone), or the holder was switched off: show it as it is now
        if (res.status === 409) await refresh(slot.code);
        return;
      }
      setPicked((s) => new Set([...s].filter((id) => !res.data.results.some((r) => r.ok && r.cardId === id))));
      report(action, list, res.data);
      await refresh(slot.code);
    });
  }

  function toDesk(list: TrackCardSummary[]) {
    if (!desk) return;
    const to = desk;
    // A desk has no limit; one set on it is no reason to keep a card off your own desk
    save("desk", list, () => api.move({ fromCode: slot.code, toCode: to.code, cardIds: list.map((c) => c.id), force: true, sessionId: scanSessionId() }));
  }

  function markDone(ids: string[]) {
    const list = cards.filter((c) => ids.includes(c.id));
    save("done", list, () => api.done({ cardIds: list.map((c) => c.id), sessionId: scanSessionId() }));
  }

  function takeOut(list: TrackCardSummary[]) {
    save("takeout", list, () => api.release({ cardIds: list.map((c) => c.id), sessionId: scanSessionId() }));
  }

  /** "Move to another holder": the next holder scanned gets them, or one picked from the list. */
  function startOther(list: TrackCardSummary[]) {
    if (!list.length) return;
    setConfirm(null);
    onScanNext(list);
    setPicker(list);
  }

  /** A holder picked (or typed) in the picker: move there; a full one comes back to the picker as "Add anyway?". */
  function pickHolder(holder: Holder, force: boolean): Promise<PickResult> {
    const list = picker ?? moving ?? [];
    if (!list.length) return Promise.resolve({ ok: false, error: "Pick at least one card." });
    return new Promise<PickResult>((resolve) => {
      const started = run(async () => {
        try {
          setSaving(savingText("other", cardsLabel(list), holder.name ?? holder.code));
          const res = await api.move({ fromCode: slot.code, toCode: holder.code, cardIds: list.map((c) => c.id), force, sessionId: scanSessionId() });
          setSaving(null);
          if (!res.ok) {
            beep("error", soundStore.get());
            resolve({ ok: false, error: res.error, conflict: res.conflict });
            if (res.status === 409 && !res.conflict) await refresh(slot.code);
            return;
          }
          setPicker(null);
          onCancelScanNext();
          setPicked(new Set());
          report("other", list, res.data);
          resolve({ ok: true });
          await refresh(slot.code);
        } catch {
          setSaving(null);
          resolve({ ok: false, error: "Something went wrong. Scan the holder again to see where the cards are." });
        }
      });
      if (!started) resolve({ ok: false, error: "Still saving the last change. Try again in a moment." });
    });
  }

  function onAction(action: HolderAction) {
    const single = !stack;
    const list = single ? cards : chosen;
    if (action === "desk") toDesk(single ? cards : movable);
    else if (action === "other") startOther(list);
    else if (action === "done") {
      if (list.length) setConfirm(list.map((c) => c.id));
    } else takeOut(list);
  }

  function actionDisabled(action: HolderAction): boolean {
    if (blocked) return true;
    if (action === "desk") return !desk || (stack ? movable.length === 0 : !!cards[0]?.refunded);
    if (stack) return chosen.length === 0;
    if (action === "takeout") return false;
    return !!cards[0]?.refunded;
  }

  function toggle(id: string) {
    setConfirm(null);
    setPicked((s) => {
      const next = new Set(s);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  const allPicked = cards.length > 0 && chosen.length === cards.length;
  const what = stack ? null : cards[0] ? cardPhotoLabel(cards[0]) : null;
  const severalDesks = (slot.desks?.length ?? 0) > 1;

  return (
    <section aria-labelledby={`holder-${slot.id}`} className="flex flex-col gap-3">
      <Flash flash={flash} />
      <HolderHeader slot={slot} onOpenBag={onOpenBag} />

      {/* The last action's result; it takes focus after a save (no box that takes typing keeps it) */}
      <div ref={resultRef} tabIndex={-1} role="status" aria-live="polite" className="outline-none empty:-mt-3">
        {shown && <ResultLine shown={shown} onHide={() => setHiddenUpTo(shown.key)} />}
      </div>

      {cards.length === 0 ? (
        <p className="rounded-2xl border-2 border-dashed border-border bg-white px-4 py-4 text-lg font-bold text-foreground">{EMPTY_HOLDER_TEXT}</p>
      ) : stack ? (
        <>
          <div className="flex items-center justify-between gap-2 px-1">
            <p className="text-sm font-bold text-foreground">{pickedText(chosen.length, cards.length)}</p>
            <button
              type="button"
              onClick={() => {
                setConfirm(null);
                setPicked(allPicked ? new Set() : new Set(cards.map((c) => c.id)));
              }}
              className="min-h-11 shrink-0 rounded-full px-3 text-sm font-bold text-primary hover:bg-primary/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
            >
              {allPicked ? "Pick none" : "Pick all"}
            </button>
          </div>
          <ul aria-label={`Cards in ${slot.name}`} className="flex flex-col gap-3">
            {cards.map((card) => (
              <li
                key={card.id}
                className={`rounded-2xl border bg-white p-3 sm:p-4 ${picked.has(card.id) ? "border-primary ring-2 ring-primary/40" : "border-border"}`}
              >
                <div className="flex items-start gap-2">
                  <label className="-ml-1.5 -mt-1.5 flex min-h-11 min-w-11 shrink-0 cursor-pointer items-center justify-center rounded-lg hover:bg-secondary">
                    <input
                      id={`pick-${card.id}`}
                      type="checkbox"
                      checked={picked.has(card.id)}
                      onChange={() => toggle(card.id)}
                      className="size-6 cursor-pointer accent-primary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
                    />
                    <span className="sr-only">Pick {cardPhotoLabel(card)}</span>
                  </label>
                  <div className="min-w-0 flex-1">
                    <CardBody card={card} slot={slot} now={now} compact={cards.length > 3} pickId={`pick-${card.id}`} />
                  </div>
                </div>
              </li>
            ))}
          </ul>
        </>
      ) : (
        <article aria-label={what ?? undefined} className="rounded-2xl border border-border bg-white p-3 sm:p-4">
          <CardBody card={cards[0]} slot={slot} now={now} />
        </article>
      )}

      {/* With 2+ desks: which one is "my desk" on this phone (the bag page's choice too) */}
      {cards.length > 0 && severalDesks && slot.desks && (
        <label className="flex flex-wrap items-center gap-2 px-1 text-sm">
          <span className="font-bold text-foreground">My desk</span>
          <select
            value={desk?.code ?? ""}
            onChange={(e) => {
              storeDesk(e.target.value);
              // A focused select would take the scanner's typing
              e.currentTarget.blur();
            }}
            className="min-h-11 rounded-xl border border-border bg-white px-3 text-base font-semibold text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
          >
            {slot.desks.map((d) => (
              <option key={d.id} value={d.code}>{d.name}</option>
            ))}
          </select>
        </label>
      )}

      {children}

      {/* The buttons: a bar at the bottom of a phone (thumb reach), under the cards on a computer */}
      {cards.length > 0 && (
        <>
          <div aria-hidden="true" className="lg:hidden" style={{ height: barHeight }} />
          <div
            ref={bar}
            role="group"
            aria-label={stack ? `What to do with the cards in ${slot.name}` : `What to do with ${what ?? "the card"}`}
            className="fixed inset-x-0 bottom-0 z-20 border-t border-border bg-white/95 px-4 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] backdrop-blur lg:static lg:z-auto lg:rounded-2xl lg:border lg:bg-white lg:px-4 lg:pb-3 lg:backdrop-blur-none"
          >
            <div className="mx-auto flex max-w-3xl flex-col gap-2">
              {saving ? (
                <p className="flex min-h-14 items-center gap-2 text-base font-bold text-foreground">
                  <LoaderCircle className="size-5 shrink-0 animate-spin motion-reduce:animate-none" strokeWidth={1.75} aria-hidden="true" />
                  {saving}
                </p>
              ) : confirm ? (
                <div role="group" aria-label="Mark done?" className="flex flex-col gap-2">
                  <p className="text-base font-bold text-foreground">{doneQuestion(confirm.length)}</p>
                  <div className="grid grid-cols-2 gap-2">
                    <button type="button" onClick={() => markDone(confirm)} disabled={blocked} className={`${otherButton} min-h-14 border-green-700 bg-green-700 text-base text-white hover:bg-green-800`}>
                      <PackageCheck className="size-5 shrink-0" strokeWidth={1.75} aria-hidden="true" />
                      {doneYesLabel(confirm.length)}
                    </button>
                    <button type="button" onClick={() => setConfirm(null)} className={`${otherButton} min-h-14 border-border bg-white text-base text-foreground`}>
                      Cancel
                    </button>
                  </div>
                </div>
              ) : waitingHere && !picker ? (
                <div className="flex flex-col gap-2">
                  <p className="flex items-center gap-2 text-base font-bold text-foreground">
                    <ScanLine className="size-5 shrink-0 text-primary" strokeWidth={1.75} aria-hidden="true" />
                    Scan the next holder, or pick it from the list.
                  </p>
                  <div className="grid grid-cols-2 gap-2">
                    <button type="button" onClick={() => setPicker(moving)} disabled={blocked} className={`${otherButton} min-h-14 border-primary bg-primary text-base text-primary-foreground hover:bg-primary/90`}>
                      Pick from the list
                    </button>
                    <button type="button" onClick={onCancelScanNext} className={`${otherButton} min-h-14 border-border bg-white text-base text-foreground`}>
                      Cancel
                    </button>
                  </div>
                </div>
              ) : (
                <>
                  <button type="button" onClick={() => onAction(buttons.primary)} disabled={actionDisabled(buttons.primary)} className={primaryButton}>
                    <span className="flex flex-col items-center leading-tight">
                      <span>{actionLabel(buttons.primary, stack, movable.length)}</span>
                      {buttons.primary === "desk" && severalDesks && desk && <span className="text-xs font-bold opacity-80">{desk.name}</span>}
                    </span>
                  </button>
                  {buttons.others.length > 0 && (
                    <div className={`grid gap-2 ${buttons.others.length === 3 ? "grid-cols-3" : "grid-cols-2"}`}>
                      {buttons.others.map((a) => {
                        const Icon = ICON[a];
                        return (
                          <button key={a} type="button" onClick={() => onAction(a)} disabled={actionDisabled(a)} className={`${otherButton} ${BUTTON_TONE[a]}`}>
                            <Icon className="hidden size-4 shrink-0 min-[400px]:block" strokeWidth={1.75} aria-hidden="true" />
                            {actionLabel(a, stack, movable.length)}
                          </button>
                        );
                      })}
                    </div>
                  )}
                  {!desk && buttons.primary === "desk" && (
                    <p className="text-sm text-muted-foreground">
                      No desk yet.{" "}
                      <AdminLink href={DESK_PAGE} className="font-bold text-primary underline-offset-2 hover:underline">Open the Desk page</AdminLink>
                      {" "}once to make one.
                    </p>
                  )}
                </>
              )}
            </div>
          </div>
        </>
      )}

      <HolderPicker
        cardIds={picker ? picker.map((c) => c.id) : null}
        what={picker ? cardsLabel(picker) : ""}
        deskId={slot.id}
        onPick={pickHolder}
        onClose={() => setPicker(null)}
      />
    </section>
  );
}

/** The holder, huge: dark with a card in it, a dashed outline when empty. */
function HolderHeader({ slot, onOpenBag }: { slot: TrackSlotSummary; onOpenBag?: (code: string) => void }) {
  const full = slot.cardCount > 0;
  const desk = slot.kind === "other" && isDeskCode(slot.code);
  return (
    <div className={`rounded-2xl px-4 py-4 ${full ? "bg-foreground text-background" : "border-2 border-dashed border-border bg-white text-foreground"}`}>
      <h2 id={`holder-${slot.id}`} className="flex flex-wrap items-baseline gap-x-2.5 gap-y-1 leading-none">
        <span className="text-4xl font-black uppercase tracking-tight break-words sm:text-5xl">{slot.name}</span>
        <span className={`text-2xl font-black sm:text-3xl ${full ? "" : "text-muted-foreground"}`}>· {holderCountText(slot)}</span>
      </h2>
      <p className={`mt-2 text-base font-semibold ${full ? "opacity-80" : "text-muted-foreground"}`}>
        {placeSubtitle(slot)}
        {slot.overCapacity && <span className={full ? "text-amber-300" : "text-red-700"}> · more than it holds</span>}
        {!slot.active && <span className={full ? "text-amber-300" : "text-red-700"}> · switched off</span>}
      </p>
      {(desk || slot.bags.length > 0) && (
        <div className="mt-3 flex flex-wrap items-center gap-2 text-sm">
          {desk && (
            <AdminLink
              href={deskPagePath(slot.code)}
              className={`inline-flex min-h-11 items-center gap-1.5 rounded-full border px-4 font-bold ${full ? "border-background/30 bg-background/10 hover:bg-background/20" : "border-border bg-white hover:border-primary/40"} focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40`}
            >
              <LayoutGrid className="size-4" strokeWidth={1.75} aria-hidden="true" />
              Open desk page
            </AdminLink>
          )}
          {slot.bags.length > 0 && <span>Bags here:</span>}
          {slot.bags.map((b) =>
            onOpenBag ? (
              <button
                key={b.id}
                type="button"
                onClick={() => onOpenBag(b.code)}
                className="min-h-11 rounded-xl border border-current/30 px-3 font-mono font-bold hover:bg-current/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-current"
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

/** One card, big: photos, name, year / set / #, Card ID, whose, due, step, how long it has been here. */
function CardBody({ card, slot, now, compact = false, pickId }: { card: TrackCardSummary; slot: TrackSlotSummary; now: number; compact?: boolean; pickId?: string }) {
  const due = dueLine(card.dueDate);
  const details = cardDetails(card);
  const text = (
    <>
      <p className={`font-black leading-tight text-foreground break-words ${compact ? "text-xl" : "text-2xl sm:text-3xl"}`}>{card.name?.trim() || "No card name"}</p>
      {details && <p className="mt-0.5 text-base text-muted-foreground break-words">{details}</p>}
      <p className="mt-1.5 flex flex-wrap items-center gap-2">
        <span className="rounded-lg bg-secondary px-2 py-0.5 font-mono text-lg font-black text-foreground">{card.code ?? "No Card ID"}</span>
        {card.done && (
          <span className="inline-flex items-center gap-0.5 rounded-full bg-green-100 px-2 py-0.5 text-xs font-bold text-green-800">
            <Check className="size-3.5" strokeWidth={1.75} aria-hidden="true" />
            Done
          </span>
        )}
        {card.refunded && <span className="rounded-full bg-gray-900 px-2 py-0.5 text-xs font-bold text-white">Refunded</span>}
        {card.awaiting && <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-bold text-amber-800">Not arrived</span>}
      </p>
      <ul className="mt-2 flex flex-col gap-1 text-base text-foreground">
        <li className="font-semibold break-words">{orderLine(card)}</li>
        <li className={due.late ? "inline-flex items-center gap-1.5 font-bold text-red-700" : undefined}>
          {due.late && <TriangleAlert className="size-4 shrink-0" strokeWidth={1.75} aria-hidden="true" />}
          {due.text}
        </li>
        <li>
          Step: <span className={`font-bold ${card.done ? "text-green-700" : ""}`}>{card.stageLabel}</span>
        </li>
        <li className="inline-flex items-center gap-1.5 font-semibold">
          <Clock className="size-4 shrink-0 text-muted-foreground" strokeWidth={1.75} aria-hidden="true" />
          {inHolderText(card.location ?? slot, card.locatedAt, now)}
        </li>
      </ul>
      {card.refunded && <p className="mt-2 text-sm font-semibold text-muted-foreground">{REFUNDED_TEXT}</p>}
    </>
  );
  return (
    <div className="flex flex-col gap-3">
      {/* Photos first: tell the card by eye (a tap opens them full screen; never inside the tick box's label) */}
      <CardPhotos photos={card.photos} label={cardPhotoLabel(card)} size={compact ? "list" : "large"} />
      {/* In a stack, tapping the words ticks the card too */}
      {pickId ? <label htmlFor={pickId} className="block min-w-0 cursor-pointer">{text}</label> : <div className="min-w-0">{text}</div>}
    </div>
  );
}

/** What the last action did, in the server's words (Done says where the bag is), with the order's line and the links that follow. */
function ResultLine({ shown, onHide }: { shown: Shown; onHide: () => void }) {
  const { outcome, deskCode } = shown;
  const tone = outcome.tone === "ok"
    ? { box: "border-green-300 bg-green-50 text-green-950", Icon: CircleCheck }
    : outcome.tone === "warn"
      ? { box: "border-amber-300 bg-amber-50 text-amber-950", Icon: TriangleAlert }
      : { box: "border-red-300 bg-red-50 text-red-950", Icon: CircleAlert };
  const { Icon } = tone;
  return (
    <div className={`rounded-2xl border px-4 py-3 ${tone.box}`}>
      <div className="flex items-start gap-2">
        <Icon className="mt-0.5 size-5 shrink-0" strokeWidth={1.75} aria-hidden="true" />
        <div className="min-w-0 flex-1">
          <p className="text-base font-bold break-words">{outcome.title}</p>
          {outcome.notes.map((n) => <p key={n} className="text-sm">{n}</p>)}
          {outcome.orderNotes?.map((n) => (
            <p key={n.text} className={`mt-1.5 rounded-lg border px-2.5 py-1.5 text-sm font-bold ${n.tone === "ok" ? "border-green-300 bg-white text-green-900" : "border-amber-300 bg-amber-50 text-amber-950"}`}>{n.text}</p>
          ))}
          {outcome.lines.length > 0 && (
            <ul className="mt-1.5 max-h-40 overflow-y-auto overscroll-contain border-t border-current/15 pt-1.5 text-sm">
              {outcome.lines.map((l) => (
                <li key={l.key} className="flex gap-2 py-0.5">
                  {l.label && <span className={`shrink-0 font-mono font-bold ${l.ok ? "" : "text-red-800"}`}>{l.label}</span>}
                  <span className="min-w-0 break-words">{l.message}</span>
                </li>
              ))}
            </ul>
          )}
          {(deskCode || (outcome.bagLinks?.length ?? 0) > 0) && (
            <div className="mt-2 flex flex-wrap gap-2">
              {deskCode && (
                <AdminLink href={deskPagePath(deskCode)} className="inline-flex min-h-11 items-center gap-1.5 rounded-xl border border-current/30 bg-white px-3 text-sm font-bold hover:bg-white/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40">
                  <LayoutGrid className="size-4" strokeWidth={1.75} aria-hidden="true" />
                  Open desk page
                </AdminLink>
              )}
              {outcome.bagLinks?.map((l) => (
                <AdminLink key={l.key} href={l.href} className="inline-flex min-h-11 items-center gap-1.5 rounded-xl border border-current/30 bg-white px-3 text-sm font-bold hover:bg-white/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40">
                  {l.label}
                  <ArrowRight className="size-4" strokeWidth={1.75} aria-hidden="true" />
                </AdminLink>
              ))}
            </div>
          )}
        </div>
        <button
          type="button"
          onClick={onHide}
          className="-m-1.5 inline-flex min-h-11 min-w-11 shrink-0 items-center justify-center rounded-lg hover:bg-black/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
        >
          <X className="size-4" strokeWidth={1.75} aria-hidden="true" />
          <span className="sr-only">Hide this message</span>
        </button>
      </div>
    </div>
  );
}
