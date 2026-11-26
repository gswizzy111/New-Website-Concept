"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowRightLeft, Check, CircleCheckBig, Keyboard, LayoutGrid, LoaderCircle, LogOut, PackageCheck, ScanLine, Volume2, VolumeX, X } from "lucide-react";
import { AdminLink } from "@/components/admin-ui/admin-link";
import { filingLetter } from "@/lib/intake/filing-letter";
import { bagPlaceText, orderCompletionNotes, type ToneLine } from "@/lib/intake/tracking/bag-home";
import { deskPagePath, isDeskCode } from "@/lib/intake/tracking/desk-codes";
import type {
  CapacityConflict,
  LocationRef,
  TrackActionResponse,
  TrackBagSummary,
  TrackCardSummary,
  TrackOrderSummary,
  TrackSlotSummary,
} from "@/lib/intake/tracking/types";
import * as api from "./api";
import { SCAN_READ_EVENT } from "./card-photos";
import { audioUnlocked, beep, unlockAudio } from "./feedback";
import { cardsLabel, roomLeft } from "./format";
import { ADD_HERE_TEXT, MOVE_WAIT_MS, finishBody, isHolderPlace, moveWaitOver, scanSaveResult, type ScanSave } from "./holder-format";
import { HolderView } from "./holder-view";
import { createScanGate, parseScan, scanReadLabel, typedSlotGuess } from "./parse";
import { ScanInput, useKeyboardWedge } from "./scan-input";
import { addLogItem, logStore, scanSessionId, soundStore, useScanLog, useSound } from "./session-store";
import {
  BagHeader,
  CardRow,
  Flash,
  Note,
  OrderHeader,
  SessionLog,
  SlotCard,
  SlotHeader,
  bigButton,
  panel,
  smallButton,
  useNow,
  type FlashState,
} from "./views";

/**
 * The Scan page (/admin/scan): one continuous flow, where the last scan
 * decides what happens next. Cards carry no sticker; staff scan the numbered
 * SLOTS (CLAMP 07, HEAT PRESS 03 ...) and the BAG labels.
 *
 *   Scan an empty slot   -> "Put a card in CLAMP 07": scan the bag (or search),
 *                           tap the card -> POST /api/admin/track/assign
 *   Scan a full slot     -> its card(s) big: Move (then scan the next slot ->
 *                           POST /move), Done (POST /done), Take out (POST /release)
 *   Scan a bag or order  -> its cards and where each one is; "Assign to a slot"
 *                           per card, then scan the slot
 *   Scan a desk          -> its cards like any place, plus "Open desk page"
 *                           (/admin/receiving/desk?desk=<code>); a stack moved
 *                           or put on a desk leaves a link to that page
 *                           (a holder's cards are all picked for Move by default)
 *   Ship check (on)      -> a bag or order scan opens /admin/receiving/ship/<orderId>
 *
 * Input: a handheld scanner only (owner, Nov 26 2026: "remove the camera,
 * make it so you can only use the scanner"): the Eyoyo paired with the
 * phone as a Bluetooth keyboard types each label's text and presses Enter,
 * caught anywhere on the page with nothing focused (scan-input.tsx
 * useKeyboardWedge); "Ready to scan" shows once it is listening and "Got it:
 * CD-2549-P" flashes on each scan. Some days a code is typed: "Type a code
 * instead" opens the code box (a code, a slot name such as "clamp 7", or a
 * search). Scans are handled one at a time, in order, so a fast scanner never
 * trips over itself. Every card listed shows its photos under it
 * (card-photos.tsx). The URL holds only ?loc=<slot code> and ?mode=ship,
 * never anything about a customer.
 */

type View =
  | { type: "start" }
  | { type: "slot"; slot: TrackSlotSummary }
  | { type: "bag"; bag: TrackBagSummary }
  | { type: "order"; order: TrackOrderSummary }
  | { type: "card"; card: TrackCardSummary }
  | { type: "search"; query: string; cards: TrackCardSummary[]; truncated: boolean };

/**
 * What the next slot scan does. A move waits at most MOVE_WAIT_MS from `at`
 * (when Move was tapped) and ends when another place or a bag is shown, so a
 * forgotten "Move to another holder" never acts on a later scan. `refused`:
 * the last holder scanned for them can't take them (it has a card: one card
 * per holder), the server's sentence.
 */
type Waiting =
  | null
  | { type: "move"; from: TrackSlotSummary; cards: TrackCardSummary[]; at: number; refused?: string }
  | { type: "assign"; cards: TrackCardSummary[]; refused?: string };

/** What "Add anyway" sends again when a slot is full. */
type Retry =
  | { type: "assign"; cards: TrackCardSummary[]; slot: { code: string; name: string } }
  | { type: "move"; from: TrackSlotSummary; to: TrackSlotSummary; cards: TrackCardSummary[] };

/** Cards offered to tap into an empty slot: the last bag, order or search (`mixed`: from several orders). */
type Picks = { label: string; cards: TrackCardSummary[]; mixed: boolean } | null;

type Source = "wedge" | "typed" | "paste" | "link";

/** The full slot's three buttons: icon over word, so all three fit a phone's width. */
const actionButton =
  "min-h-16 rounded-2xl px-2 text-base font-black inline-flex flex-col items-center justify-center gap-1 transition active:scale-[0.98] motion-reduce:active:scale-100 disabled:opacity-50 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-primary/30";

/** "Put a card in CLAMP 07" stops applying when this long has passed since the slot was scanned. */
const TARGET_TTL_MS = 10 * 60_000;

/** How long "Got it: CD-2549-P" shows after a scan. */
const READ_FLASH_MS = 1600;

/** State the queued scan handlers read: kept in a ref (always current) and mirrored to React state for drawing. */
function useMirror<T>(initial: T) {
  const [value, setValue] = useState<T>(initial);
  const ref = useRef<T>(initial);
  const set = useCallback((next: T) => {
    ref.current = next;
    setValue(next);
  }, []);
  return [value, set, ref] as const;
}

/**
 * A slot cards can be put in by tapping them: active, with room, and a work
 * station, shelf or other place. Done goes through the Done button (or
 * scanning DONE after Move); Shipping is for the ship check.
 */
function canFill(slot: TrackSlotSummary): boolean {
  return slot.active && slot.kind !== "done" && slot.kind !== "shipping" && roomLeft(slot.capacity, slot.cardCount) > 0;
}

/** "CLAMP 07 already holds Charizard. Add anyway?" (the server's sentence when it names no card). */
function conflictText(slotName: string, conflict: CapacityConflict): string {
  const names = conflict.occupants.map((c) => c.name ?? c.code ?? "a card");
  if (!names.length) return conflict.error;
  const shown = names.length > 3 ? `${names.slice(0, 3).join(", ")} and ${names.length - 3} more` : names.join(names.length === 2 ? " and " : ", ");
  return `${slotName} already holds ${shown}. Add anyway?`;
}

function scrollToTop() {
  const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  window.scrollTo({ top: 0, behavior: reduce ? "auto" : "smooth" });
}

/** The ship check page (?bag= highlights the scanned bag). */
function shipPath(orderId: string, bagId?: string | null) {
  const base = `/admin/receiving/ship/${encodeURIComponent(orderId)}`;
  return bagId ? `${base}?bag=${encodeURIComponent(bagId)}` : base;
}

/** Cards in a view that can go in a slot (not refunded). */
function placeable(cards: readonly TrackCardSummary[]) {
  return cards.filter((c) => !c.refunded);
}

/** A card list with these cards now in `to` (null: taken out). */
/** Where the request's bags are now (a card out of its bag files the bag in the Open bags box). */
function bagPlaces(res: TrackActionResponse): Map<string, LocationRef | null> {
  return new Map((res.bags ?? []).map((b) => [b.id, b.location]));
}

function patchCards(cards: TrackCardSummary[], res: TrackActionResponse, to: LocationRef | null, done = false): TrackCardSummary[] {
  const changed = new Map(res.results.filter((r) => r.ok).map((r) => [r.cardId, r]));
  const bagAt = bagPlaces(res);
  if (!changed.size && !bagAt.size) return cards;
  const at = new Date().toISOString();
  return cards.map((c) => {
    const r = changed.get(c.id);
    const moved = c.bagId && bagAt.has(c.bagId) ? { bagLocation: bagAt.get(c.bagId) ?? null } : {};
    if (!r) return { ...c, ...moved };
    return {
      ...c,
      ...moved,
      location: to,
      locatedAt: at,
      stageLabel: done ? "Done" : r.stageLabel ?? c.stageLabel,
      stage: done ? null : r.stage ?? c.stage,
      done: done || c.done,
    };
  });
}

function patchView(view: View, res: TrackActionResponse, to: LocationRef | null, done = false): View {
  const bagAt = bagPlaces(res);
  const placeOf = <B extends { id: string; location: LocationRef | null }>(b: B) => (bagAt.has(b.id) ? bagAt.get(b.id) ?? null : b.location);
  if (view.type === "bag") return { ...view, bag: { ...view.bag, location: placeOf(view.bag), cards: patchCards(view.bag.cards, res, to, done) } };
  if (view.type === "order") {
    return {
      ...view,
      order: {
        ...view.order,
        bags: view.order.bags.map((b) => ({ ...b, location: placeOf(b), cards: patchCards(b.cards, res, to, done) })),
        looseCards: patchCards(view.order.looseCards, res, to, done),
      },
    };
  }
  if (view.type === "card") return { ...view, card: patchCards([view.card], res, to, done)[0] };
  if (view.type === "search") return { ...view, cards: patchCards(view.cards, res, to, done) };
  return view;
}

export function ScanApp({ initialLoc, initialShip }: { initialLoc: string | null; initialShip: boolean }) {
  const router = useRouter();
  const now = useNow();
  const [view, setView, viewRef] = useMirror<View>({ type: "start" });
  const [waiting, setWaiting, waitingRef] = useMirror<Waiting>(null);
  const [target, setTarget, targetRef] = useMirror<{ slot: TrackSlotSummary; at: number } | null>(null);
  const [picks, setPicks, picksRef] = useMirror<Picks>(null);
  const [ship, setShip, shipRef] = useMirror<boolean>(initialShip);
  const [conflict, setConflict] = useState<{ text: string; conflict: CapacityConflict; retry: Retry } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [flash, setFlash] = useState<FlashState | null>(null);
  /** "Got it: CD-2549-P" (a place: "Got it: HEAT PRESS 02") over the top panel for a moment after each scan. */
  const [read, setRead] = useState<{ key: number; code: string; text: string } | null>(null);
  /** The code box ("Type a code instead"), closed until tapped. */
  const [typing, setTyping] = useState(false);
  const [status, setStatus] = useState("");
  const log = useScanLog();
  const sound = useSound();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [confirmDone, setConfirmDone] = useState(false);
  /** The desk cards were last put on (a link to its page stays until the next save elsewhere). */
  const [deskNote, setDeskNote] = useState<{ code: string; text: string } | null>(null);
  /** The order's line after a Done finished it ("Order completed. Maria Reyes emailed."; amber when it wasn't completed), until the next save. */
  const [orderNotes, setOrderNotes] = useState<ToneLine[]>([]);
  /** The last save here (cleared by the next scan): a holder view shows it when it was about that holder (cards put in it, or Done / Take out of its cards). */
  const [lastSave, setLastSave] = useState<ScanSave | null>(null);
  const queue = useRef<Promise<void>>(Promise.resolve());
  const pending = useRef(0);
  const gate = useRef(createScanGate());
  const flashTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const readTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Sounds may only start after a tap or key press on the page. A touch's
  // pointerdown doesn't count on an iPhone (the tap's end does), so every tap
  // end, click and key press tries until the sound is on.
  useEffect(() => {
    const events = ["pointerup", "touchend", "click", "keydown"] as const;
    const off = () => events.forEach((name) => window.removeEventListener(name, unlock, true));
    function unlock() {
      unlockAudio();
      if (audioUnlocked()) off();
    }
    events.forEach((name) => window.addEventListener(name, unlock, true));
    return off;
  }, []);

  useEffect(() => () => {
    if (flashTimer.current) clearTimeout(flashTimer.current);
    if (readTimer.current) clearTimeout(readTimer.current);
  }, []);

  // Escape (a computer's keyboard) drops what the next scan was going to do; not the Esc that
  // closes a photo, a sheet or the code box (handled there, or pressed inside a dialog)
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key !== "Escape" || e.defaultPrevented) return;
      if (e.target instanceof Element && e.target.closest("dialog")) return;
      setWaiting(null);
      setConflict(null);
      setConfirmDone(false);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [setWaiting]);

  // "Done" asks for a second tap; the question goes away after a few seconds
  useEffect(() => {
    if (!confirmDone) return;
    const t = setTimeout(() => setConfirmDone(false), 4000);
    return () => clearTimeout(t);
  }, [confirmDone]);

  // A waiting move ends after MOVE_WAIT_MS (onSlot checks the time too: a phone's timers sleep while it is locked)
  useEffect(() => {
    if (waiting?.type !== "move") return;
    const w = waiting;
    const t = setTimeout(() => {
      if (waitingRef.current !== w) return;
      setWaiting(null);
      setStatus("");
    }, Math.max(0, w.at + MOVE_WAIT_MS - Date.now()));
    return () => clearTimeout(t);
  }, [waiting, setWaiting, waitingRef]);

  // The URL: the slot on screen (?loc=) and ship check (?mode=ship); nothing else
  const urlLoc = view.type === "slot" ? view.slot.code : null;
  useEffect(() => {
    const params = new URLSearchParams();
    if (ship) params.set("mode", "ship");
    if (urlLoc) params.set("loc", urlLoc);
    const query = params.toString();
    const next = `${window.location.pathname}${query ? `?${query}` : ""}`;
    if (next !== `${window.location.pathname}${window.location.search}`) window.history.replaceState(null, "", next);
  }, [ship, urlLoc]);

  const show = useCallback((tone: "ok" | "error", text: string) => {
    if (flashTimer.current) clearTimeout(flashTimer.current);
    setFlash({ key: Date.now(), tone, text });
    setStatus(text);
    flashTimer.current = setTimeout(() => setFlash(null), tone === "ok" ? 900 : 1800);
  }, []);

  /**
   * A code came in: "Got it: CD-2549-P" for a moment, and an open photo
   * closes so the answer shows. A place says its name, not its code ("Got
   * it: HEAT PRESS 02": read from the code, then the place's own name once
   * looked up, placeRead).
   */
  const gotIt = useCallback((code: string) => {
    if (readTimer.current) clearTimeout(readTimer.current);
    const text = scanReadLabel(code);
    setRead({ key: Date.now(), code, text });
    setStatus(`Got it: ${text}`);
    readTimer.current = setTimeout(() => setRead(null), READ_FLASH_MS);
  }, []);

  /** The scanned place's own name in "Got it: …" while it still shows (a renamed place's code reads differently). */
  const placeRead = useCallback((code: string, name: string) => {
    setRead((r) => (r && r.code === code && r.text !== name ? { ...r, text: name } : r));
  }, []);

  const fail = useCallback(
    (text: string, logIt = true) => {
      beep("error", soundStore.get());
      show("error", text);
      if (logIt) addLogItem("error", text);
    },
    [show],
  );

  const saved = useCallback(
    (res: TrackActionResponse, fallback: string, from?: Pick<ScanSave, "at" | "action" | "cards">) => {
      const problem = api.partialProblem(res);
      const text = res.message || fallback;
      // The order auto-complete line (a Done that finished the order, or why it wasn't completed)
      const notes = orderCompletionNotes(res.orderCompletions);
      setOrderNotes(notes);
      // `from`: a Done or Take out of a holder's cards (no place in the answer): that holder says what happened
      setLastSave({ key: Date.now(), res, ...from });
      for (const n of notes) addLogItem(n.tone === "ok" ? "ok" : "warn", n.text);
      if (problem && res.results.some((r) => r.ok)) {
        beep("error", soundStore.get());
        show("error", `${text} ${problem}`);
        addLogItem("warn", `${text} ${problem}`);
      } else if (problem) {
        fail(problem);
      } else {
        beep("ok", soundStore.get());
        show("ok", text);
        addLogItem("ok", text);
      }
    },
    [fail, show],
  );

  /** After a save: cards put on a desk leave a link to the Desk page; a save anywhere else clears it. */
  const noteDesk = useCallback((res: TrackActionResponse | null) => {
    const to = res?.location ?? null;
    const onDesk = !!res && !!to && isDeskCode(to.code) && res.results.some((r) => r.ok);
    setDeskNote(onDesk ? { code: to.code, text: res.message || `Cards on ${to.name}.` } : null);
  }, []);

  /** Runs one step after the ones before it (scans and taps alike). */
  const enqueue = useCallback((task: () => Promise<void>) => {
    pending.current += 1;
    queue.current = queue.current
      .then(task)
      .catch(() => {
        // a step's own errors are shown by the step
      })
      .finally(() => {
        pending.current -= 1;
      });
  }, []);

  /**
   * A button that saves (Done, Take out, Put in, Add anyway): ignored while a
   * step is still running, so a double tap (before the buttons turn grey)
   * never saves twice. Scans still queue up behind each other.
   */
  const tapSave = useCallback(
    (task: () => Promise<void>) => {
      if (pending.current > 0) return;
      enqueue(task);
    },
    [enqueue],
  );

  const showSlot = useCallback(
    (slot: TrackSlotSummary) => {
      // Another place than the one on screen (a scan): the page goes to the top, so its name shows
      const prev = viewRef.current;
      if (!(prev.type === "slot" && prev.slot.code === slot.code)) scrollToTop();
      // A move waiting for the next holder belongs to the holder it started from: another one shown ends it
      const w = waitingRef.current;
      if (w?.type === "move" && w.from.code !== slot.code) setWaiting(null);
      setView({ type: "slot", slot });
      setSelected(new Set(slot.cards.map((c) => c.id)));
      setConfirmDone(false);
      setTarget(canFill(slot) ? { slot, at: Date.now() } : null);
    },
    [setTarget, setView, setWaiting, viewRef, waitingRef],
  );

  /** The slot again from the server (after a save), shown. */
  const refreshSlot = useCallback(
    async (code: string) => {
      const res = await api.resolve(code);
      if (res.ok && res.data.kind === "location") showSlot(res.data.location);
    },
    [showSlot],
  );

  // ----- saves -----

  /**
   * Puts cards in a slot. From a bag, order, search or card the page stays
   * there (each row then shows its new place) and a slot with room left stays
   * the one cards go into; from the slot's own list the slot is shown again.
   */
  const doAssign = useCallback(
    async (cards: TrackCardSummary[], slot: { code: string; name: string }, force = false) => {
      setConflict(null);
      setBusy(`Putting ${cardsLabel(cards)} in ${slot.name}…`);
      const res = await api.assign({ locationCode: slot.code, cardIds: cards.map((c) => c.id), force, sessionId: scanSessionId() });
      setBusy(null);
      if (!res.ok) {
        if (res.conflict) {
          beep("error", soundStore.get());
          setStatus(res.error);
          setConflict({ text: conflictText(slot.name, res.conflict), conflict: res.conflict, retry: { type: "assign", cards, slot } });
          return;
        }
        fail(res.error);
        // A holder that has a card (one card per holder): the cards still wait for one, the top panel says why
        const w = waitingRef.current;
        if (res.full && w?.type === "assign") setWaiting({ ...w, refused: res.error });
        else if (res.full && targetRef.current?.slot.code === slot.code) setTarget(null);
        return;
      }
      setWaiting(null);
      saved(res.data, `${cardsLabel(cards)} in ${slot.name}.`);
      noteDesk(res.data);
      const to = res.data.location;
      if (picksRef.current) setPicks({ ...picksRef.current, cards: patchCards(picksRef.current.cards, res.data, to) });
      const current = viewRef.current;
      if (current.type === "slot" || current.type === "start") {
        await refreshSlot(slot.code);
        return;
      }
      setView(patchView(current, res.data, to));
      const t = targetRef.current;
      if (t?.slot.code === slot.code) {
        const again = await api.resolve(slot.code);
        if (again.ok && again.data.kind === "location") {
          const fresh = again.data.location;
          setTarget(canFill(fresh) ? { slot: fresh, at: t.at } : null);
        } else {
          setTarget(null);
        }
      }
    },
    [fail, noteDesk, picksRef, refreshSlot, saved, setPicks, setTarget, setView, setWaiting, targetRef, viewRef, waitingRef],
  );

  const doMove = useCallback(
    async (from: TrackSlotSummary, to: TrackSlotSummary, cards: TrackCardSummary[], force = false) => {
      setConflict(null);
      setBusy(`Moving ${cardsLabel(cards)} to ${to.name}…`);
      // Always the cards on screen: a card put in the slot since then (another phone) stays where it is
      const res = await api.move({ fromCode: from.code, toCode: to.code, cardIds: cards.map((c) => c.id), force, sessionId: scanSessionId() });
      setBusy(null);
      if (!res.ok) {
        if (res.conflict) {
          beep("error", soundStore.get());
          setStatus(res.error);
          setConflict({ text: conflictText(to.name, res.conflict), conflict: res.conflict, retry: { type: "move", from, to, cards } });
          return;
        }
        fail(res.error);
        if (res.full) {
          // That holder has a card (one card per holder): keep waiting for another holder, the top panel says why
          const w = waitingRef.current;
          setWaiting(w?.type === "move" && w.from.code === from.code ? { ...w, refused: res.error } : { type: "move", from, cards, at: Date.now(), refused: res.error });
          return;
        }
        if (res.status === 409) {
          // The cards aren't in the from-slot any more (or a slot is switched off): stop waiting, show it as it is now
          setWaiting(null);
          await refreshSlot(from.code);
        }
        return;
      }
      setWaiting(null);
      saved(res.data, `${cardsLabel(cards)} moved to ${to.name}.`);
      noteDesk(res.data);
      if (picksRef.current) setPicks({ ...picksRef.current, cards: patchCards(picksRef.current.cards, res.data, res.data.location) });
      await refreshSlot(to.code);
    },
    [fail, noteDesk, picksRef, refreshSlot, saved, setPicks, setWaiting, waitingRef],
  );

  /**
   * Done or Take out, for cards in `slot` (shown again after) or picked from a
   * bag or search (null: the list stays). From a slot (the DONE sign after
   * Move, the slot view's Done and Take out) the request names it
   * (`fromCode`): a card moved meanwhile is refused, never finished where it
   * is now; none left in it is a 409, and the slot is shown as it is now.
   */
  const doFinish = useCallback(
    async (kind: "done" | "release", slot: TrackSlotSummary | null, cards: TrackCardSummary[]) => {
      setConfirmDone(false);
      setBusy(kind === "done" ? `Marking ${cardsLabel(cards)} done…` : `Taking ${cardsLabel(cards)} out…`);
      const body = finishBody(cards.map((c) => c.id), slot, scanSessionId());
      const res = kind === "done" ? await api.done(body) : await api.release(body);
      setBusy(null);
      if (!res.ok) {
        fail(res.error);
        if (res.status === 409 && slot) {
          // The cards aren't in the slot any more (someone moved them): stop waiting, show it as it is now
          setWaiting(null);
          await refreshSlot(slot.code);
        }
        return;
      }
      setWaiting(null);
      // From a holder (the DONE sign after "Move to another holder"): that holder shows the answer (where the bag is)
      const from = slot ? { at: slot.code, action: kind === "done" ? ("done" as const) : ("takeout" as const), cards } : undefined;
      saved(res.data, kind === "done" ? `${cardsLabel(cards)} done.` : `${cardsLabel(cards)} taken out${slot ? ` of ${slot.name}` : ""}.`, from);
      noteDesk(null);
      if (picksRef.current) {
        setPicks({ ...picksRef.current, cards: patchCards(picksRef.current.cards, res.data, res.data.location, kind === "done") });
      }
      if (slot) await refreshSlot(slot.code);
      else setView(patchView(viewRef.current, res.data, res.data.location, kind === "done"));
    },
    [fail, noteDesk, picksRef, refreshSlot, saved, setPicks, setView, setWaiting, viewRef],
  );

  // ----- what a scan does -----

  const onSlot = useCallback(
    async (slot: TrackSlotSummary) => {
      let w = waitingRef.current;
      // A move forgotten for MOVE_WAIT_MS is over: this scan only shows the place
      if (w?.type === "move" && moveWaitOver(w.at, Date.now())) {
        setWaiting(null);
        w = null;
      }
      // Move or Assign, then the DONE sign: the cards are finished
      if (w && slot.kind === "done") {
        await doFinish("done", w.type === "move" ? w.from : null, w.cards);
        return;
      }
      if (w?.type === "move") {
        if (slot.code === w.from.code) {
          fail(`${slot.name} is where ${w.cards.length === 1 ? "it is" : "they are"} now. Scan the next slot.`, false);
          return;
        }
        await doMove(w.from, slot, w.cards);
        return;
      }
      if (w?.type === "assign") {
        await doAssign(w.cards, slot);
        return;
      }
      setConflict(null);
      showSlot(slot);
    },
    [doAssign, doFinish, doMove, fail, setWaiting, showSlot, waitingRef],
  );

  const showCards = useCallback(
    (next: View, label: string, cards: TrackCardSummary[]) => {
      setConflict(null);
      setWaiting(null);
      // A scan replaces what's on screen: the page goes to the top, so its answer shows
      scrollToTop();
      setView(next);
      setPicks({ label, cards, mixed: next.type === "search" });
      // An empty slot scanned long ago no longer counts as "put a card in"
      const t = targetRef.current;
      if (t && Date.now() - t.at > TARGET_TTL_MS) setTarget(null);
    },
    [setPicks, setTarget, setView, setWaiting, targetRef],
  );

  const runSearch = useCallback(
    async (query: string) => {
      if (query.length < 2) {
        fail("Type at least 2 letters or numbers to search.", false);
        return;
      }
      setBusy(`Searching “${query}”…`);
      const res = await api.search(query);
      setBusy(null);
      if (!res.ok) {
        fail(res.error, false);
        return;
      }
      const cards = res.data.cards;
      setStatus(cards.length ? `${cards.length} card${cards.length === 1 ? "" : "s"} found.` : `Nothing found for “${query}”.`);
      showCards({ type: "search", query, cards, truncated: res.data.truncated }, `“${query}”`, cards);
    },
    [fail, showCards],
  );

  const handleCode = useCallback(
    async (code: string, source: Source) => {
      setBusy("Looking it up…");
      const res = await api.resolve(code);
      setBusy(null);
      if (!res.ok) {
        // Scanning it again right away must work (a dropped connection, a retry)
        gate.current.forget(code);
        fail(res.status === 404 ? `${code}: not found. The label may be from a deleted slot or bag.` : res.error);
        return;
      }
      const found = res.data;
      if (found.kind === "location") {
        placeRead(code, found.location.name);
        // Ship check is about bags and orders; a scanned slot works as always
        await onSlot(found.location);
        return;
      }
      if (shipRef.current && source !== "link") {
        beep("ok", soundStore.get());
        setBusy("Opening the ship check…");
        router.push(
          found.kind === "bag"
            ? shipPath(found.bag.orderId, found.bag.id)
            : found.kind === "order"
              ? shipPath(found.order.id)
              : shipPath(found.card.orderId, found.card.bagId),
        );
        return;
      }
      if (found.kind === "bag") {
        showCards({ type: "bag", bag: found.bag }, `bag ${found.bag.code}`, placeable(found.bag.cards));
      } else if (found.kind === "order") {
        const cards = [...found.order.bags.flatMap((b) => b.cards), ...found.order.looseCards];
        showCards({ type: "order", order: found.order }, `order ${found.order.orderNumber}`, placeable(cards));
      } else {
        showCards({ type: "card", card: found.card }, found.card.code ?? "the card", placeable([found.card]));
      }
    },
    [fail, onSlot, placeRead, router, shipRef, showCards],
  );

  /** Every scan, typed code, pasted link and search comes in here. */
  const onInput = useCallback(
    (raw: string, source: Source) => {
      const text = raw.trim();
      if (!text) return;
      const parsed = parseScan(text);
      // Typed "clamp 7" is the slot CLAMP 07 (it also has an order code's shape, CLAMP-7)
      const slotGuess = source === "typed" || source === "paste" ? typedSlotGuess(text) : null;
      if (source === "wedge") {
        // A scanner that reads the same label twice in a row sends it once
        if (!gate.current(parsed?.code ?? text.toUpperCase().slice(0, 200), Date.now())) return;
      }
      if ((source === "typed" || source === "paste") && !slotGuess) {
        // A repeat of the same code right after (a scanner typing into the box) is ignored too
        if (parsed && !gate.current(parsed.code, Date.now())) return;
      }
      // Taken: a photo open full screen closes, so the answer shows; the last save's line
      // belongs to the view before this scan (an ignored double read changes nothing)
      if (source !== "link") window.dispatchEvent(new Event(SCAN_READ_EVENT));
      setLastSave(null);
      if (parsed && !slotGuess) {
        if (source !== "link") {
          beep("read", soundStore.get());
          gotIt(parsed.code);
        }
        enqueue(() => handleCode(parsed.code, source));
        return;
      }
      if (source === "wedge") {
        fail("Not a Card Doc code. Scan a slot or a bag label.");
        return;
      }
      // Typed: a slot by its name ("clamp 7"), else a search
      enqueue(async () => {
        if (slotGuess) {
          const res = await api.resolve(slotGuess);
          if (res.ok && res.data.kind === "location") {
            await onSlot(res.data.location);
            return;
          }
        }
        await runSearch(text);
      });
    },
    [enqueue, fail, gotIt, handleCode, onSlot, runSearch],
  );

  // The scanner: caught anywhere on the page, nothing needs focus (true once it is listening)
  const scannerReady = useKeyboardWedge(onInput);

  // Opened from a slot's QR (/q/LOC-CLAMP-07 -> /admin/scan?loc=LOC-CLAMP-07): show that slot
  const started = useRef(false);
  useEffect(() => {
    if (started.current || !initialLoc) return;
    started.current = true;
    onInput(initialLoc, "link");
  }, [initialLoc, onInput]);

  const slotView = view.type === "slot" ? view.slot : null;
  const slotCards = slotView ? slotView.cards : [];
  const chosen = slotCards.filter((c) => selected.has(c.id));
  const allChosen = slotCards.length > 0 && chosen.length === slotCards.length;
  const slotIsDesk = !!slotView && slotView.kind === "other" && isDeskCode(slotView.code);
  const activeTarget = target && now - target.at <= TARGET_TTL_MS ? target.slot : null;
  // A holder or desk (CLAMP 07, HEAT PRESS 02, DESK): the holder view (holder-view.tsx) with its own buttons
  const holderView = !!slotView && isHolderPlace(slotView);
  const showActions = !!slotView && !holderView && slotCards.length > 0 && !waiting;

  // ----- taps -----

  function cancelWaiting() {
    setWaiting(null);
    setConflict(null);
    // The screen-reader line said "Scan the next slot for …": nothing waits now
    setStatus("");
  }

  function startAssign(cards: TrackCardSummary[]) {
    // The slot cards go into ("Put a card in CLAMP 07"): put it there now
    if (activeTarget) {
      const slot = activeTarget;
      tapSave(() => doAssign(cards, slot));
      return;
    }
    // Else: the next slot scanned gets them
    setConflict(null);
    setWaiting({ type: "assign", cards });
    setStatus(`Scan the slot for ${cardsLabel(cards)}.`);
    scrollToTop();
  }

  function openSlot(code: string) {
    enqueue(async () => {
      setBusy("Opening the slot…");
      const res = await api.resolve(code);
      setBusy(null);
      if (res.ok && res.data.kind === "location") {
        setWaiting(null);
        showSlot(res.data.location);
        scrollToTop();
      } else if (!res.ok) fail(res.error, false);
    });
  }

  function addAnyway() {
    // A scan still being looked up: keep the question on screen (tap again in a moment)
    if (!conflict || pending.current > 0) return;
    const r = conflict.retry;
    setConflict(null);
    tapSave(() => (r.type === "assign" ? doAssign(r.cards, r.slot, true) : doMove(r.from, r.to, r.cards, true)));
  }

  function toggleShip() {
    const next = !ship;
    setShip(next);
    setWaiting(null);
    setConflict(null);
    setStatus(next ? "Ship check on: scan the bag or order label." : "Ship check off.");
  }

  function toggleSound() {
    const next = !sound;
    soundStore.set(next);
    if (next) beep("read", true);
  }

  // ----- drawing -----

  /** A card row's button: "Put in CLAMP 07" while a slot is waiting for a card, else "Assign to a slot". */
  const putAction = (card: TrackCardSummary) => {
    if (card.refunded || card.done) return null;
    if (activeTarget) {
      const inIt = card.location?.code === activeTarget.code;
      return { label: inIt ? `In ${activeTarget.name}` : `Put in ${activeTarget.name}`, disabled: inIt || !!busy, primary: !inIt };
    }
    return { label: "Assign to a slot", disabled: !!busy };
  };
  const onCardAction = (card: TrackCardSummary) => startAssign([card]);

  // The line that says what the next scan does ("Ready to scan" when nothing is waiting for one)
  let cue: { title: string; sub?: string; tone: string; ready?: boolean; cancel?: () => void; cancelLabel?: string; link?: { href: string; label: string } };
  if (waiting?.refused) {
    // The last holder scanned has a card already: say so until the next scan (a holder, or Cancel)
    cue = { title: `Scan another holder for ${cardsLabel(waiting.cards)}`, sub: waiting.refused, tone: "border border-red-300 bg-red-50 text-red-950", cancel: cancelWaiting };
  } else if (waiting?.type === "move") {
    cue = { title: `Scan the next slot for ${cardsLabel(waiting.cards)}`, sub: `Moving from ${waiting.from.name}. Or type its name (desk, clamp 7) below.`, tone: "bg-primary text-primary-foreground", cancel: cancelWaiting };
  } else if (waiting?.type === "assign") {
    cue = { title: `Scan the slot for ${cardsLabel(waiting.cards)}`, sub: "Or type its name (desk, clamp 7) below.", tone: "bg-primary text-primary-foreground", cancel: cancelWaiting };
  } else if (ship) {
    cue = { title: "Ship check: scan the bag or order", sub: "Opens its ship check page.", tone: "bg-cyan-700 text-white", cancel: toggleShip, cancelLabel: "Stop" };
  } else if (activeTarget && holderView && slotView?.code === activeTarget.code && slotCards.length > 0) {
    // A holder with cards in it, on screen: its own buttons are the one prompt; a bag scanned next still adds a card here
    cue = {
      title: scannerReady ? "Ready to scan" : "Getting ready…",
      sub: ADD_HERE_TEXT,
      tone: "bg-white text-foreground border border-border",
      ready: true,
    };
  } else if (activeTarget) {
    // An empty slot (or one scanned before a bag or search): the next card tapped goes in it
    const holding = slotView?.code === activeTarget.code && slotCards.length > 0;
    cue = {
      title: `${holding ? "Add a card to" : "Put a card in"} ${activeTarget.name}`,
      sub: holding
        ? "Scan a bag’s QR or search, then tap the card. Or pick its cards below to Move."
        : "Scan the bag’s QR, or search below, then tap the card.",
      tone: "bg-amber-300 text-gray-950",
      cancel: () => setTarget(null),
    };
  } else {
    cue = {
      // Until the page is listening for the scanner (it has loaded in the browser), it says so
      title: scannerReady ? "Ready to scan" : "Getting ready…",
      sub: "Point your scanner at a bag, order, holder or desk label and press the button.",
      tone: "bg-white text-foreground border border-border",
      ready: true,
    };
  }
  // The big panel on an empty page; a slim bar once something is on screen
  const bigCue = !!cue.ready && view.type === "start";
  // A desk on screen: on a phone its page is one tap away in the cue, which stays in view (the
  // "Open desk page" button under the desk's name can sit below the action bar there)
  if (slotView && slotIsDesk && !waiting && !ship && (!activeTarget || activeTarget.code === slotView.code)) cue.link = { href: deskPagePath(slotView.code), label: "Open desk page" };

  const pickList = activeTarget && slotView && activeTarget.code === slotView.code && picks
    ? picks.cards.filter((c) => c.location?.code !== slotView.code && !c.done)
    : [];
  // The holder view on screen says the last save itself (with the order's line): no second box above it
  const savedHere = !!slotView && holderView && !!scanSaveResult(lastSave, slotView);

  return (
    <div className={`mx-auto flex w-full max-w-3xl flex-col gap-3 px-4 py-4 sm:px-6 lg:py-8 ${showActions ? "pb-44 lg:pb-8" : "pb-10"}`}>
      <Flash flash={flash} />
      <p role="status" aria-live="polite" className="sr-only">{status}</p>

      <div className="flex items-center justify-between gap-2">
        <h1 className="font-heading text-2xl font-black text-foreground">Scan</h1>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={toggleShip}
            aria-pressed={ship}
            className={`min-h-11 rounded-full px-4 text-sm font-bold inline-flex items-center gap-1.5 border transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 ${
              ship ? "border-cyan-700 bg-cyan-700 text-white" : "border-border bg-white text-foreground hover:border-primary/40"
            }`}
          >
            <PackageCheck className="h-4 w-4" strokeWidth={1.75} aria-hidden="true" />
            Ship check
          </button>
          <button
            type="button"
            onClick={toggleSound}
            aria-pressed={sound}
            aria-label="Sound"
            className="h-11 w-11 rounded-full border border-border bg-white inline-flex items-center justify-center text-foreground hover:border-primary/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
          >
            {sound ? <Volume2 className="h-5 w-5" strokeWidth={1.75} aria-hidden="true" /> : <VolumeX className="h-5 w-5" strokeWidth={1.75} aria-hidden="true" />}
          </button>
        </div>
      </div>

      {/* What the next scan does; "Got it: CD-2549-P" flashes over it on each scan */}
      <div
        data-scanner={scannerReady ? "ready" : "starting"}
        className={`sticky top-14 z-20 overflow-hidden rounded-2xl shadow-sm lg:top-0 ${cue.tone} ${bigCue ? "px-5 py-6 sm:px-7 sm:py-8" : "px-4 py-3"}`}
      >
        <div className="flex items-start gap-3">
          {cue.ready && !busy && (
            <span
              aria-hidden="true"
              className={`grid shrink-0 place-items-center rounded-full bg-primary/10 text-primary ${bigCue ? "h-14 w-14 sm:h-16 sm:w-16" : "h-9 w-9"}`}
            >
              <ScanLine className={bigCue ? "h-7 w-7 sm:h-8 sm:w-8" : "h-5 w-5"} strokeWidth={1.75} />
            </span>
          )}
          <div className="min-w-0 flex-1">
            <p className={`font-black leading-tight break-words ${bigCue ? "text-3xl sm:text-4xl" : "text-xl sm:text-2xl"}`}>{busy ?? cue.title}</p>
            {!busy && cue.sub && <p className={`font-semibold opacity-80 ${bigCue ? "mt-2 text-base sm:text-lg" : "mt-0.5 text-sm"}`}>{cue.sub}</p>}
            {!busy && cue.link && (
              <AdminLink
                href={cue.link.href}
                className="mt-2 inline-flex min-h-11 items-center gap-1.5 rounded-full border border-current/30 bg-white/70 px-4 text-sm font-bold hover:bg-white lg:hidden focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-current"
              >
                <LayoutGrid className="h-4 w-4" strokeWidth={1.75} aria-hidden="true" />
                {cue.link.label}
              </AdminLink>
            )}
          </div>
          {busy ? (
            <LoaderCircle className="mt-1 h-6 w-6 shrink-0 animate-spin motion-reduce:animate-none" strokeWidth={1.75} aria-hidden="true" />
          ) : cue.cancel ? (
            <button
              type="button"
              onClick={cue.cancel}
              className="min-h-11 shrink-0 rounded-full border border-current/30 bg-current/10 px-3 text-sm font-bold inline-flex items-center gap-1 hover:bg-current/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-current"
            >
              <X className="h-4 w-4" strokeWidth={1.75} aria-hidden="true" />
              {cue.cancelLabel ?? "Cancel"}
            </button>
          ) : null}
        </div>
        <ReadFlash read={read} />
      </div>

      {/* Some days a code is typed: the box stays closed until asked for */}
      {typing ? (
        <ScanInput onScan={onInput} onClose={() => setTyping(false)} placeholder="Code, slot (clamp 7), desk, name or order" />
      ) : (
        <button
          type="button"
          onClick={() => setTyping(true)}
          className="-my-1 inline-flex min-h-11 items-center gap-1.5 self-start rounded-full px-2 text-sm font-bold text-primary underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
        >
          <Keyboard className="h-4 w-4" strokeWidth={1.75} aria-hidden="true" />
          Type a code instead
        </button>
      )}

      {/* The flow */}
      <div className="flex min-w-0 flex-col gap-3">
        {deskNote && slotView?.code !== deskNote.code && (
          <div className="flex items-start gap-3 rounded-2xl border border-green-200 bg-green-50 px-4 py-3 text-green-950">
            <div className="min-w-0 flex-1">
              <p className="text-base font-bold break-words">{deskNote.text}</p>
              <AdminLink href={deskPagePath(deskNote.code)} className={`${smallButton.replace("border-border", "border-green-300")} mt-2`}>
                <LayoutGrid className="h-4 w-4" strokeWidth={1.75} aria-hidden="true" />
                Open the desk page
              </AdminLink>
            </div>
            <button
              type="button"
              onClick={() => setDeskNote(null)}
              aria-label="Hide"
              className="-mr-2 -mt-1 h-11 w-11 shrink-0 rounded-full inline-flex items-center justify-center hover:bg-green-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-green-700"
            >
              <X className="h-5 w-5" strokeWidth={1.75} aria-hidden="true" />
            </button>
          </div>
        )}
        {orderNotes.length > 0 && !savedHere && (
          <div role="status" className="flex items-start gap-3 rounded-2xl border border-border bg-white px-4 py-3">
            <div className="min-w-0 flex-1 flex flex-col gap-1">
              {orderNotes.map((n) => (
                <p key={n.text} className={`text-base font-bold break-words ${n.tone === "ok" ? "text-green-800" : "text-amber-900"}`}>{n.text}</p>
              ))}
            </div>
            <button
              type="button"
              onClick={() => setOrderNotes([])}
              aria-label="Hide"
              className="-mr-2 -mt-1 h-11 w-11 shrink-0 rounded-full inline-flex items-center justify-center hover:bg-secondary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
            >
              <X className="h-5 w-5" strokeWidth={1.75} aria-hidden="true" />
            </button>
          </div>
        )}
        {conflict && (
          <div role="alert" className="rounded-2xl border border-amber-300 bg-amber-50 p-4 text-amber-950">
            <p className="text-lg font-black">{conflict.text}</p>
            {conflict.conflict.occupants.length > 0 && (
              <p className="mt-1 text-sm">
                In it now: <span className="font-mono font-bold">{conflict.conflict.occupants.map((c) => c.code ?? c.name).join(", ")}</span>
                {` · holds ${conflict.conflict.capacity === 1 ? "1 card" : `${conflict.conflict.capacity} cards`}`}
              </p>
            )}
            <div className="mt-3 grid grid-cols-2 gap-2">
              <button type="button" onClick={addAnyway} disabled={!!busy} className={`${bigButton} bg-amber-500 text-gray-950 hover:bg-amber-400`}>
                Add anyway
              </button>
              <button type="button" onClick={() => { setConflict(null); cancelWaiting(); }} className={`${bigButton} border border-amber-300 bg-white text-amber-950`}>
                Cancel
              </button>
            </div>
          </div>
        )}

        {view.type === "start" && (
          <div className={`${panel} p-4 text-sm text-muted-foreground`}>
            <p className="font-semibold text-foreground">How it works</p>
            <ul className="mt-1 list-disc space-y-1 pl-5">
              <li>Scan an <span className="font-semibold text-foreground">empty holder</span>, then scan the bag and tap the card to put in it.</li>
              <li>Scan a <span className="font-semibold text-foreground">holder with a card</span> to see it big: Move to my desk, Move to another holder (scan it, or pick it from the list), Done, or Take out.</li>
              <li>Scan a <span className="font-semibold text-foreground">bag</span> to see where each of its cards is.</li>
              <li>Each holder takes <span className="font-semibold text-foreground">one card</span>; only a desk holds more. Scan a desk to tick some of its cards and use Done, Move or Take out for those.</li>
            </ul>
            <div className="mt-3 flex flex-wrap gap-2">
              <AdminLink href="/admin/receiving/locations" className={smallButton}>Slots and labels</AdminLink>
              <AdminLink href="/admin/receiving/shelf" className={smallButton}>Shelf by due date</AdminLink>
              <AdminLink href="/admin/receiving/desk" className={smallButton}>Desk</AdminLink>
            </div>
          </div>
        )}

        {slotView && holderView && (
          <HolderView
            key={slotView.code}
            slot={slotView}
            now={now}
            busy={busy}
            moving={waiting?.type === "move" && waiting.from.code === slotView.code ? waiting.cards : null}
            run={(task) => {
              // A tap while a scan is still being handled starts nothing (the buttons are greyed then anyway)
              if (pending.current > 0) return false;
              enqueue(task);
              return true;
            }}
            refresh={refreshSlot}
            onScanNext={(cards) => {
              setConflict(null);
              setWaiting({ type: "move", from: slotView, cards, at: Date.now() });
              setStatus(`Scan the next slot for ${cardsLabel(cards)}.`);
            }}
            onCancelScanNext={cancelWaiting}
            lastSave={lastSave}
            onSaved={() => {
              // The holder's own result line replaces the older lines above it
              setDeskNote(null);
              setOrderNotes([]);
            }}
            onOpenBag={(code) => onInput(code, "link")}
          >
            {/* An empty holder: the cards of the bag (or search) scanned before it, to tap in. A holder with cards has its own buttons only */}
            {activeTarget?.code === slotView.code && slotCards.length === 0 && pickList.length > 0 && picks && (
              <div className={panel}>
                <p className="px-4 pt-3 text-sm font-bold text-foreground">Tap a card from {picks.label}</p>
                <ul>
                  {pickList.map((card) => (
                    <CardRow key={card.id} card={card} now={now} action={putAction(card)} onAction={onCardAction} showOrder={picks.mixed} />
                  ))}
                </ul>
              </div>
            )}
          </HolderView>
        )}

        {slotView && !holderView && (
          <div className="flex flex-col gap-3">
            <SlotHeader slot={slotView} onOpenBag={(code) => onInput(code, "link")} />
            {slotIsDesk && (
              <AdminLink href={deskPagePath(slotView.code)} className={`${bigButton} w-full border border-border bg-white text-foreground hover:border-primary/40`}>
                <LayoutGrid className="h-5 w-5" strokeWidth={1.75} aria-hidden="true" />
                Open desk page
              </AdminLink>
            )}
            {slotCards.length > 1 && (
              <p className="px-1 text-sm text-muted-foreground">
                Move, Done and Take out act on the ticked cards. Untick any that stay in {slotView.name}.
              </p>
            )}
            {slotCards.length > 0 && (
              <ul className={panel}>
                {slotCards.map((card) => (
                  <SlotCard
                    key={card.id}
                    card={card}
                    now={now}
                    dense={slotCards.length > 3}
                    selectable={slotCards.length > 1}
                    selected={selected.has(card.id)}
                    onToggle={() => {
                      setConfirmDone(false);
                      setSelected((s) => {
                        const next = new Set(s);
                        if (next.has(card.id)) next.delete(card.id);
                        else next.add(card.id);
                        return next;
                      });
                    }}
                  />
                ))}
              </ul>
            )}
            {/* A full slot's actions, in thumb reach on a phone */}
            {showActions && (
              <div className="fixed inset-x-0 bottom-0 z-20 border-t border-border bg-white/95 px-4 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] backdrop-blur lg:static lg:z-auto lg:rounded-2xl lg:border lg:bg-white lg:px-4 lg:pb-3 lg:backdrop-blur-none">
                {slotCards.length > 1 && (
                  <div className="mb-2 flex items-center justify-between gap-2">
                    <p className="text-sm font-bold text-foreground">
                      {allChosen ? `All ${slotCards.length} cards picked` : chosen.length === 0 ? "No cards picked" : `${chosen.length} of ${slotCards.length} cards picked`}
                    </p>
                    <button
                      type="button"
                      onClick={() => {
                        setConfirmDone(false);
                        setSelected(allChosen ? new Set() : new Set(slotCards.map((c) => c.id)));
                      }}
                      className="min-h-11 shrink-0 rounded-full px-3 text-sm font-bold text-primary hover:bg-primary/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
                    >
                      {allChosen ? "Pick none" : "Pick all"}
                    </button>
                  </div>
                )}
                {/* On a phone the card can sit below the fold, under this bar: say which card the buttons act on */}
                {slotCards.length === 1 && (
                  <p className="mb-2 truncate text-sm text-foreground lg:hidden">
                    <span className="font-mono font-black">{slotCards[0].code ?? "No Card ID"}</span>
                    {slotCards[0].name ? <span className="font-semibold"> · {slotCards[0].name}</span> : null}
                    {slotCards[0].customer ? <span className="text-muted-foreground"> · {slotCards[0].customer}</span> : null}
                  </p>
                )}
                <div className="grid grid-cols-3 gap-2">
                  <button
                    type="button"
                    disabled={!!busy || chosen.length === 0}
                    onClick={() => {
                      setConflict(null);
                      setConfirmDone(false);
                      setWaiting({ type: "move", from: slotView, cards: chosen, at: Date.now() });
                      setStatus(`Scan the next slot for ${cardsLabel(chosen)}.`);
                      scrollToTop();
                    }}
                    className={`${actionButton} bg-primary text-primary-foreground hover:bg-primary/90`}
                  >
                    <ArrowRightLeft className="h-5 w-5" strokeWidth={1.75} aria-hidden="true" />
                    {chosen.length > 1 ? (allChosen ? `Move all ${chosen.length}` : `Move ${chosen.length}`) : "Move"}
                  </button>
                  <button
                    type="button"
                    disabled={!!busy || chosen.length === 0}
                    onClick={(e) => {
                      if (!confirmDone) {
                        setConfirmDone(true);
                        setStatus("Tap Done again to mark it finished.");
                        // Tapped or clicked (not pressed with the keyboard): it doesn't keep focus while it asks,
                        // so a broken scan's Enter can't answer "Tap again"
                        if (e.detail > 0) e.currentTarget.blur();
                        return;
                      }
                      const cards = chosen;
                      tapSave(() => doFinish("done", slotView, cards));
                    }}
                    className={`${actionButton} ${confirmDone ? "bg-green-800 text-white ring-4 ring-green-300" : "bg-green-700 text-white hover:bg-green-800"}`}
                  >
                    <CircleCheckBig className="h-5 w-5" strokeWidth={1.75} aria-hidden="true" />
                    {confirmDone ? "Tap again" : "Done"}
                  </button>
                  <button
                    type="button"
                    disabled={!!busy || chosen.length === 0}
                    onClick={() => {
                      const cards = chosen;
                      tapSave(() => doFinish("release", slotView, cards));
                    }}
                    className={`${actionButton} border border-border bg-white text-foreground hover:border-primary/40`}
                  >
                    <LogOut className="h-5 w-5" strokeWidth={1.75} aria-hidden="true" />
                    Take out
                  </button>
                </div>
              </div>
            )}
            {slotView.kind === "shipping" && !ship && (
              <button type="button" onClick={toggleShip} className={`${bigButton} bg-cyan-700 text-white hover:bg-cyan-800`}>
                <PackageCheck className="h-5 w-5" strokeWidth={1.75} aria-hidden="true" />
                Start ship check
              </button>
            )}
            {activeTarget?.code === slotView.code && (
              pickList.length > 0 && picks ? (
                <div className={panel}>
                  <p className="px-4 pt-3 text-sm font-bold text-foreground">Tap a card from {picks.label}</p>
                  <ul>
                    {pickList.map((card) => (
                      <CardRow key={card.id} card={card} now={now} action={putAction(card)} onAction={onCardAction} showOrder={picks.mixed} />
                    ))}
                  </ul>
                </div>
              ) : (
                <Note>Scan the bag’s QR label. Or tap Type a code instead to search by Card ID, customer or order.</Note>
              )
            )}
            {slotView.cards.length === 0 && slotView.kind !== "station" && slotView.bags.length === 0 && !activeTarget && (
              <Note>Nothing here.</Note>
            )}
          </div>
        )}

        {view.type === "bag" && (
          <div className={panel}>
            <BagHeader bag={view.bag} shipHref={shipPath(view.bag.orderId, view.bag.id)} />
            <BulkPut cards={view.bag.cards} target={activeTarget} busy={!!busy} onPut={(cards) => startAssign(cards)} />
            <ul className="border-t border-border">
              {view.bag.cards.map((card) => (
                <CardRow key={card.id} card={card} now={now} action={putAction(card)} onAction={onCardAction} onOpenSlot={openSlot} />
              ))}
            </ul>
          </div>
        )}

        {view.type === "order" && (
          <div className={panel}>
            <OrderHeader order={view.order} shipHref={shipPath(view.order.id)} />
            {view.order.bags.map((bag) => (
              <div key={bag.id} className="border-t border-border">
                <p className="px-4 pt-3 text-sm font-bold text-foreground">
                  <span className="font-mono">{bag.code}</span> · {bag.tierName} · {bag.doneCount} of {bag.cardCount} done
                  {bag.location ? ` · Bag: ${bagPlaceText(bag.location, filingLetter(bag.customer))}` : ""}
                </p>
                <ul>
                  {bag.cards.map((card) => (
                    <CardRow key={card.id} card={card} now={now} action={putAction(card)} onAction={onCardAction} onOpenSlot={openSlot} />
                  ))}
                </ul>
              </div>
            ))}
            {view.order.looseCards.length > 0 && (
              <div className="border-t border-border">
                <p className="px-4 pt-3 text-sm font-bold text-foreground">Not in a bag yet</p>
                <ul>
                  {view.order.looseCards.map((card) => (
                    <CardRow key={card.id} card={card} now={now} action={putAction(card)} onAction={onCardAction} onOpenSlot={openSlot} />
                  ))}
                </ul>
              </div>
            )}
            {view.order.bags.length === 0 && view.order.looseCards.length === 0 && (
              <p className="border-t border-border px-4 py-3 text-sm text-muted-foreground">No cards on this order.</p>
            )}
          </div>
        )}

        {view.type === "card" && (
          <div className={panel}>
            <ul>
              <CardRow card={view.card} now={now} action={putAction(view.card)} onAction={onCardAction} onOpenSlot={openSlot} showOrder />
            </ul>
            <div className="flex flex-wrap gap-2 border-t border-border px-4 py-3">
              <AdminLink href={view.card.cardUrl} className={smallButton}>Card page</AdminLink>
              <AdminLink href={view.card.photosUrl} className={smallButton}>Photos</AdminLink>
            </div>
          </div>
        )}

        {view.type === "search" && (
          <div className={panel}>
            <p className="px-4 pt-3 pb-1 text-sm font-bold text-foreground">
              {view.cards.length ? `${view.cards.length}${view.truncated ? "+" : ""} card${view.cards.length === 1 ? "" : "s"} for “${view.query}”` : `Nothing found for “${view.query}”.`}
            </p>
            {view.truncated && <p className="px-4 text-xs text-muted-foreground">Only the first ones are shown: type more to narrow it down.</p>}
            <ul>
              {view.cards.map((card) => (
                <CardRow key={card.id} card={card} now={now} action={putAction(card)} onAction={onCardAction} onOpenSlot={openSlot} showOrder />
              ))}
            </ul>
          </div>
        )}

        <SessionLog items={log} onClear={() => logStore.set([])} />
      </div>
    </div>
  );
}

/** "Got it: CD-2549-P" over the top panel for a moment (READ_FLASH_MS); screen readers hear it from the status line. */
function ReadFlash({ read }: { read: { key: number; text: string } | null }) {
  const ref = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el || !read) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    el.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 120, easing: "cubic-bezier(0.2, 0, 0, 1)" });
  }, [read]);
  if (!read) return null;
  return (
    <div
      ref={ref}
      key={read.key}
      aria-hidden="true"
      className="pointer-events-none absolute inset-0 flex items-center gap-3 bg-green-600 px-4 text-white sm:px-6"
    >
      <Check className="h-8 w-8 shrink-0" strokeWidth={3} />
      <p className="min-w-0 truncate text-2xl font-black sm:text-3xl">Got it: {read.text}</p>
    </div>
  );
}

/** "Put all 4 in SHELF DUE MON DEC 7": a bag's cards into a slot with room for them all (shelves, big humidors). */
function BulkPut({
  cards,
  target,
  busy,
  onPut,
}: {
  cards: TrackCardSummary[];
  target: TrackSlotSummary | null;
  busy: boolean;
  onPut: (cards: TrackCardSummary[]) => void;
}) {
  if (!target) return null;
  const todo = cards.filter((c) => !c.refunded && !c.done && c.location?.code !== target.code);
  if (todo.length < 2 || roomLeft(target.capacity, target.cardCount) < todo.length) return null;
  return (
    <div className="px-4 pb-3">
      <button type="button" disabled={busy} onClick={() => onPut(todo)} className={`${bigButton} w-full bg-primary text-primary-foreground hover:bg-primary/90`}>
        Put all {todo.length} in {target.name}
      </button>
    </div>
  );
}
