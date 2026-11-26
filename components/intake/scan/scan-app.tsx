"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Check, Keyboard, PackageCheck, Volume2, VolumeX } from "lucide-react";
import type { TrackActionResponse, TrackCardSummary } from "@/lib/intake/tracking/types";
import * as api from "./api";
import { SCAN_READ_EVENT } from "./card-photos";
import { audioUnlocked, beep, unlockAudio } from "./feedback";
import { NOT_OURS_TEXT, SHIP_SUB, SHIP_TITLE, notFoundText } from "./flow-text";
import { CardListView, PickedCard, PlaceView, ScanPanel } from "./flow-views";
import { createScanGate, parseScan, scanReadLabel, typedSlotGuess } from "./parse";
import { ScanInput, useKeyboardWedge } from "./scan-input";
import {
  afterLookup, afterSave, afterScanProblem, backToList, cancelPending, clearShownMessage, expirePending, hideMessage, panelOf,
  pickCard, planScan, refreshCard, saveCall, startFlow, startSave, tapSave, type FlowSound, type FlowState, type Found, type Panel,
  type Save, type SaveOutcome, type Step, PENDING_MS,
} from "./scan-flow";
import { addLogItem, logStore, scanSessionId, soundStore, useScanLog, useSound } from "./session-store";
import { Flash, SessionLog, useNow, type FlashState } from "./views";

/**
 * The Scan page (/admin/scan), plain (owner, Nov 26 2026: "I want the page
 * to be pretty plain and then when I scan on someones order or a spot that
 * corresponds with an order then there card comes up"). "Ready to scan" and
 * nothing else until a scan; every scan replaces what's on screen:
 *
 *   a bag or order      -> its cards still in the bag (one: picked at once)
 *   a spot with a card  -> that card, picked (photos, notes, whose, due, step)
 *   an empty spot twice -> the picked card moves there (a desk too: never full)
 *   DONE twice          -> the picked card is done, back in its bag
 *   a desk              -> its cards, tap one (with a card picked: it waits to go there)
 *
 * Done (asks first) and Take out are taps on the picked card. What each scan
 * or tap does is decided in scan-flow.ts (pure, tested); this file looks
 * things up and saves through the tracking API (api.ts: resolve, search,
 * assign, move, done, release), one step at a time in a queue, so a fast
 * scanner never trips over itself and a scan during a save is read after it.
 *
 * Input: the handheld scanner (the Eyoyo paired with the phone as a
 * Bluetooth keyboard) is caught anywhere with nothing focused
 * (scan-input.tsx useKeyboardWedge); "Type a code instead" opens the code box
 * (a code, "clamp 7", "desk", or a search). The URL holds only ?mode=ship;
 * ?loc=<place code> (a place's QR opened in a phone's camera app, through
 * /q/<CODE>) is read once, as a scan, then dropped.
 */

type Source = "wedge" | "typed" | "paste" | "link";

/** "Got it: CD-2549-P" shows at least this long, and until the scan's answer shows. */
const READ_MIN_MS = 500;

function scrollToTop() {
  const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  window.scrollTo({ top: 0, behavior: reduce ? "auto" : "smooth" });
}

/** The ship check page (?bag= highlights the scanned bag). */
function shipPath(orderId: string, bagId?: string | null) {
  const base = `/admin/receiving/ship/${encodeURIComponent(orderId)}`;
  return bagId ? `${base}?bag=${encodeURIComponent(bagId)}` : base;
}

/** What the screen reader hears from the panel. */
function panelText(panel: Panel): string {
  if (panel.kind === "message") return [panel.message.title, panel.message.sub, ...(panel.message.lines ?? []).map((l) => l.text)].filter(Boolean).join(" ");
  if (panel.kind === "saving") return panel.title;
  return `${panel.title}. ${panel.sub}`;
}

/** The screen changed to something else (another card, list or place): the page goes to the top. */
function sameScreen(a: FlowState, b: FlowState): boolean {
  const x = a.screen;
  const y = b.screen;
  if (x.kind !== y.kind) return false;
  if (x.kind === "card" && y.kind === "card") return x.card.id === y.card.id;
  if (x.kind === "list" && y.kind === "list") return x.list.code === y.list.code && x.list.source === y.list.source;
  if (x.kind === "place" && y.kind === "place") return x.place.code === y.place.code;
  return true;
}

export function ScanApp({ initialLoc, initialShip }: { initialLoc: string | null; initialShip: boolean }) {
  const router = useRouter();
  const now = useNow();
  const [flow, setFlowState] = useState<FlowState>(startFlow);
  const flowRef = useRef<FlowState>(flow);
  const [ship, setShipState] = useState(initialShip);
  const shipRef = useRef(initialShip);
  const [flash, setFlash] = useState<FlashState | null>(null);
  /** "Got it: CD-2549-P" (a place: "Got it: CLAMP 07") over the panel while the scan is looked up. */
  const [read, setRead] = useState<{ key: number; code: string; text: string } | null>(null);
  /** The code box ("Type a code instead"), closed until tapped. */
  const [typing, setTyping] = useState(false);
  /** Done was tapped: "Mark it done? Then put it back in its bag." */
  const [asking, setAsking] = useState(false);
  /** A tap that couldn't start, for screen readers (the flash is hidden from them). */
  const [busyNote, setBusyNote] = useState("");
  /** A scan or save is running (buttons wait). */
  const [working, setWorking] = useState(false);
  const log = useScanLog();
  const sound = useSound();
  const queue = useRef<Promise<void>>(Promise.resolve());
  const pendingTasks = useRef(0);
  const gate = useRef(createScanGate());
  const flashTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const readTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const panelRef = useRef<HTMLDivElement | null>(null);

  const setFlow = useCallback((next: FlowState) => {
    const prev = flowRef.current;
    flowRef.current = next;
    setFlowState(next);
    if (!sameScreen(prev, next) || (!prev.pending && next.pending)) scrollToTop();
  }, []);

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

  // The waiting move or Done ends after 30 s (planScan checks the time too: a phone's timers sleep while it is locked)
  const pending = flow.pending;
  useEffect(() => {
    if (!pending) return;
    const t = setTimeout(() => {
      const next = expirePending(flowRef.current, Date.now());
      if (next) setFlow(next);
    }, Math.max(0, pending.at + PENDING_MS + 50 - Date.now()));
    return () => clearTimeout(t);
  }, [pending, setFlow]);

  // "CD-2549-03 is in CLAMP 07 now" shows for a few seconds, then the page is plain
  const until = flow.message?.until;
  useEffect(() => {
    if (!until) return;
    const t = setTimeout(() => {
      const next = clearShownMessage(flowRef.current, Date.now());
      if (next) setFlow(next);
    }, Math.max(0, until - Date.now() + 20));
    return () => clearTimeout(t);
  }, [until, setFlow]);

  // Esc (a computer's keyboard) drops the waiting move and the Done question; not the Esc
  // that closes a photo, a sheet or the code box (handled there, or pressed inside a dialog)
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key !== "Escape" || e.defaultPrevented) return;
      if (e.target instanceof Element && e.target.closest("dialog")) return;
      setAsking(false);
      setFlow(cancelPending(flowRef.current));
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [setFlow]);

  // The URL: ship check only (?mode=ship); a ?loc= it was opened with is read once, then dropped
  useEffect(() => {
    const params = new URLSearchParams();
    if (ship) params.set("mode", "ship");
    const query = params.toString();
    const next = `${window.location.pathname}${query ? `?${query}` : ""}`;
    if (next !== `${window.location.pathname}${window.location.search}`) window.history.replaceState(null, "", next);
  }, [ship]);

  const showFlash = useCallback((tone: "ok" | "error", text: string) => {
    if (flashTimer.current) clearTimeout(flashTimer.current);
    setFlash({ key: Date.now(), tone, text });
    flashTimer.current = setTimeout(() => setFlash(null), tone === "ok" ? 900 : 1800);
  }, []);

  const play = useCallback((s: FlowSound) => {
    if (s === "pending") beep("pending", soundStore.get());
    else if (s === "moved") beep("ok", soundStore.get());
    else if (s === "refused") beep("error", soundStore.get());
  }, []);

  const apply = useCallback(
    (step: Step) => {
      setFlow(step.state);
      play(step.sound);
    },
    [play, setFlow],
  );

  /** "Got it: …" for a scan just taken; returns its key (its answer hides it). */
  const gotIt = useCallback((code: string) => {
    if (readTimer.current) clearTimeout(readTimer.current);
    const key = Date.now();
    setRead({ key, code, text: scanReadLabel(code) });
    return key;
  }, []);

  /** The scan's answer shows: "Got it" goes (after READ_MIN_MS). */
  const doneReading = useCallback((key: number | null) => {
    if (key == null) return;
    const left = key + READ_MIN_MS - Date.now();
    const hide = () => setRead((r) => (r && r.key === key ? null : r));
    if (left <= 0) hide();
    else readTimer.current = setTimeout(hide, left);
  }, []);

  /** The scanned place's own name in "Got it: …" while it still shows (a renamed place's code reads differently). */
  const placeRead = useCallback((code: string, name: string) => {
    setRead((r) => (r && r.code === code && r.text !== name ? { ...r, text: name } : r));
  }, []);

  /** Runs one step after the ones before it (scans and saves alike). */
  const enqueue = useCallback((task: () => Promise<void>) => {
    pendingTasks.current += 1;
    setWorking(true);
    queue.current = queue.current
      .then(task)
      .catch(() => {
        // a step's own errors are shown by the step
      })
      .finally(() => {
        pendingTasks.current -= 1;
        if (pendingTasks.current === 0) setWorking(false);
      });
  }, []);

  /** A scan that found nothing, or a lookup that failed: said in the panel, the picked card stays. */
  const scanProblem = useCallback(
    (text: string) => {
      apply(afterScanProblem(flowRef.current, text));
      showFlash("error", text);
      addLogItem("error", text);
    },
    [apply, showFlash],
  );

  /**
   * One save (the double scan's move or Done; a tap's Done, Take out or Add
   * anyway): the panel says it runs, the answer replaces it. Refused: the
   * picked card is read again (where it really is now) and stays picked.
   */
  const runSave = useCallback(
    async (save: Save) => {
      setAsking(false);
      setFlow(startSave(flowRef.current, save));
      const call = saveCall(save);
      const sessionId = scanSessionId();
      let res: api.ApiResult<TrackActionResponse>;
      if (call.route === "assign") res = await api.assign({ ...call.body, sessionId });
      else if (call.route === "move") res = await api.move({ ...call.body, sessionId });
      else if (call.route === "done") res = await api.done({ ...call.body, sessionId });
      else res = await api.release({ ...call.body, sessionId });
      const outcome: SaveOutcome = res.ok
        ? { ok: true, res: res.data }
        : { ok: false, error: res.error, status: res.status, ...(res.conflict ? { conflict: res.conflict } : {}) };
      const step = afterSave(flowRef.current, outcome, Date.now());
      apply(step);
      setBusyNote("");
      const m = step.state.message;
      if (m) {
        const tone = m.tone === "ok" ? "ok" : m.tone === "warn" ? "warn" : "error";
        addLogItem(tone, m.title);
        for (const l of m.lines ?? []) addLogItem(l.tone === "ok" ? "ok" : "warn", l.text);
        showFlash(m.tone === "ok" ? "ok" : "error", m.title);
      }
      // No button keeps focus (a pressed one may be gone): the panel takes it, so the scanner's next scan is caught
      requestAnimationFrame(() => panelRef.current?.focus({ preventScroll: true }));
      if (m?.tone === "error" && save.card.code) {
        const again = await api.resolve(save.card.code);
        if (again.ok && again.data.kind === "card") setFlow(refreshCard(flowRef.current, again.data.card));
      }
    },
    [apply, setFlow, showFlash],
  );

  /** What a lookup found, through the flow. */
  const found = useCallback((f: Found) => apply(afterLookup(flowRef.current, f, Date.now())), [apply]);

  const runSearch = useCallback(
    async (query: string) => {
      if (query.length < 2) {
        scanProblem("Type at least 2 letters or numbers to search.");
        return;
      }
      const res = await api.search(query);
      if (!res.ok) {
        scanProblem(res.error);
        return;
      }
      found({ kind: "search", query, cards: res.data.cards, truncated: res.data.truncated });
    },
    [found, scanProblem],
  );

  /** A code (scanned, typed or a place's link): the double scan saves at once, else it is looked up. */
  const handleCode = useCallback(
    async (code: string, source: Source, readKey: number | null): Promise<void> => {
      const plan = planScan(flowRef.current, code, Date.now());
      if (plan.do === "wait") {
        // A save is still running (the queue normally keeps this from happening): after it
        enqueue(() => handleCode(code, source, readKey));
        return;
      }
      if (plan.do === "save") {
        doneReading(readKey);
        await runSave(plan.save);
        return;
      }
      const res = await api.resolve(code);
      doneReading(readKey);
      if (!res.ok) {
        // Scanning it again right away must work (a dropped connection, a retry)
        gate.current.forget(code);
        scanProblem(res.status === 404 ? notFoundText(code) : res.error);
        return;
      }
      const data = res.data;
      if (data.kind === "location") {
        placeRead(code, data.location.name);
        found({ kind: "spot", spot: data.location });
        return;
      }
      if (shipRef.current && source !== "link") {
        beep("ok", soundStore.get());
        setFlow(cancelPending(flowRef.current));
        router.push(
          data.kind === "bag" ? shipPath(data.bag.orderId, data.bag.id)
            : data.kind === "order" ? shipPath(data.order.id)
              : shipPath(data.card.orderId, data.card.bagId),
        );
        return;
      }
      if (data.kind === "bag") found({ kind: "bag", bag: data.bag });
      else if (data.kind === "order") found({ kind: "order", order: data.order });
      else found({ kind: "card", card: data.card });
    },
    [doneReading, enqueue, found, placeRead, router, runSave, scanProblem, setFlow],
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
      // Taken: an open photo closes and the Done question goes, so the answer shows
      if (source !== "link") window.dispatchEvent(new Event(SCAN_READ_EVENT));
      setAsking(false);
      setBusyNote("");
      if (parsed && !slotGuess) {
        let key: number | null = null;
        if (source !== "link") {
          beep("read", soundStore.get());
          key = gotIt(parsed.code);
        }
        enqueue(() => handleCode(parsed.code, source, key));
        return;
      }
      if (source === "wedge") {
        scanProblem(NOT_OURS_TEXT);
        return;
      }
      // Typed: a slot by its name ("clamp 7"; twice moves the picked card there), else a search
      enqueue(async () => {
        if (slotGuess) {
          const plan = planScan(flowRef.current, slotGuess, Date.now());
          if (plan.do === "save") {
            await runSave(plan.save);
            return;
          }
          const res = await api.resolve(slotGuess);
          if (res.ok && res.data.kind === "location") {
            found({ kind: "spot", spot: res.data.location });
            return;
          }
        }
        await runSearch(text);
      });
    },
    [enqueue, found, gotIt, handleCode, runSave, runSearch, scanProblem],
  );

  // The scanner: caught anywhere on the page, nothing needs focus (true once it is listening)
  const listening = useKeyboardWedge(onInput);

  // Opened from a place's QR (/q/LOC-CLAMP-07 -> /admin/scan?loc=LOC-CLAMP-07): read it as a scan
  const started = useRef(false);
  useEffect(() => {
    if (started.current || !initialLoc) return;
    started.current = true;
    onInput(initialLoc, "link");
  }, [initialLoc, onInput]);

  // ----- taps -----

  /** A tap that saves: nothing starts while a scan or save runs (the panel keeps its message; only a flash says so). */
  function tap(kind: "done" | "takeout" | "retry") {
    const t = tapSave(flowRef.current, kind, pendingTasks.current > 0);
    if (!t.ok) {
      beep("error", soundStore.get());
      showFlash("error", t.text);
      addLogItem("error", t.text);
      setBusyNote(t.text);
      return;
    }
    const save = t.save;
    enqueue(() => runSave(save));
  }

  function onPick(card: TrackCardSummary) {
    setAsking(false);
    setFlow(pickCard(flowRef.current, card));
  }

  function toggleShip() {
    const next = !ship;
    shipRef.current = next;
    setShipState(next);
    setFlow(cancelPending(flowRef.current));
  }

  function toggleSound() {
    const next = !sound;
    soundStore.set(next);
    if (next) beep("read", true);
  }

  // ----- drawing -----

  const panel = panelOf(flow, listening);
  const screen = flow.screen;
  // While a move waits for its second scan, or a save runs, the panel is the one message
  const hideContent = !!flow.pending || !!flow.saving;
  const big = panel.kind === "pending" || (screen.kind === "ready" && (panel.kind === "ready" || panel.kind === "message"));

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-3 px-4 pt-4 pb-10 sm:px-6 lg:py-8">
      <Flash flash={flash} />
      <p role="status" aria-live="polite" className="sr-only">{busyNote || panelText(panel)}</p>

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

      {/* The one message: what the last scan did, or what the next one does */}
      <ScanPanel
        ref={panelRef}
        panel={panel}
        big={big}
        listening={listening}
        ship={ship}
        read={<ReadFlash read={read} />}
        onCancel={() => setFlow(cancelPending(flowRef.current))}
        onHide={() => setFlow(hideMessage(flowRef.current))}
        onRetry={() => tap("retry")}
        onStopShip={toggleShip}
        shipTitle={SHIP_TITLE}
        shipSub={SHIP_SUB}
      />

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

      {!hideContent && screen.kind === "card" && (
        <PickedCard
          key={screen.card.id}
          card={screen.card}
          from={screen.from}
          now={now}
          asking={asking}
          disabled={working}
          onBack={() => setFlow(backToList(flowRef.current))}
          onAskDone={() => setAsking(true)}
          onCancelDone={() => setAsking(false)}
          onDone={() => tap("done")}
          onTakeOut={() => tap("takeout")}
        />
      )}
      {!hideContent && screen.kind === "list" && <CardListView list={screen.list} now={now} onPick={onPick} />}
      {!hideContent && screen.kind === "place" && <PlaceView place={screen.place} onOpenBag={(code) => onInput(code, "link")} />}
      {screen.kind === "ready" && <div data-screen="ready" hidden />}

      <SessionLog items={log} onClear={() => logStore.set([])} />
    </div>
  );
}

/** "Got it: CD-2549-P" over the top panel while the scan is looked up; screen readers hear the answer instead. */
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
