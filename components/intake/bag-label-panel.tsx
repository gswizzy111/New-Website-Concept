"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import { ChevronDown } from "lucide-react";
import { AdminLink } from "@/components/admin-ui/admin-link";
import { connectQZ, isQZActive } from "@/lib/qz-print";
import type { BagSummary } from "@/lib/intake/types";
import type { LabelPreviewResponse } from "@/lib/intake/labels/respond";
import { LabelPreview } from "./label-preview";
import { LabelPrintButton, useShareDevice } from "./label-print-button";

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

function printedText(iso: string | null): string {
  if (!iso) return "Label not printed yet";
  const when = new Date(iso).toLocaleString("en-US", {
    timeZone: "America/New_York",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
  return `Label printed ${when}`;
}

type Loaded = { key: string; body: LabelPreviewResponse | null; error: string | null };

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

/**
 * Labels for an order's bags (Design A "Ledger"): a preview of each bag's
 * labels and tag drawn from the same layout the PDF prints, and print
 * buttons per bag (labels, reprint, reusable tag) and for the whole order.
 */
export function BagLabelPanel({ orderId, bags }: { orderId: string; bags: BagSummary[] }) {
  const share = useShareDevice();
  const hintSeen = useFlag(HINT_KEY, true);
  const useQz = useFlag(QZ_KEY, false);
  const [asPrinted, setAsPrinted] = useState(false);
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const [printedAt, setPrintedAt] = useState<Record<string, string>>({});
  const [qzStatus, setQzStatus] = useState<"off" | "connecting" | "ready" | "failed">("off");
  const [retry, setRetry] = useState(0);
  const [loaded, setLoaded] = useState<Loaded | null>(null);

  // What the labels show; when it changes the preview and PDFs are fetched again
  const version = bags.map(bagVersion).join("~");
  const key = `${orderId}|${version}|${retry}`;

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/admin/intake/labels/order/${orderId}?format=json`, { cache: "no-store" })
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
  }, [orderId, key]);

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

  const current = loaded?.key === key ? loaded : null;
  const settings = current?.body?.settings;
  const paper = settings ? { widthIn: settings.widthIn, heightIn: settings.heightIn } : { widthIn: 4, heightIn: 6 };
  const stockName = settings?.stock ?? "4x6";
  const previewById = new Map((current?.body?.bags ?? []).map((b) => [b.id, b]));
  const v = shortHash(version);
  const markPrinted = (ids: string[]) => (at: string) => {
    setPrintedAt((p) => ({ ...p, ...Object.fromEntries(ids.map((id) => [id, at])) }));
    writeFlag(HINT_KEY, true);
  };
  // Printed, then its due date or cards changed (and not reprinted since this page loaded)
  const outdated = (b: BagSummary) => b.labelOutdated && !printedAt[b.id];
  const isOpen = (b: BagSummary) => open[b.id] ?? (!(printedAt[b.id] ?? b.labelPrintedAt) || outdated(b));
  const totalLabels = bags.reduce((n, b) => n + (previewById.get(b.id)?.labels.length ?? 0), 0);

  return (
    <section aria-labelledby="labels-h" className="bg-white rounded-xl border border-border p-4 sm:p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 id="labels-h" className="font-heading font-black text-base text-foreground">Bag labels</h3>
          <p className="text-xs text-muted-foreground mt-0.5">
            {settings ? `${settings.stock.replace("x", " × ")} in labels, ${settings.contentWidthIn} in wide print. ` : ""}
            Preview shows exactly what prints.{" "}
            <AdminLink href="/admin/receiving/settings" className="text-primary font-semibold hover:underline">Label settings</AdminLink>
          </p>
        </div>
        {bags.length > 1 && (
          <LabelPrintButton
            pdfUrl={`/api/admin/intake/labels/order/${orderId}?v=${v}`}
            fileName={`${bags[0]?.orderNumber || "order"}-labels.pdf`}
            bagIds={bags.map((b) => b.id)}
            paper={paper}
            onPrinted={markPrinted(bags.map((b) => b.id))}
          >
            {totalLabels ? `Print all ${totalLabels} labels` : "Print all labels"}
          </LabelPrintButton>
        )}
      </div>

      {!hintSeen && share && (
        <div className="mt-3 flex flex-wrap items-center justify-between gap-2 rounded-lg border border-blue-200 bg-blue-50 px-3 py-2 text-sm text-blue-900">
          <span>On iPhone: pick Labelife, then PDF at {stockName}</span>
          <button type="button" onClick={() => writeFlag(HINT_KEY, true)} className="min-h-11 px-3 font-bold text-blue-900 hover:underline">
            Got it
          </button>
        </div>
      )}

      <div className="mt-3 flex flex-wrap items-center gap-x-5 gap-y-1">
        <label className="inline-flex min-h-11 items-center gap-2 text-sm font-semibold text-foreground">
          <input type="checkbox" checked={asPrinted} onChange={(e) => setAsPrinted(e.target.checked)} className="size-4" />
          Show as printed (black only)
        </label>
        {!share && (
          <label className="inline-flex min-h-11 items-center gap-2 text-sm text-muted-foreground">
            <input type="checkbox" checked={useQz} onChange={(e) => writeFlag(QZ_KEY, e.target.checked)} className="size-4" />
            Print with QZ Tray on this computer
            {useQz && (
              <span className={`rounded-full px-2 py-0.5 text-[11px] font-bold ${qzStatus === "ready" || isQZActive() ? "bg-green-100 text-green-700" : qzStatus === "failed" ? "bg-red-100 text-red-700" : "bg-gray-100 text-gray-600"}`}>
                {qzStatus === "ready" || isQZActive() ? "Connected" : qzStatus === "failed" ? "Not running: labels open as PDF" : "Connecting…"}
              </span>
            )}
          </label>
        )}
      </div>

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
          const printed = printedAt[b.id] ?? b.labelPrintedAt;
          const count = preview?.labels.length ?? 0;
          const expanded = isOpen(b);
          const url = `/api/admin/intake/labels/bag/${b.id}?v=${shortHash(bagVersion(b))}`;
          return (
            <li key={b.id} className="py-3 first:pt-0 last:pb-0">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="min-w-0">
                  <p className="flex flex-wrap items-center gap-2">
                    <span className="font-mono text-sm font-bold text-foreground">{b.code}</span>
                    <span className="rounded-full bg-gray-100 px-2 py-0.5 text-[11px] font-bold text-gray-700">{b.tierName}</span>
                    <span className="text-xs text-muted-foreground">
                      {b.cardCount} card{b.cardCount === 1 ? "" : "s"}
                      {count > 1 ? ` · ${count} labels` : ""}
                    </span>
                  </p>
                  <p className={`text-xs mt-0.5 ${printed ? "text-muted-foreground" : "font-semibold text-amber-700"}`}>{printedText(printed)}</p>
                  {outdated(b) && (
                    <p className="text-xs mt-0.5 font-semibold text-amber-700">Label out of date: its due date or cards changed since. Reprint it.</p>
                  )}
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <LabelPrintButton
                    pdfUrl={url}
                    fileName={`${b.code}-labels.pdf`}
                    bagIds={[b.id]}
                    paper={paper}
                    onPrinted={markPrinted([b.id])}
                    variant={printed && !outdated(b) ? "secondary" : "primary"}
                  >
                    {printed ? "Reprint" : count > 1 ? `Print ${count} labels` : "Print label"}
                  </LabelPrintButton>
                  <LabelPrintButton
                    pdfUrl={`${url}&tag=1`}
                    fileName={`${b.code}-tag.pdf`}
                    bagIds={[b.id]}
                    paper={paper}
                    markPrinted={false}
                    variant="secondary"
                  >
                    Print tag
                  </LabelPrintButton>
                  <button
                    type="button"
                    onClick={() => setOpen((o) => ({ ...o, [b.id]: !expanded }))}
                    aria-expanded={expanded}
                    className="inline-flex min-h-11 items-center gap-1 rounded-lg px-3 text-sm font-semibold text-primary hover:bg-muted"
                  >
                    {expanded ? "Hide preview" : "Preview"}
                    <ChevronDown className={`size-4 transition-transform ${expanded ? "rotate-180" : ""}`} strokeWidth={1.75} aria-hidden />
                  </button>
                </div>
              </div>

              {expanded && (
                <div className="mt-3">
                  {!preview ? (
                    <p className="text-sm text-muted-foreground">{current ? "No preview for this bag." : "Loading preview…"}</p>
                  ) : (
                    <div className="flex flex-wrap gap-4">
                      {preview.labels.map((page, i) => (
                        <figure key={i} className="w-full max-w-[384px]">
                          <LabelPreview page={page} printed={asPrinted} label={`Label ${i + 1} of ${preview.labels.length} for bag ${b.code}`} />
                          <figcaption className="mt-1 text-xs font-semibold text-muted-foreground">
                            Label {i + 1} of {preview.labels.length}
                          </figcaption>
                        </figure>
                      ))}
                      <figure className="w-full max-w-[384px]">
                        <LabelPreview page={preview.tag} printed={asPrinted} label={`Reusable tag for bag ${b.code}`} />
                        <figcaption className="mt-1 text-xs font-semibold text-muted-foreground">Reusable tag (cut on the marks)</figcaption>
                      </figure>
                    </div>
                  )}
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
