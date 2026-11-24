"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowRightLeft, CircleCheckBig, LoaderCircle, LogOut, PackageCheck, Volume2, VolumeX, X } from "lucide-react";
import { AdminLink } from "@/components/admin-ui/admin-link";
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
import { ScanCamera } from "./camera";
import { beep, unlockAudio } from "./feedback";
import { cardsLabel, roomLeft } from "./format";
import { createScanGate, parseScan, slotCodeGuess } from "./parse";
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
 *   Ship check (on)      -> a bag or order scan opens /admin/receiving/ship/<orderId>
 *
 * Input: the camera (camera.tsx), a handheld scanner anywhere on the page or
 * in the code box (scan-input.tsx), or typing (a code, a slot name such as
 * "clamp 7", or a search). Scans are handled one at a time, in order, so a
 * fast scanner never trips over itself. The URL holds only ?loc=<slot code>
 * and ?mode=ship, never anything about a customer.
 */

type View =
  | { type: "start" }
  | { type: "slot"; slot: TrackSlotSummary }
  | { type: "bag"; bag: TrackBagSummary }
  | { type: "order"; order: TrackOrderSummary }
  | { type: "card"; card: TrackCardSummary }
  | { type: "search"; query: string; cards: TrackCardSummary[]; truncated: boolean };

/** What the next slot scan does. */
type Waiting =
  | null
  | { type: "move"; from: TrackSlotSummary; cards: TrackCardSummary[] }
  | { type: "assign"; cards: TrackCardSummary[] };

/** What "Add anyway" sends again when a slot is full. */
type Retry =
  | { type: "assign"; cards: TrackCardSummary[]; slot: { code: string; name: string } }
  | { type: "move"; from: TrackSlotSummary; to: TrackSlotSummary; cards: TrackCardSummary[] };

/** Cards offered to tap into an empty slot: the last bag, order or search (`mixed`: from several orders). */
type Picks = { label: string; cards: TrackCardSummary[]; mixed: boolean } | null;

type Source = "camera" | "wedge" | "typed" | "paste" | "link";

/** The full slot's three buttons: icon over word, so all three fit a phone's width. */
const actionButton =
  "min-h-16 rounded-2xl px-2 text-base font-black inline-flex flex-col items-center justify-center gap-1 transition active:scale-[0.98] motion-reduce:active:scale-100 disabled:opacity-50 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-primary/30";

/** "Put a card in CLAMP 07" stops applying when this long has passed since the slot was scanned. */
const TARGET_TTL_MS = 10 * 60_000;

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
function patchCards(cards: TrackCardSummary[], res: TrackActionResponse, to: LocationRef | null, done = false): TrackCardSummary[] {
  const changed = new Map(res.results.filter((r) => r.ok).map((r) => [r.cardId, r]));
  if (!changed.size) return cards;
  const at = new Date().toISOString();
  return cards.map((c) => {
    const r = changed.get(c.id);
    if (!r) return c;
    return {
      ...c,
      location: to,
      locatedAt: at,
      stageLabel: done ? "Done" : r.stageLabel ?? c.stageLabel,
      stage: done ? null : r.stage ?? c.stage,
      done: done || c.done,
    };
  });
}

function patchView(view: View, res: TrackActionResponse, to: LocationRef | null, done = false): View {
  if (view.type === "bag") return { ...view, bag: { ...view.bag, cards: patchCards(view.bag.cards, res, to, done) } };
  if (view.type === "order") {
    return {
      ...view,
      order: {
        ...view.order,
        bags: view.order.bags.map((b) => ({ ...b, cards: patchCards(b.cards, res, to, done) })),
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
  const [status, setStatus] = useState("");
  const log = useScanLog();
  const sound = useSound();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [confirmDone, setConfirmDone] = useState(false);
  const queue = useRef<Promise<void>>(Promise.resolve());
  const gate = useRef(createScanGate(2000));
  const flashTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Sounds may only start after a tap or key press on the page
  useEffect(() => {
    const unlock = () => unlockAudio();
    window.addEventListener("pointerdown", unlock, { once: true, capture: true });
    window.addEventListener("keydown", unlock, { once: true, capture: true });
    return () => {
      window.removeEventListener("pointerdown", unlock, { capture: true });
      window.removeEventListener("keydown", unlock, { capture: true });
    };
  }, []);

  useEffect(() => () => {
    if (flashTimer.current) clearTimeout(flashTimer.current);
  }, []);

  // Escape (a computer's keyboard) drops what the next scan was going to do
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key !== "Escape") return;
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

  const fail = useCallback(
    (text: string, logIt = true) => {
      beep("error", soundStore.get());
      show("error", text);
      if (logIt) addLogItem("error", text);
    },
    [show],
  );

  const saved = useCallback(
    (res: TrackActionResponse, fallback: string) => {
      const problem = api.partialProblem(res);
      const text = res.message || fallback;
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

  /** Runs one step after the ones before it (scans and taps alike). */
  const enqueue = useCallback((task: () => Promise<void>) => {
    queue.current = queue.current.then(task).catch(() => {
      // a step's own errors are shown by the step
    });
  }, []);

  const showSlot = useCallback(
    (slot: TrackSlotSummary) => {
      setView({ type: "slot", slot });
      setSelected(new Set(slot.cards.map((c) => c.id)));
      setConfirmDone(false);
      setTarget(canFill(slot) ? { slot, at: Date.now() } : null);
    },
    [setTarget, setView],
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
        return;
      }
      setWaiting(null);
      saved(res.data, `${cardsLabel(cards)} in ${slot.name}.`);
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
    [fail, picksRef, refreshSlot, saved, setPicks, setTarget, setView, setWaiting, targetRef, viewRef],
  );

  const doMove = useCallback(
    async (from: TrackSlotSummary, to: TrackSlotSummary, cards: TrackCardSummary[], force = false) => {
      setConflict(null);
      setBusy(`Moving ${cardsLabel(cards)} to ${to.name}…`);
      const all = cards.length >= from.cards.length;
      const res = await api.move({
        fromCode: from.code,
        toCode: to.code,
        ...(all ? {} : { cardIds: cards.map((c) => c.id) }),
        force,
        sessionId: scanSessionId(),
      });
      setBusy(null);
      if (!res.ok) {
        if (res.conflict) {
          beep("error", soundStore.get());
          setStatus(res.error);
          setConflict({ text: conflictText(to.name, res.conflict), conflict: res.conflict, retry: { type: "move", from, to, cards } });
          return;
        }
        fail(res.error);
        return;
      }
      setWaiting(null);
      saved(res.data, `${cardsLabel(cards)} moved to ${to.name}.`);
      if (picksRef.current) setPicks({ ...picksRef.current, cards: patchCards(picksRef.current.cards, res.data, res.data.location) });
      await refreshSlot(to.code);
    },
    [fail, picksRef, refreshSlot, saved, setPicks, setWaiting],
  );

  /** Done or Take out, for cards in `slot` (shown again after) or picked from a bag or search (null: the list stays). */
  const doFinish = useCallback(
    async (kind: "done" | "release", slot: TrackSlotSummary | null, cards: TrackCardSummary[]) => {
      setConfirmDone(false);
      setBusy(kind === "done" ? `Marking ${cardsLabel(cards)} done…` : `Taking ${cardsLabel(cards)} out…`);
      const body = { cardIds: cards.map((c) => c.id), sessionId: scanSessionId() };
      const res = kind === "done" ? await api.done(body) : await api.release(body);
      setBusy(null);
      if (!res.ok) {
        fail(res.error);
        return;
      }
      setWaiting(null);
      saved(res.data, kind === "done" ? `${cardsLabel(cards)} done.` : `${cardsLabel(cards)} taken out${slot ? ` of ${slot.name}` : ""}.`);
      if (picksRef.current) {
        setPicks({ ...picksRef.current, cards: patchCards(picksRef.current.cards, res.data, res.data.location, kind === "done") });
      }
      if (slot) await refreshSlot(slot.code);
      else setView(patchView(viewRef.current, res.data, res.data.location, kind === "done"));
    },
    [fail, picksRef, refreshSlot, saved, setPicks, setView, setWaiting, viewRef],
  );

  // ----- what a scan does -----

  const onSlot = useCallback(
    async (slot: TrackSlotSummary) => {
      const w = waitingRef.current;
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
    [doAssign, doFinish, doMove, fail, showSlot, waitingRef],
  );

  const showCards = useCallback(
    (next: View, label: string, cards: TrackCardSummary[]) => {
      setConflict(null);
      setWaiting(null);
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
        fail(res.status === 404 ? `${code}: not found. The label may be from a deleted slot or bag.` : res.error);
        return;
      }
      const found = res.data;
      if (found.kind === "location") {
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
    [fail, onSlot, router, shipRef, showCards],
  );

  /** Every scan, typed code, pasted link and search comes in here. */
  const onInput = useCallback(
    (raw: string, source: Source) => {
      const text = raw.trim();
      if (!text) return;
      const parsed = parseScan(text);
      if (source === "camera" || source === "wedge") {
        if (!gate.current(parsed?.code ?? text.toUpperCase().slice(0, 200), Date.now())) return;
      }
      if (source === "typed" || source === "paste") {
        // A repeat of the same code right after (a scanner typing into the box) is ignored too
        if (parsed && !gate.current(parsed.code, Date.now())) return;
      }
      if (parsed) {
        if (source !== "link") beep("read", soundStore.get());
        enqueue(() => handleCode(parsed.code, source));
        return;
      }
      if (source === "camera" || source === "wedge") {
        fail("Not a Card Doc code. Scan a slot or a bag label.");
        return;
      }
      // Typed: a slot by its name ("clamp 7"), else a search
      const guess = slotCodeGuess(text);
      enqueue(async () => {
        if (guess) {
          const res = await api.resolve(guess);
          if (res.ok && res.data.kind === "location") {
            await onSlot(res.data.location);
            return;
          }
        }
        await runSearch(text);
      });
    },
    [enqueue, fail, handleCode, onSlot, runSearch],
  );

  useKeyboardWedge(onInput);
  const onCamera = useCallback((text: string) => onInput(text, "camera"), [onInput]);

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
  const activeTarget = target && now - target.at <= TARGET_TTL_MS ? target.slot : null;
  const showActions = !!slotView && slotCards.length > 0 && !waiting;

  // ----- taps -----

  function cancelWaiting() {
    setWaiting(null);
    setConflict(null);
  }

  function startAssign(cards: TrackCardSummary[]) {
    // The slot cards go into ("Put a card in CLAMP 07"): put it there now
    if (activeTarget) {
      const slot = activeTarget;
      enqueue(() => doAssign(cards, slot));
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
    if (!conflict) return;
    const r = conflict.retry;
    setConflict(null);
    enqueue(() => (r.type === "assign" ? doAssign(r.cards, r.slot, true) : doMove(r.from, r.to, r.cards, true)));
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

  // The line that says what the next scan does
  let cue: { title: string; sub?: string; tone: string; cancel?: () => void; cancelLabel?: string };
  if (waiting?.type === "move") {
    cue = { title: `Scan the next slot for ${cardsLabel(waiting.cards)}`, sub: `Moving from ${waiting.from.name}.`, tone: "bg-primary text-primary-foreground", cancel: cancelWaiting };
  } else if (waiting?.type === "assign") {
    cue = { title: `Scan the slot for ${cardsLabel(waiting.cards)}`, sub: "Or type its name (clamp 7) below.", tone: "bg-primary text-primary-foreground", cancel: cancelWaiting };
  } else if (ship) {
    cue = { title: "Ship check: scan the bag or order", sub: "Opens its ship check page.", tone: "bg-cyan-700 text-white", cancel: toggleShip, cancelLabel: "Stop" };
  } else if (activeTarget) {
    cue = {
      title: `Put a card in ${activeTarget.name}`,
      sub: "Scan the bag’s QR, or search below, then tap the card.",
      tone: "bg-amber-300 text-gray-950",
      cancel: () => setTarget(null),
    };
  } else {
    cue = { title: "Scan a slot or a bag", sub: "Or type a code, a slot (clamp 7), a name or an order.", tone: "bg-white text-foreground border border-border" };
  }

  const pickList = activeTarget && slotView && activeTarget.code === slotView.code && picks
    ? picks.cards.filter((c) => c.location?.code !== slotView.code && !c.done)
    : [];

  return (
    <div className={`mx-auto flex w-full max-w-6xl flex-col gap-3 px-4 py-4 sm:px-6 lg:py-8 ${showActions ? "pb-36 lg:pb-8" : "pb-10"}`}>
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
            aria-label={sound ? "Sound on" : "Sound off"}
            className="h-11 w-11 rounded-full border border-border bg-white inline-flex items-center justify-center text-foreground hover:border-primary/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
          >
            {sound ? <Volume2 className="h-5 w-5" strokeWidth={1.75} aria-hidden="true" /> : <VolumeX className="h-5 w-5" strokeWidth={1.75} aria-hidden="true" />}
          </button>
        </div>
      </div>

      {/* What the next scan does */}
      <div className={`sticky top-14 z-20 lg:top-0 rounded-2xl px-4 py-3 shadow-sm ${cue.tone}`}>
        <div className="flex items-start gap-3">
          <div className="min-w-0 flex-1">
            <p className="text-xl font-black leading-tight break-words sm:text-2xl">{busy ?? cue.title}</p>
            {!busy && cue.sub && <p className="mt-0.5 text-sm font-semibold opacity-80">{cue.sub}</p>}
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
      </div>

      <div className="grid gap-3 lg:grid-cols-[minmax(0,5fr)_minmax(0,6fr)] lg:items-start lg:gap-6">
        {/* Camera and code box */}
        <div className="flex flex-col gap-3 lg:sticky lg:top-28">
          <ScanCamera onRead={onCamera} compact={view.type !== "start"} />
          <ScanInput onScan={onInput} placeholder="Code, slot (clamp 7), name or order" />
        </div>

        {/* The flow */}
        <div className="flex min-w-0 flex-col gap-3">
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
                <button type="button" onClick={addAnyway} className={`${bigButton} bg-amber-500 text-gray-950 hover:bg-amber-400`}>
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
                <li>Scan an <span className="font-semibold text-foreground">empty slot</span>, then scan the bag and tap the card to put in it.</li>
                <li>Scan a <span className="font-semibold text-foreground">full slot</span> to see its card: Move it (then scan the next slot), Done, or Take out.</li>
                <li>Scan a <span className="font-semibold text-foreground">bag</span> to see where each of its cards is.</li>
              </ul>
              <div className="mt-3 flex flex-wrap gap-2">
                <AdminLink href="/admin/receiving/locations" className={smallButton}>Slots and labels</AdminLink>
                <AdminLink href="/admin/receiving/shelf" className={smallButton}>Shelf by due date</AdminLink>
              </div>
            </div>
          )}

          {slotView && (
            <div className="flex flex-col gap-3">
              <SlotHeader slot={slotView} onOpenBag={(code) => onInput(code, "link")} />
              {slotCards.length > 0 && (
                <ul className={panel}>
                  {slotCards.map((card) => (
                    <SlotCard
                      key={card.id}
                      card={card}
                      now={now}
                      selectable={slotCards.length > 1}
                      selected={selected.has(card.id)}
                      onToggle={() =>
                        setSelected((s) => {
                          const next = new Set(s);
                          if (next.has(card.id)) next.delete(card.id);
                          else next.add(card.id);
                          return next;
                        })
                      }
                    />
                  ))}
                </ul>
              )}
              {/* A full slot's actions, in thumb reach on a phone */}
              {showActions && (
                <div className="fixed inset-x-0 bottom-0 z-30 border-t border-border bg-white/95 px-4 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] backdrop-blur lg:static lg:z-auto lg:rounded-2xl lg:border lg:bg-white lg:px-4 lg:pb-3 lg:backdrop-blur-none">
                  {slotCards.length > 1 && (
                    <p className="mb-2 text-xs font-semibold text-muted-foreground">
                      {chosen.length === slotCards.length ? `All ${slotCards.length} cards` : `${chosen.length} of ${slotCards.length} cards picked`}
                    </p>
                  )}
                  <div className="grid grid-cols-3 gap-2">
                    <button
                      type="button"
                      disabled={!!busy || chosen.length === 0}
                      onClick={() => {
                        setConflict(null);
                        setConfirmDone(false);
                        setWaiting({ type: "move", from: slotView, cards: chosen });
                        setStatus(`Scan the next slot for ${cardsLabel(chosen)}.`);
                        scrollToTop();
                      }}
                      className={`${actionButton} bg-primary text-primary-foreground hover:bg-primary/90`}
                    >
                      <ArrowRightLeft className="h-5 w-5" strokeWidth={1.75} aria-hidden="true" />
                      Move
                    </button>
                    <button
                      type="button"
                      disabled={!!busy || chosen.length === 0}
                      onClick={() => {
                        if (!confirmDone) {
                          setConfirmDone(true);
                          setStatus("Tap Done again to mark it finished.");
                          return;
                        }
                        const cards = chosen;
                        enqueue(() => doFinish("done", slotView, cards));
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
                        enqueue(() => doFinish("release", slotView, cards));
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
                  <Note>Scan the bag’s QR label, or search by Card ID, customer or order in the code box.</Note>
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
