"use client";

import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { Printer, X } from "lucide-react";
import type { PrepareConflict, PreparePlan, PrepareRequest, PrepareResponse, TierQuestion } from "@/lib/intake/prepare-labels";
import { DEFAULT_STOCK, LABEL_STOCKS, isStockId } from "@/lib/intake/labels/stock";
import { LabelPrintButton } from "./label-print-button";

/**
 * "Print labels" for any order (owner, Nov 24 2026: "I want to easily be able
 * to just print it for any order"). One button, the same everywhere:
 *
 * 1. Tap: GET /api/admin/intake/orders/<id>/prepare-labels says what the
 *    order needs (PreparePlan in lib/intake/prepare-labels.ts).
 *    - `ready` (every arrived card is in a bag): straight to printing.
 *    - `bag_in_shop`: POST at once when every missing tier is known for sure;
 *      otherwise one small dialog asks per group of cards ("Tier for
 *      Charizard, Blastoise: [Gold]", the best guess preselected, no
 *      preselection when nothing fits) → Save & print.
 *    - `receive_first` (Awaiting Cards): "Cards arrived? Receive all and
 *      print" (the customer gets the usual cards-received email) → POST
 *      { confirmReceive: true }.
 *    - `not_allowed`: the button turns disabled with the server's reason.
 * 2. The labels are then got ready (the PDF, or the Katasymbol pictures, are
 *    fetched before the next tap: an iPhone only opens the share sheet
 *    straight from a tap) and the button reads "Print 3 labels": the second
 *    tap prints every bag's label through LabelPrintButton (one per tier bag,
 *    GET /api/admin/intake/labels/order/<id>?bags=…), on this device's printer.
 *
 * With `bags` it skips step 1 and prints just those bags (the Bags board, the
 * "Bags missing labels" queue). Pressing again is safe: the server bags only
 * cards not in a bag yet and prints the same bags.
 */

type Paper = { widthIn: number; heightIn: number };
type BagRef = { id: string; code: string };
type PrintJob = { url: string; fileName: string; bagIds: string[]; count: number; paper: Paper };
type Ready = { job: PrintJob; note: string | null; printed: boolean };
type Ask = { plan: PreparePlan; problem: string | null };

const PREPARE_TIMEOUT_MS = 20_000;
/** Bagging a big order writes a lot: give it longer before saying there was no answer. */
const BAG_TIMEOUT_MS = 60_000;

const focusRing = "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary";

// ── Server calls ─────────────────────────────────────────────────────────────

type Reply<T> = { ok: true; status: number; body: T } | { ok: false; status: number; body: unknown; error: string };

async function call<T>(url: string, init: RequestInit, timeoutMs: number, what: string): Promise<Reply<T>> {
  const abort = new AbortController();
  const timer = setTimeout(() => abort.abort(), timeoutMs);
  try {
    const res = await fetch(url, { cache: "no-store", ...init, signal: abort.signal });
    const body = (await res.json().catch(() => null)) as unknown;
    if (res.ok) return { ok: true, status: res.status, body: body as T };
    const error =
      res.status === 401
        ? "You're signed out. Sign in again, then try again."
        : ((body as { error?: unknown } | null)?.error && typeof (body as { error: unknown }).error === "string"
            ? (body as { error: string }).error
            : `Couldn't ${what} (${res.status}).`);
    return { ok: false, status: res.status, body, error };
  } catch {
    return {
      ok: false,
      status: 0,
      body: null,
      error: abort.signal.aborted
        ? "No answer from the server. Check the connection, then tap Print labels again: it never bags a card twice."
        : "No connection. Check it, then try again.",
    };
  } finally {
    clearTimeout(timer);
  }
}

// The label stock (Receiving settings), for the printer choice and QZ Tray: read once a few minutes
let paperCache: { at: number; paper: Paper } | null = null;
const PAPER_TTL_MS = 5 * 60_000;

function stockPaper(stock: unknown): Paper {
  const s = LABEL_STOCKS[isStockId(stock) ? stock : DEFAULT_STOCK];
  return { widthIn: s.widthIn, heightIn: s.heightIn };
}

async function loadPaper(given?: Paper): Promise<Paper> {
  if (given) return given;
  if (paperCache && Date.now() - paperCache.at < PAPER_TTL_MS) return paperCache.paper;
  const got = await call<{ labels?: { stock?: unknown } }>("/api/admin/intake/settings", {}, PREPARE_TIMEOUT_MS, "read the label settings");
  if (!got.ok || !isStockId(got.body?.labels?.stock)) return stockPaper(DEFAULT_STOCK); // not kept: asked again next time
  const paper = stockPaper(got.body.labels.stock);
  paperCache = { at: Date.now(), paper };
  return paper;
}

function isConflict(body: unknown): body is PrepareConflict {
  const b = body as Partial<PrepareConflict> | null;
  return !!b && typeof b.mode === "string" && Array.isArray(b.tierQuestions) && Array.isArray(b.bags);
}

// ── Words ────────────────────────────────────────────────────────────────────

function plural(n: number, one: string, many: string) {
  return n === 1 ? one : many;
}

/** "Charizard", "Charizard and Blastoise", "Charizard, Blastoise and Venusaur". */
function nameList(names: string[]): string {
  const clean = names.map((n) => n.trim() || "Unnamed card");
  if (clean.length <= 1) return clean[0] ?? "these cards";
  return `${clean.slice(0, -1).join(", ")} and ${clean[clean.length - 1]}`;
}

/** What a question is about: up to 3 cards by name, else "these 12 cards" (names listed under it). */
function questionSubject(q: TierQuestion): string {
  return q.cardNames.length <= 3 ? nameList(q.cardNames) : `these ${q.cardIds.length} cards`;
}

/** "Charizard, Blastoise, Venusaur, Mew, Lugia and 7 more" for a long question. */
function longNames(names: string[]): string {
  const shown = names.slice(0, 5).map((n) => n.trim() || "Unnamed card");
  const rest = names.length - shown.length;
  return rest > 0 ? `${shown.join(", ")} and ${rest} more` : nameList(shown);
}

/** The server's sentence with each Bag or Card ID kept on one line ("CD-2549-G", never "CD-2549-" / "G"). */
function keepCodes(text: string): ReactNode[] {
  return text.split(/(\bCD-\d+(?:-[A-Z0-9]+)?\b)/).map((part, i) =>
    i % 2 ? (
      <span key={i} className="whitespace-nowrap">
        {part}
      </span>
    ) : (
      part
    ),
  );
}

/** "Nov 24, 2026" for a stored New York day. */
function dayText(day: string): string {
  const d = new Date(`${day}T12:00:00Z`);
  if (Number.isNaN(d.getTime())) return day;
  return d.toLocaleDateString("en-US", { timeZone: "UTC", month: "short", day: "numeric", year: "numeric" });
}

const RECEIVED_FROM: Record<PreparePlan["receivedOnSource"], string> = {
  event: "the day the order was marked Cards Received",
  dropoff: "the drop-off day",
  bag: "the day on the order's other bags",
  today: "today",
};

/** Known before asking the server: orders that can never have labels. */
function knownBlock(status: string | null | undefined, paymentStatus: string | null | undefined): string | null {
  if (paymentStatus === "refunded") return "Refunded order: no labels.";
  if (status === "cancelled") return "Cancelled order: no labels.";
  if (status === "awaiting_payment") return "Not paid yet: no labels until it is.";
  return null;
}

// ── The button ───────────────────────────────────────────────────────────────

type Props = {
  orderId: string;
  orderNumber: string;
  /** orders.status and payment_status: an order that can't have labels shows no button, or a disabled one (`whenBlocked`). */
  status?: string | null;
  paymentStatus?: string | null;
  /** Print just these bags (no bagging): the Bags board and the "Bags missing labels" queue. */
  bags?: BagRef[];
  /** The label stock when the page knows it (skips reading the settings). */
  paper?: Paper;
  /** Default "Print labels" ("Print label" with one bag). */
  children?: ReactNode;
  variant?: "primary" | "secondary";
  /** "sm": smaller type, for a row of small buttons (still 44 px tall). */
  size?: "md" | "sm";
  /** An order that can't have labels (refunded, cancelled, awaiting payment): no button, or a disabled one with the reason. */
  whenBlocked?: "hide" | "disable";
  /**
   * Reload the page as soon as cards are bagged (pages where this button
   * stays put after the reload). Otherwise the page reloads once the labels
   * are printed or the button is closed, so a list row doesn't vanish
   * between the two taps.
   */
  refreshAfterBagging?: boolean;
  /**
   * "panel": a box with a heading and `hint` (the receiving workspace).
   * Nothing shows while `hidden`, unless a print is under way (so the reload
   * after bagging doesn't take the "Print 3 labels" button away).
   */
  layout?: "inline" | "panel";
  hint?: ReactNode;
  hidden?: boolean;
  className?: string;
};

export function PrintOrderLabels({
  orderId,
  orderNumber,
  status,
  paymentStatus,
  bags: onlyBags,
  paper,
  children,
  variant = "secondary",
  size = "md",
  whenBlocked = "disable",
  refreshAfterBagging = false,
  layout = "inline",
  hint,
  hidden = false,
  className = "",
}: Props) {
  const router = useRouter();
  const uid = useId();
  const triggerRef = useRef<HTMLButtonElement>(null);
  const readyRef = useRef<HTMLDivElement>(null);
  const paperRef = useRef<Paper | null>(null);
  // The plan's note for staff (cards left out, not marked paid), shown with the result
  const planNoteRef = useRef<string | null>(null);
  // Something changed on the server (cards bagged, order received) and the page hasn't reloaded since
  const changedRef = useRef(false);
  const [busy, setBusy] = useState<null | "checking" | "bagging">(null);
  const [ask, setAsk] = useState<Ask | null>(null);
  const [ready, setReady] = useState<Ready | null>(null);
  const [blocked, setBlocked] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Where the keyboard goes after the next render (the button it was on may be gone)
  const focusNext = useRef<null | "ready" | "trigger">(null);

  const single = !!onlyBags && onlyBags.length === 1;
  const buttonText = children ?? (single ? "Print label" : "Print labels");
  const preBlocked = onlyBags ? null : knownBlock(status, paymentStatus);
  const reason = blocked ?? preBlocked;

  useEffect(() => {
    const to = focusNext.current;
    if (!to) return;
    focusNext.current = null;
    (to === "ready" ? readyRef : triggerRef).current?.focus();
  });

  function showJob(list: BagRef[], note: string | null) {
    const p = paperRef.current ?? stockPaper(DEFAULT_STOCK);
    const ids = list.map((b) => b.id);
    // A fresh address each time: the label is fetched again, never an old pre-fetched file
    const url = `/api/admin/intake/labels/order/${orderId}?bags=${ids.join(",")}&v=${Date.now().toString(36)}`;
    const fileName = list.length === 1 ? `${list[0].code}-label.pdf` : `${orderNumber || "order"}-labels.pdf`;
    setReady({ job: { url, fileName, bagIds: ids, count: ids.length, paper: p }, note, printed: false });
    focusNext.current = "ready";
  }

  function openAsk(plan: PreparePlan, problem: string | null) {
    setAsk({ plan, problem });
  }

  /** Where the plan sends us (also after a 409 that sent a fresh plan: then never straight back to the server). */
  function follow(plan: PreparePlan, problem: string | null = null, fromConflict = false) {
    planNoteRef.current = plan.mode === "not_allowed" ? null : plan.reason || null;
    if (plan.mode === "not_allowed") {
      setAsk(null);
      setBlocked(plan.reason || "Labels can't be printed for this order.");
      focusNext.current = "trigger";
      return;
    }
    if (plan.mode === "receive_first" || (plan.toBag > 0 && (plan.needsAnswers || fromConflict))) {
      openAsk(plan, problem);
      return;
    }
    if (plan.toBag > 0) {
      void bag({}, false);
      return;
    }
    // Every arrived card is in a bag already: print them all
    setAsk(null);
    const list = plan.bags.filter((b) => b.cardCount > 0).map((b) => ({ id: b.id, code: b.code }));
    if (!list.length) {
      setError(
        plan.skipped.awaitingArrival > 0
          ? "No labels yet: the cards are marked as still on the way. Receive them first."
          : "This order has no cards to put in a bag yet.",
      );
      return;
    }
    const n = list.length;
    showJob(list, `Every card is in a bag: ${n} ${plural(n, "label", "labels")} (one per tier).${plan.reason ? ` ${plan.reason}` : ""}`);
  }

  async function start() {
    if (busy || reason) return;
    setError(null);
    setReady(null);
    setBusy("checking");
    if (onlyBags) {
      paperRef.current = await loadPaper(paper);
      setBusy(null);
      showJob(onlyBags, null);
      return;
    }
    const [plan, p] = await Promise.all([
      call<PreparePlan>(`/api/admin/intake/orders/${orderId}/prepare-labels`, {}, PREPARE_TIMEOUT_MS, "check the order"),
      loadPaper(paper),
    ]);
    paperRef.current = p;
    setBusy(null);
    if (!plan.ok) {
      setError(plan.error);
      return;
    }
    follow(plan.body);
  }

  async function bag(body: PrepareRequest, fromDialog: boolean) {
    setBusy("bagging");
    if (fromDialog) setAsk((a) => a && { ...a, problem: null });
    const res = await call<PrepareResponse>(
      `/api/admin/intake/orders/${orderId}/prepare-labels`,
      { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) },
      BAG_TIMEOUT_MS,
      "get the labels ready",
    );
    setBusy(null);
    if (res.ok) {
      setAsk(null);
      if (res.body.newlyBagged > 0 || res.body.orderStatusChanged) {
        changedRef.current = true;
        if (refreshAfterBagging) {
          changedRef.current = false;
          router.refresh();
        }
      }
      const list = res.body.bags.filter((b) => b.cardCount > 0).map((b) => ({ id: b.id, code: b.code }));
      if (!list.length) {
        setError(res.body.message || "This order has no cards in bags to label.");
        return;
      }
      const note = [res.body.message, planNoteRef.current].filter(Boolean).join(" ");
      showJob(list, note || null);
      return;
    }
    if (res.status === 409 && isConflict(res.body)) {
      // Something needs an answer first (or changed meanwhile): ask with the fresh plan
      follow(res.body, res.body.error, true);
      return;
    }
    if (fromDialog) setAsk((a) => a && { ...a, problem: res.error });
    else setError(res.error);
  }

  function closeReady() {
    setReady(null);
    focusNext.current = "trigger";
    if (changedRef.current) {
      changedRef.current = false;
      router.refresh();
    }
  }

  function onPrinted() {
    setReady((r) => r && { ...r, printed: true });
    changedRef.current = false;
    // The bags' "label printed" stamps (and any bagging) show on the page
    router.refresh();
  }

  if (reason && whenBlocked === "hide" && !blocked) return null;
  const active = !!(busy || ask || ready || error || blocked);
  if (hidden && !active) return null;

  const btn =
    variant === "primary"
      ? "bg-foreground text-background hover:opacity-90"
      : "border border-border bg-white text-foreground hover:bg-muted";
  const sizing = size === "sm" ? "px-3 text-xs font-bold" : "px-4 text-sm font-bold";
  const reasonId = `${uid}-reason`;
  const errorId = `${uid}-error`;

  const controls = ready ? (
    <div
      ref={readyRef}
      tabIndex={-1}
      role="group"
      aria-label={`Labels for order ${orderNumber}`}
      aria-describedby={`${uid}-note`}
      className="inline-flex max-w-full flex-col gap-1 rounded-lg outline-none"
    >
      <div className="flex flex-wrap items-start gap-1">
        <LabelPrintButton
          key={ready.job.url}
          pdfUrl={ready.job.url}
          fileName={ready.job.fileName}
          bagIds={ready.job.bagIds}
          paper={ready.job.paper}
          variant="primary"
          onPrinted={onPrinted}
        >
          {ready.job.count === 1 ? "Print 1 label" : `Print ${ready.job.count} labels`}
        </LabelPrintButton>
        <button
          type="button"
          onClick={closeReady}
          aria-label={ready.printed ? "Done" : "Close without printing"}
          className={`inline-flex min-h-11 min-w-11 items-center justify-center rounded-lg text-muted-foreground hover:bg-muted hover:text-foreground ${focusRing}`}
        >
          <X className="size-4" strokeWidth={1.75} aria-hidden />
        </button>
      </div>
      <p id={`${uid}-note`} role="status" className="max-w-sm text-xs font-medium text-green-800">
        {ready.note && keepCodes(ready.note)}
        {ready.printed ? `${ready.note ? " " : ""}Printed: the ${ready.job.count === 1 ? "bag is" : "bags are"} stamped as labelled.` : ""}
      </p>
    </div>
  ) : (
    <span className="inline-flex max-w-full flex-col gap-1">
      <button
        ref={triggerRef}
        type="button"
        onClick={start}
        aria-disabled={busy || reason ? true : undefined}
        aria-describedby={reason ? reasonId : error ? errorId : undefined}
        className={`${btn} ${sizing} inline-flex min-h-11 items-center justify-center gap-2 self-start whitespace-nowrap rounded-lg transition-opacity ${focusRing} ${
          reason ? "cursor-not-allowed opacity-40" : busy ? "cursor-wait opacity-60" : ""
        }`}
      >
        <Printer className="size-4" strokeWidth={1.75} aria-hidden />
        {busy === "checking" ? (onlyBags ? "Preparing…" : "Checking…") : busy === "bagging" && !ask ? "Getting labels ready…" : buttonText}
      </button>
      {reason && (
        <span id={reasonId} className="max-w-xs text-xs font-semibold text-muted-foreground">
          {reason}
        </span>
      )}
      {error && !reason && (
        <span id={errorId} role="alert" className="max-w-sm text-xs font-semibold text-red-700">
          {error}
        </span>
      )}
      <span aria-live="polite" className="sr-only">
        {busy === "checking" ? "Checking the order" : busy === "bagging" ? "Putting the cards in their tier bags" : ""}
      </span>
    </span>
  );

  const dialog = ask && (
    <TierDialog
      key={`${ask.plan.orderId}|${ask.plan.mode}|${ask.plan.tierQuestions.map((q) => q.cardIds.join(".")).join("|")}`}
      ask={ask}
      orderNumber={orderNumber}
      busy={busy === "bagging"}
      onSubmit={(body) => void bag(body, true)}
      onClose={() => {
        setAsk(null);
        focusNext.current = "trigger";
      }}
    />
  );

  if (layout === "panel") {
    return (
      <section aria-labelledby={`${uid}-h`} className={`rounded-xl border-2 border-primary/40 bg-white p-4 sm:p-5 ${className}`}>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="min-w-0 flex-1 basis-64">
            <h2 id={`${uid}-h`} className="font-heading text-base font-black text-foreground">
              Print labels
            </h2>
            {hint && <p className="mt-0.5 text-sm text-muted-foreground">{hint}</p>}
          </div>
          {controls}
        </div>
        {dialog}
      </section>
    );
  }
  return (
    <div className={`inline-flex max-w-full flex-col ${className}`}>
      {controls}
      {dialog}
    </div>
  );
}

// ── The dialog: tier questions and "Cards arrived?" ─────────────────────────

function TierDialog({
  ask,
  orderNumber,
  busy,
  onSubmit,
  onClose,
}: {
  ask: Ask;
  orderNumber: string;
  busy: boolean;
  onSubmit: (body: PrepareRequest) => void;
  onClose: () => void;
}) {
  const { plan, problem } = ask;
  const ref = useRef<HTMLDialogElement>(null);
  const uid = useId();
  const receive = plan.mode === "receive_first";
  // Staff answer the unsure ones; the sure ones (signed at checkout) are only listed
  const questions = plan.tierQuestions;
  const toAnswer = questions.map((q, i) => ({ q, i })).filter(({ q }) => q.needsAnswer);
  const known = questions.filter((q) => !q.needsAnswer);
  // Preselected with the best guess; nothing for an unknown one (required)
  const [answers, setAnswers] = useState<Record<number, string>>(() =>
    Object.fromEntries(toAnswer.map(({ q, i }) => [i, q.guess ?? ""])),
  );
  const [missing, setMissing] = useState<number[]>([]);

  useEffect(() => {
    const d = ref.current;
    if (!d || d.open) return;
    d.showModal();
    // Straight to the first tier nobody picked yet, else to the main button
    const first = d.querySelector<HTMLElement>("select[data-unanswered='true']") ?? d.querySelector<HTMLElement>("[data-primary]");
    first?.focus();
  }, []);

  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;
    const empty = toAnswer.filter(({ i }) => !answers[i]).map(({ i }) => i);
    setMissing(empty);
    if (empty.length) {
      document.getElementById(`${uid}-q${empty[0]}`)?.focus();
      return;
    }
    const tiers: Record<string, string> = {};
    for (const { q, i } of toAnswer) for (const id of q.cardIds) tiers[id] = answers[i];
    onSubmit({ ...(Object.keys(tiers).length ? { tiers } : {}), ...(receive ? { confirmReceive: true } : {}) });
  }

  const toBag = plan.toBag;
  const unsureCards = toAnswer.reduce((n, { q }) => n + q.cardIds.length, 0);
  const title = receive ? "Cards arrived?" : toAnswer.length === 1 ? "Check the tier" : "Check the tiers";
  const primary = busy ? (receive ? "Receiving…" : "Saving…") : receive ? "Receive all and print" : "Save & print";

  return (
    <dialog
      ref={ref}
      aria-labelledby={`${uid}-title`}
      aria-describedby={`${uid}-intro`}
      onCancel={(e) => {
        // Esc while saving would hide the answer to a request still running
        if (busy) e.preventDefault();
      }}
      onClose={onClose}
      className="fixed inset-x-0 bottom-0 top-auto m-0 max-h-[90dvh] w-full max-w-none overflow-hidden rounded-t-2xl bg-white p-0 text-foreground shadow-2xl backdrop:bg-black/50 sm:inset-0 sm:m-auto sm:max-w-lg sm:rounded-2xl"
    >
      <form onSubmit={submit} noValidate className="flex max-h-[90dvh] flex-col">
        <div className="flex items-start justify-between gap-3 border-b border-border px-4 py-3 sm:px-5">
          <div className="min-w-0">
            <h2 id={`${uid}-title`} className="font-heading text-lg font-black text-foreground">
              {title}
            </h2>
            <p className="text-xs font-semibold text-muted-foreground">Order {orderNumber}</p>
          </div>
          <button
            type="button"
            onClick={() => !busy && ref.current?.close()}
            aria-label="Close"
            className={`-mr-2 inline-flex min-h-11 min-w-11 shrink-0 items-center justify-center rounded-lg text-muted-foreground hover:bg-muted hover:text-foreground ${focusRing}`}
          >
            <X className="size-5" strokeWidth={1.75} aria-hidden />
          </button>
        </div>

        <div className="flex flex-col gap-4 overflow-y-auto px-4 py-4 sm:px-5">
          <div id={`${uid}-intro`} className="flex flex-col gap-1 text-sm text-foreground">
            {receive ? (
              <>
                <p>
                  This order is still Awaiting Cards. Only go on if the cards are here: this receives{" "}
                  {toBag > 0 ? `all ${toBag} ${plural(toBag, "card", "cards")}` : "the order's cards"}, puts them in their tier bags and prints the labels.
                </p>
                <p className="font-semibold">The order moves to Cards Received and the customer gets the usual cards-received email, just like the Receive button.</p>
              </>
            ) : (
              <p>
                {toAnswer.length > 0 &&
                  `${unsureCards === 1 ? "A card has" : "Some cards have"} no tier saved. The best guess is picked: check it, then print. `}
                {toBag} {plural(toBag, "card goes", "cards go")} into tier bags; the order&apos;s status stays the same and the customer isn&apos;t emailed.
              </p>
            )}
            {plan.reason && <p className="text-xs text-muted-foreground">{plan.reason}</p>}
          </div>

          {toAnswer.length > 0 && (
            <fieldset className="flex flex-col gap-3">
              <legend className="sr-only">Tiers</legend>
              {toAnswer.map(({ q, i }) => {
                const id = `${uid}-q${i}`;
                const value = answers[i] ?? "";
                const isMissing = missing.includes(i) && !value;
                return (
                  <div key={i} className="flex flex-col gap-1.5 rounded-lg border border-border p-3">
                    <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                      <label htmlFor={id} className="min-w-0 text-sm font-bold text-foreground [overflow-wrap:anywhere]">
                        Tier for {questionSubject(q)}
                      </label>
                      <select
                        id={id}
                        value={value}
                        required
                        data-unanswered={value ? undefined : "true"}
                        aria-invalid={isMissing || undefined}
                        aria-describedby={`${id}-why${isMissing ? ` ${id}-err` : ""}`}
                        disabled={busy}
                        onChange={(e) => {
                          const v = e.target.value;
                          setAnswers((a) => ({ ...a, [i]: v }));
                        }}
                        className={`h-11 w-full shrink-0 rounded-lg border bg-white px-2 text-base font-semibold text-foreground disabled:opacity-50 sm:w-44 sm:text-sm ${
                          isMissing ? "border-red-500 ring-1 ring-red-200" : "border-border"
                        } ${focusRing}`}
                      >
                        {!q.guess && (
                          <option value="" disabled>
                            Pick a tier…
                          </option>
                        )}
                        {q.choices.map((c) => (
                          <option key={c.key} value={c.key}>
                            {c.name}
                          </option>
                        ))}
                      </select>
                    </div>
                    {q.cardNames.length > 3 && <p className="text-xs text-muted-foreground [overflow-wrap:anywhere]">{longNames(q.cardNames)}</p>}
                    <p id={`${id}-why`} className="text-xs text-muted-foreground">
                      {q.why}
                    </p>
                    {isMissing && (
                      <p id={`${id}-err`} className="text-xs font-semibold text-red-700">
                        Pick a tier for {plural(q.cardIds.length, "this card", "these cards")}.
                      </p>
                    )}
                  </div>
                );
              })}
            </fieldset>
          )}

          {known.length > 0 && (
            <ul className="flex flex-col gap-1 text-xs text-muted-foreground" aria-label="Tiers filled in for you">
              {known.map((q, k) => {
                const name = q.choices.find((c) => c.key === q.guess)?.name ?? q.guess ?? "";
                return (
                  <li key={k} className="[overflow-wrap:anywhere]">
                    <span className="font-semibold text-foreground">{q.cardNames.length <= 3 ? nameList(q.cardNames) : `${q.cardIds.length} cards`}</span>: {name} ({q.why})
                  </li>
                );
              })}
            </ul>
          )}

          <div className="flex flex-col gap-0.5 text-xs text-muted-foreground">
            <p>
              Received date for the new bags: <span className="font-semibold text-foreground">{dayText(plan.receivedOn)}</span> ({RECEIVED_FROM[plan.receivedOnSource] ?? plan.receivedOnSource}).
            </p>
            {plan.skipped.awaitingArrival > 0 && (
              <p>
                {plan.skipped.awaitingArrival} {plural(plan.skipped.awaitingArrival, "card is", "cards are")} marked as still on the way and{" "}
                {plural(plan.skipped.awaitingArrival, "stays", "stay")} out of the bags.
              </p>
            )}
          </div>

          {problem && (
            <p role="alert" className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm font-semibold text-red-700">
              {problem}
            </p>
          )}
        </div>

        <div className="flex flex-col-reverse gap-2 border-t border-border px-4 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] sm:flex-row sm:justify-end sm:px-5">
          <button
            type="button"
            onClick={() => !busy && ref.current?.close()}
            aria-disabled={busy || undefined}
            className={`inline-flex min-h-11 items-center justify-center rounded-lg border border-border bg-white px-4 text-sm font-bold text-foreground hover:bg-muted ${focusRing}`}
          >
            Cancel
          </button>
          <button
            type="submit"
            data-primary
            aria-disabled={busy || undefined}
            className={`inline-flex min-h-11 items-center justify-center gap-2 rounded-lg bg-foreground px-5 text-sm font-bold text-background hover:opacity-90 ${busy ? "cursor-wait opacity-60" : ""} ${focusRing}`}
          >
            <Printer className="size-4" strokeWidth={1.75} aria-hidden />
            {primary}
          </button>
        </div>
      </form>
    </dialog>
  );
}
