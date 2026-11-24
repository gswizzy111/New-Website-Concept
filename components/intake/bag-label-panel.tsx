"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import { useRouter } from "next/navigation";
import { ChevronDown, Printer } from "lucide-react";
import { AdminLink } from "@/components/admin-ui/admin-link";
import { connectQZ, isQZActive } from "@/lib/qz-print";
import type { BagSummary } from "@/lib/intake/types";
import type { LabelPreviewResponse } from "@/lib/intake/labels/respond";
import { LabelPreview } from "./label-preview";
import { LabelPrintButton, paperGroup, useLabelPrinter, useShareDevice } from "./label-print-button";

// Per-computer choices, kept in this browser (localStorage)
const HINT_KEY = "intake_label_hint_seen";
const QZ_KEY = "intake_qz";

const listeners = new Set<() => void>();
function readFlag(key: string): boolean {
  try {
    return localStorage.getItem(key) === "1";
  } catch {
    return false;
  }
}
function writeFlag(key: string, on: boolean) {
  try {
    if (on) localStorage.setItem(key, "1");
    else localStorage.removeItem(key);
  } catch {
    // Private mode: the choice lasts for this page only
  }
  listeners.forEach((l) => l());
}
function useFlag(key: string, serverValue: boolean): boolean {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      window.addEventListener("storage", cb);
      return () => {
        listeners.delete(cb);
        window.removeEventListener("storage", cb);
      };
    },
    () => readFlag(key),
    () => serverValue,
  );
}

type QzStatus = "off" | "connecting" | "ready" | "failed";

/** Connects QZ Tray when this computer prints with it (not on phones, which use the share sheet). */
function useQzConnection(share: boolean, useQz: boolean): QzStatus {
  const [qzStatus, setQzStatus] = useState<QzStatus>("off");
  useEffect(() => {
    if (share || !useQz || isQZActive()) return;
    let cancelled = false;
    Promise.resolve()
      .then(() => {
        if (!cancelled) setQzStatus("connecting");
        return connectQZ();
      })
      .then(
        () => !cancelled && setQzStatus("ready"),
        () => !cancelled && setQzStatus("failed"),
      );
    return () => {
      cancelled = true;
    };
  }, [share, useQz]);
  return qzStatus;
}

/** When a label was printed, New York time: "Nov 23, 1:40 PM". */
export function printedWhen(iso: string): string {
  return new Date(iso).toLocaleString("en-US", {
    timeZone: "America/New_York",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function printedText(iso: string | null): string {
  return iso ? `Label printed ${printedWhen(iso)}` : "Label not printed yet";
}

/** Everything a bag's label shows, so an edit (a due date, a card's name) fetches the preview and PDFs again. */
export function bagVersion(b: BagSummary): string {
  const cards = b.cards.map((c) => [c.code, c.name, c.set, c.number].join("|")).join(";");
  return [b.id, b.code, b.tierName, b.customerName ?? "", b.dueDate ?? "", b.receivedOn ?? "", b.cardCount, cards].join(".");
}

/** A short fingerprint (FNV-1a) for the PDF addresses, so a changed label is never a stale pre-fetched file. */
export function shortHash(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 0x01000193);
  return (h >>> 0).toString(36);
}

/** A label print sent from this browser: when, and which version of the bag's label it was. */
type LocalPrint = { at: string; version: string };

// Labels printed since the page loaded, by bag, shared by every print button
// (the "Print labels" step, the Bag labels panel, the card page) until the
// refreshed page brings the stamps from the database.
const EMPTY: ReadonlyMap<string, LocalPrint> = new Map();
let localPrints: ReadonlyMap<string, LocalPrint> = EMPTY;
const printListeners = new Set<() => void>();
function subscribePrints(cb: () => void) {
  printListeners.add(cb);
  return () => {
    printListeners.delete(cb);
  };
}

export type BagLabelState = { printedAt: string | null; outdated: boolean };

/**
 * A bag's label: the database stamp (tier_bags.label_printed_at) and its
 * out-of-date flag (the due date changed or cards joined the bag since), or a
 * print sent from this page since, until a newer stamp arrives. A print from
 * this page goes out of date when what the label shows changes after it.
 */
export function bagLabelState(b: BagSummary, local: LocalPrint | undefined): BagLabelState {
  const server = b.labelPrintedAt;
  if (local && (!server || Date.parse(server) <= Date.parse(local.at))) {
    return { printedAt: local.at, outdated: local.version !== bagVersion(b) };
  }
  return { printedAt: server, outdated: !!server && b.labelOutdated };
}

/** Each bag's label state, and the callback that records a print (shown at once, then the page's stamps reload). */
export function useBagLabels() {
  const router = useRouter();
  const local = useSyncExternalStore(subscribePrints, () => localPrints, () => EMPTY);
  return {
    state: (b: BagSummary) => bagLabelState(b, local.get(b.id)),
    onPrinted: (printed: BagSummary[]) => (at: string) => {
      const next = new Map(localPrints);
      for (const b of printed) next.set(b.id, { at, version: bagVersion(b) });
      localPrints = next;
      printListeners.forEach((l) => l());
      writeFlag(HINT_KEY, true);
      router.refresh();
    },
  };
}

/**
 * The order's bags as each label's "Also in this order" line names them
 * (Bag ID, tier, card count), so a PDF address changes when another bag of
 * the order gains or loses a card, not only when this bag changes.
 */
export function orderLineup(bags: readonly BagSummary[]): string {
  return bags.map((b) => [b.code, b.tierName, b.cardCount].join(":")).join(",");
}

/** The bag's label PDF (one 4x6 page). `lineup`: orderLineup() of the bags shown with it. */
function bagLabelUrl(b: BagSummary, lineup: string): string {
  return `/api/admin/intake/labels/bag/${b.id}?v=${shortHash(`${bagVersion(b)}~${lineup}`)}`;
}

/** "Take a photo of every card first: 2 cards in this bag still need one." */
function needPhotoText(n: number): string {
  return `Take a photo of every card first: ${n} card${n === 1 ? " in this bag still needs" : "s in this bag still need"} one.`;
}

/** A print button held back by the photo gate (a bag's label prints once each of its cards has a receiving photo). */
function GatedPrintButton({ describedBy, children }: { describedBy: string; children: React.ReactNode }) {
  return (
    <button
      type="button"
      disabled
      aria-describedby={describedBy}
      className="inline-flex min-h-11 items-center justify-center gap-2 rounded-lg bg-foreground px-4 text-sm font-bold text-background opacity-40"
    >
      <Printer className="size-4" strokeWidth={1.75} aria-hidden />
      {children}
    </button>
  );
}

type Loaded = { key: string; body: LabelPreviewResponse | null; error: string | null };

/**
 * Labels for an order's bags (one label per tier bag): a preview of each
 * bag's label drawn from the same layout the PDF prints, print buttons per
 * bag (label, reprint) and, for several bags, one for all of them. A bag's
 * label prints once every card in it has a receiving photo (`needPhoto`:
 * cards still without one, by bag id).
 */
export function BagLabelPanel({ orderId, bags, needPhoto }: { orderId: string; bags: BagSummary[]; needPhoto: Record<string, number> }) {
  const share = useShareDevice();
  const hintSeen = useFlag(HINT_KEY, true);
  const useQz = useFlag(QZ_KEY, false);
  const qzStatus = useQzConnection(share, useQz);
  const { state, onPrinted } = useBagLabels();
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const [retry, setRetry] = useState(0);
  const [loaded, setLoaded] = useState<Loaded | null>(null);

  // What the labels show; when it changes the preview and PDFs are fetched again
  const version = bags.map(bagVersion).join("~");
  const lineup = orderLineup(bags);
  const ids = bags.map((b) => b.id).join(",");
  const key = `${orderId}|${version}|${retry}`;

  useEffect(() => {
    let cancelled = false;
    // Only the bags shown (the bag page shows one)
    fetch(`/api/admin/intake/labels/order/${orderId}?format=json&bags=${ids}`, { cache: "no-store" })
      .then(async (res) => {
        const body = await res.json().catch(() => null);
        if (!res.ok) throw new Error(body?.error ?? `HTTP ${res.status}`);
        if (!cancelled) setLoaded({ key, body: body as LabelPreviewResponse, error: null });
      })
      .catch((err: Error) => {
        if (!cancelled) setLoaded({ key, body: null, error: err.message || "The label preview didn't load." });
      });
    return () => {
      cancelled = true;
    };
  }, [orderId, ids, key]);

  const current = loaded?.key === key ? loaded : null;
  const settings = current?.body?.settings;
  const paper = settings ? { widthIn: settings.widthIn, heightIn: settings.heightIn } : { widthIn: 4, heightIn: 6 };
  // The phone tip follows the printer this device uses for this label size (50x80 defaults to the Katasymbol)
  const group = paperGroup(paper);
  const savedPrinter = useLabelPrinter(group);
  const printer = savedPrinter ?? (group === "50x80" ? "katasymbol" : "pdf");
  const stockName = settings?.stock ?? "4x6";
  const previewById = new Map((current?.body?.bags ?? []).map((b) => [b.id, b]));
  // One label per bag
  const totalLabels = bags.length;
  const gated = bags.some((b) => (needPhoto[b.id] ?? 0) > 0);
  const isOpen = (b: BagSummary) => {
    const st = state(b);
    return open[b.id] ?? (!st.printedAt || st.outdated);
  };

  return (
    <section aria-labelledby="labels-h" className="bg-white rounded-xl border border-border p-4 sm:p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 id="labels-h" className="font-heading font-black text-base text-foreground">{bags.length === 1 ? "Bag label" : "Bag labels"}</h3>
          <p className="text-xs text-muted-foreground mt-0.5">
            One label per tier bag.{" "}
            {settings ? `${settings.stock.replace("x", " × ")} in labels, ${settings.contentWidthIn} in wide print. ` : ""}
            Preview shows exactly what prints.{" "}
            <AdminLink href="/admin/receiving/settings" className="text-primary font-semibold hover:underline">Label settings</AdminLink>
          </p>
          {gated && bags.length > 1 && (
            <p id="labels-gate" className="text-xs mt-0.5 font-semibold text-amber-700">
              A bag&apos;s label prints once every card in it has a receiving photo.
            </p>
          )}
        </div>
        {bags.length > 1 &&
          (gated ? (
            <GatedPrintButton describedBy="labels-gate">Print all {totalLabels} labels</GatedPrintButton>
          ) : (
            <LabelPrintButton
              pdfUrl={`/api/admin/intake/labels/order/${orderId}?bags=${ids}&v=${shortHash(version)}`}
              fileName={`${bags[0]?.orderNumber || "order"}-labels.pdf`}
              bagIds={bags.map((b) => b.id)}
              paper={paper}
              onPrinted={onPrinted(bags)}
            >
              Print all {totalLabels} labels
            </LabelPrintButton>
          ))}
      </div>

      {!hintSeen && share && (
        <div className="mt-3 flex flex-wrap items-center justify-between gap-2 rounded-lg border border-blue-200 bg-blue-50 px-3 py-2 text-sm text-blue-900">
          <span>{printer === "katasymbol" ? "On iPhone: tap Save Image, then in the Katasymbol app tap Image, pick the label and print" : `On iPhone: pick Labelife, then PDF at ${stockName}`}</span>
          <button type="button" onClick={() => writeFlag(HINT_KEY, true)} className="min-h-11 px-3 font-bold text-blue-900 hover:underline">
            Got it
          </button>
        </div>
      )}

      {!share && (
        <div className="mt-3 flex flex-wrap items-center gap-x-5 gap-y-1">
          <label className="inline-flex min-h-11 flex-wrap items-center gap-2 text-sm text-muted-foreground">
            <input type="checkbox" checked={useQz} onChange={(e) => writeFlag(QZ_KEY, e.target.checked)} className="size-4" />
            Print with QZ Tray on this computer
            {useQz && (
              <span className={`rounded-full px-2 py-0.5 text-[11px] font-bold ${qzStatus === "ready" || isQZActive() ? "bg-green-100 text-green-700" : qzStatus === "failed" ? "bg-red-100 text-red-700" : "bg-gray-100 text-gray-600"}`}>
                {qzStatus === "ready" || isQZActive() ? "Connected" : qzStatus === "failed" ? "Not running: labels open as PDF" : "Connecting…"}
              </span>
            )}
          </label>
        </div>
      )}

      {current?.error && (
        <div role="alert" className="mt-3 flex flex-wrap items-center gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          <span>Label preview didn&apos;t load: {current.error}</span>
          <button type="button" onClick={() => setRetry((r) => r + 1)} className="min-h-11 px-2 font-bold underline">
            Try again
          </button>
        </div>
      )}

      <ul className="mt-3 flex flex-col divide-y divide-border">
        {bags.map((b) => {
          const preview = previewById.get(b.id);
          const { printedAt, outdated } = state(b);
          const expanded = isOpen(b);
          const missing = needPhoto[b.id] ?? 0;
          const pages = preview?.labels ?? [];
          return (
            <li key={b.id} className="py-3 first:pt-0 last:pb-0">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="min-w-0">
                  <p className="flex flex-wrap items-center gap-2">
                    <span className="font-mono text-sm font-bold text-foreground">{b.code}</span>
                    <span className="rounded-full bg-gray-100 px-2 py-0.5 text-[11px] font-bold text-gray-700">{b.tierName}</span>
                    <span className="text-xs text-muted-foreground">
                      {b.cardCount} card{b.cardCount === 1 ? "" : "s"}
                    </span>
                  </p>
                  <div aria-live="polite">
                    <p className={`text-xs mt-0.5 ${printedAt ? "text-muted-foreground" : "font-semibold text-amber-700"}`}>{printedText(printedAt)}</p>
                    {outdated && (
                      <p className="text-xs mt-0.5 font-semibold text-amber-700">Label out of date: its due date or cards changed since. Reprint it.</p>
                    )}
                    {missing > 0 && (
                      <p id={`label-gate-${b.id}`} className="text-xs mt-0.5 font-semibold text-amber-700">{needPhotoText(missing)}</p>
                    )}
                  </div>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  {missing > 0 ? (
                    <GatedPrintButton describedBy={`label-gate-${b.id}`}>{printedAt ? "Reprint label" : "Print label"}</GatedPrintButton>
                  ) : (
                    <LabelPrintButton
                      pdfUrl={bagLabelUrl(b, lineup)}
                      fileName={`${b.code}-label.pdf`}
                      bagIds={[b.id]}
                      paper={paper}
                      onPrinted={onPrinted([b])}
                      variant={printedAt && !outdated ? "secondary" : "primary"}
                    >
                      {printedAt ? "Reprint label" : "Print label"}
                    </LabelPrintButton>
                  )}
                  <button
                    type="button"
                    onClick={() => setOpen((o) => ({ ...o, [b.id]: !expanded }))}
                    aria-expanded={expanded}
                    aria-controls={`label-preview-${b.id}`}
                    className="inline-flex min-h-11 items-center gap-1 rounded-lg px-3 text-sm font-semibold text-primary hover:bg-muted"
                  >
                    {expanded ? "Hide preview" : "Preview"}
                    <ChevronDown className={`size-4 transition-transform ${expanded ? "rotate-180" : ""}`} strokeWidth={1.75} aria-hidden />
                  </button>
                </div>
              </div>

              <div id={`label-preview-${b.id}`} hidden={!expanded} className="mt-3">
                {expanded &&
                  (!preview ? (
                    <p className="text-sm text-muted-foreground">{current ? "No preview for this bag." : "Loading preview…"}</p>
                  ) : (
                    <div className="flex flex-wrap items-start gap-4">
                      {pages.map((page, i) => (
                        <figure key={i} className="w-full max-w-[384px]">
                          {/* The label is black only (Design B): drawn as printed */}
                          <LabelPreview
                            page={page}
                            printed
                            label={pages.length > 1 ? `Label ${i + 1} of ${pages.length} for bag ${b.code}` : `Label for bag ${b.code}`}
                          />
                          <figcaption className="mt-1 text-xs font-semibold text-muted-foreground">
                            {pages.length > 1 ? `Label ${i + 1} of ${pages.length}` : "Label"}
                            {page.cardCodes.length < preview.cardCount ? `: ${page.cardCodes.length} of ${preview.cardCount} cards listed, the rest are behind the QR` : ""}
                          </figcaption>
                        </figure>
                      ))}
                    </div>
                  ))}
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

/**
 * A card page's print button for its bag's label (the card is on it), with
 * the label's printed / out-of-date state. Held back until every card in the
 * bag has a receiving photo (`needPhoto`: cards still without one).
 */
export function BagLabelPrint({ bag, paper, needPhoto }: { bag: BagSummary; paper: { widthIn: number; heightIn: number }; needPhoto: number }) {
  const share = useShareDevice();
  const useQz = useFlag(QZ_KEY, false);
  useQzConnection(share, useQz);
  const { state, onPrinted } = useBagLabels();
  const { printedAt, outdated } = state(bag);
  const label = printedAt ? "Reprint bag label" : "Print bag label";
  return (
    <section aria-labelledby="bag-label-h" className="bg-white rounded-xl border border-border p-4 sm:p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <h2 id="bag-label-h" className="font-heading font-black text-base text-foreground">Bag label</h2>
          <p className="text-xs text-muted-foreground mt-0.5">
            This card is on the label of bag <span className="font-mono font-semibold text-foreground">{bag.code}</span> ({bag.tierName}).
          </p>
          <div aria-live="polite">
            <p className={`text-xs mt-0.5 ${printedAt ? "text-muted-foreground" : "font-semibold text-amber-700"}`}>{printedText(printedAt)}</p>
            {outdated && <p className="text-xs mt-0.5 font-semibold text-amber-700">Label out of date: its due date or cards changed since. Reprint it.</p>}
            {needPhoto > 0 && <p id="bag-label-gate" className="text-xs mt-0.5 font-semibold text-amber-700">{needPhotoText(needPhoto)}</p>}
          </div>
        </div>
        {needPhoto > 0 ? (
          <GatedPrintButton describedBy="bag-label-gate">{label}</GatedPrintButton>
        ) : (
          <LabelPrintButton
            pdfUrl={bagLabelUrl(bag, orderLineup([bag]))}
            fileName={`${bag.code}-label.pdf`}
            bagIds={[bag.id]}
            paper={paper}
            onPrinted={onPrinted([bag])}
            variant={printedAt && !outdated ? "secondary" : "primary"}
          >
            {label}
          </LabelPrintButton>
        )}
      </div>
    </section>
  );
}
