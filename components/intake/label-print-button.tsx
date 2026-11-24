"use client";

import { useEffect, useState, useSyncExternalStore, type ReactNode } from "react";
import { ChevronDown, Printer } from "lucide-react";
import { findPrinter, isQZActive, printPdfBase64 } from "@/lib/qz-print";
import { detectShareDevice, labelJsonUrl } from "./label-image";
import { PrintImagesButton } from "./print-images-button";

const noSubscribe = () => () => {};

/**
 * True on an iPhone, iPad or Android phone that can hand a file to the share
 * sheet: there the Labelife app prints a PDF over Bluetooth, and the
 * Katasymbol app a picture.
 */
export function useShareDevice(): boolean {
  return useSyncExternalStore(noSubscribe, detectShareDevice, () => false);
}

// ---------------------------------------------------------------------------
// Which printer this device prints labels on (kept in this browser), for each
// label size: the Katasymbol takes 50 x 80 mm labels only (slot labels, shelf
// signs, bag labels when the bag label size is 50 x 80), the Labelife D520 the
// inch stocks (bag labels at 4 x 6). So a phone can print slot labels on the
// Katasymbol and bag labels on the D520 without switching back and forth.

export type LabelPrinter = "katasymbol" | "pdf";
/** "50x80": the Katasymbol's labels; "inch": the D520's 4x6, 4x3, 3x5. */
export type LabelPaperGroup = "50x80" | "inch";

export const LABEL_PRINTERS: { id: LabelPrinter; name: string; hint: string }[] = [
  { id: "katasymbol", name: "Katasymbol (image)", hint: "50 × 80 mm labels: the label goes to Photos, the Katasymbol app prints it." },
  { id: "pdf", name: "PDF / Labelife / QZ", hint: "The Labelife D520: Labelife on a phone, QZ Tray or the PDF on a computer." },
];

/** localStorage keys of this device's choice, by label size. */
export const LABEL_PRINTER_KEYS: Record<LabelPaperGroup, string> = {
  "50x80": "intake_label_printer_50x80",
  inch: "intake_label_printer",
};
/** Until a device picks: the Katasymbol for its labels, the PDF path (as before) for the rest. */
export const DEFAULT_PRINTER: Record<LabelPaperGroup, LabelPrinter> = { "50x80": "katasymbol", inch: "pdf" };
/** The label stock the Katasymbol pictures ask the label routes for. */
export const KATASYMBOL_STOCK = "50x80mm";

/** Which size group a label stock is in: 50 x 80 mm (within a millimetre) or an inch stock. */
export function paperGroup(paper: { widthIn: number; heightIn: number }): LabelPaperGroup {
  const w = paper.widthIn * 25.4;
  const h = paper.heightIn * 25.4;
  return Math.abs(w - 50) < 1 && Math.abs(h - 80) < 1 ? "50x80" : "inch";
}

const printerListeners = new Set<() => void>();
// When the browser won't store it (private mode), the choice lasts for this page
const memoryPrinter: Record<LabelPaperGroup, LabelPrinter | null> = { "50x80": null, inch: null };

function isPrinter(v: unknown): v is LabelPrinter {
  return v === "katasymbol" || v === "pdf";
}

function readPrinter(group: LabelPaperGroup): LabelPrinter | null {
  try {
    const v = localStorage.getItem(LABEL_PRINTER_KEYS[group]);
    return isPrinter(v) ? v : memoryPrinter[group];
  } catch {
    return memoryPrinter[group];
  }
}

/** Saves this device's printer for one label size (every print button follows it at once). */
export function setLabelPrinter(p: LabelPrinter, group: LabelPaperGroup = "50x80"): void {
  memoryPrinter[group] = p;
  try {
    localStorage.setItem(LABEL_PRINTER_KEYS[group], p);
  } catch {
    // Private mode: kept in memory for this page only
  }
  printerListeners.forEach((l) => l());
}

function subscribePrinter(cb: () => void) {
  printerListeners.add(cb);
  window.addEventListener("storage", cb);
  return () => {
    printerListeners.delete(cb);
    window.removeEventListener("storage", cb);
  };
}

/** This device's saved printer for a label size, or null when none was picked yet. */
export function useLabelPrinter(group: LabelPaperGroup = "50x80"): LabelPrinter | null {
  return useSyncExternalStore(subscribePrinter, () => readPrinter(group), () => null);
}

/**
 * Picks the printer this device prints labels on. `compact`: one small line
 * under a print button ("Printer: Katasymbol (image)") that opens the two
 * choices; otherwise both choices with their hints (the printing guide).
 */
export function LabelPrinterChoice({
  group = "50x80",
  compact = false,
  defaultPrinter,
  label = "Printer for labels",
}: {
  group?: LabelPaperGroup;
  compact?: boolean;
  defaultPrinter?: LabelPrinter;
  /** The choices' name for screen readers. */
  label?: string;
}) {
  const saved = useLabelPrinter(group);
  const current = saved ?? defaultPrinter ?? DEFAULT_PRINTER[group];
  const [open, setOpen] = useState(false);
  const name = LABEL_PRINTERS.find((p) => p.id === current)?.name ?? "";

  const options = (
    <div role="radiogroup" aria-label={label} className={compact ? "flex flex-wrap gap-1.5" : "grid gap-2 sm:grid-cols-2"}>
      {LABEL_PRINTERS.map((p) => {
        const on = p.id === current;
        return (
          <button
            key={p.id}
            type="button"
            role="radio"
            aria-checked={on}
            onClick={() => {
              setLabelPrinter(p.id, group);
              setOpen(false);
            }}
            className={`min-h-11 rounded-lg border px-3 text-left text-sm transition-colors ${
              on ? "border-foreground bg-foreground text-background" : "border-border bg-white text-foreground hover:bg-muted"
            } ${compact ? "font-semibold" : "py-2"}`}
          >
            <span className="block font-bold">{p.name}</span>
            {!compact && <span className={`mt-0.5 block text-xs ${on ? "text-background/80" : "text-muted-foreground"}`}>{p.hint}</span>}
          </button>
        );
      })}
    </div>
  );

  if (!compact) return options;
  return (
    <span className="inline-flex flex-col gap-1">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="inline-flex min-h-11 items-center gap-1 self-start px-1 text-xs font-semibold text-muted-foreground hover:text-foreground"
      >
        Printer: <span className="text-foreground">{name}</span>
        <ChevronDown className={`size-3.5 transition-transform ${open ? "rotate-180" : ""}`} strokeWidth={1.75} aria-hidden />
      </button>
      {open && options}
    </span>
  );
}

// ---------------------------------------------------------------------------

function toBase64(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  let s = "";
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

/** Records a bag label print (label_printed_at) once the print request went out. */
async function recordBagPrint(bagIds: string[], markPrinted: boolean, onPrinted?: (printedAt: string) => void) {
  if (!markPrinted || !bagIds.length) return;
  try {
    const res = await fetch("/api/admin/intake/labels/printed", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ bagIds }),
    });
    const data = await res.json().catch(() => ({}));
    if (res.ok && data.printedAt) onPrinted?.(data.printedAt);
  } catch {
    // The print itself went out; only the "printed" stamp is missing
  }
}

type LabelPrintProps = {
  /** Same-origin label route, e.g. /api/admin/intake/labels/bag/<id> */
  pdfUrl: string;
  fileName: string;
  /** Bags whose labels this prints (stamped as printed afterwards). */
  bagIds: string[];
  /** The label stock, for QZ Tray. */
  paper: { widthIn: number; heightIn: number };
  children: ReactNode;
  variant?: "primary" | "secondary";
  /** Tags don't count as the bag's label print. */
  markPrinted?: boolean;
  onPrinted?: (printedAt: string) => void;
  /**
   * The same labels as JSON for the Katasymbol pictures. Default: the PDF
   * address with ?format=json&stock=50x80mm.
   */
  imageUrl?: string;
  /**
   * The printer until this device picks one for this label size. Default: the
   * Katasymbol for 50 x 80 mm labels, the PDF path (as before) for the rest.
   */
  defaultPrinter?: LabelPrinter;
  /** The "Printer: …" line under the button. Default: on phones, and wherever Katasymbol is picked. */
  showPrinterChoice?: boolean;
};

/**
 * Prints a label (or sign) from our own label routes, on the printer this
 * device picked for the label's size (LabelPrinterChoice; until then the
 * Katasymbol for 50 x 80 mm labels and the PDF path for the inch stocks):
 * - PDF / Labelife / QZ (the D520, unchanged): on a phone the PDF is fetched
 *   ahead of the tap (Safari only opens the share sheet straight from a tap)
 *   and handed to the share sheet, where Labelife prints it; on a computer
 *   with QZ Tray connected the browser fetches the PDF and QZ prints it at
 *   the stock's size, 1:1; otherwise the PDF opens in a new tab.
 * - Katasymbol (image): the labels as 50 x 80 mm pictures (PrintImagesButton):
 *   the share sheet on a phone ("Save Image", then Katasymbol), downloads on
 *   a computer.
 * After the print request it records the print (label_printed_at).
 */
export function LabelPrintButton({ imageUrl, defaultPrinter, showPrinterChoice, ...props }: LabelPrintProps) {
  const share = useShareDevice();
  const group = paperGroup(props.paper);
  const saved = useLabelPrinter(group);
  const printer = saved ?? defaultPrinter ?? DEFAULT_PRINTER[group];
  const showChoice = showPrinterChoice ?? (share || printer === "katasymbol");
  const { pdfUrl, fileName, bagIds, markPrinted = true, onPrinted, variant, children } = props;

  return (
    <span className="inline-flex flex-col gap-1">
      {printer === "katasymbol" ? (
        <PrintImagesButton
          url={imageUrl ?? labelJsonUrl(pdfUrl, { stock: KATASYMBOL_STOCK })}
          baseName={fileName.replace(/\.pdf$/i, "") || "label"}
          variant={variant}
          onPrinted={() => recordBagPrint(bagIds, markPrinted, onPrinted)}
        >
          {children}
        </PrintImagesButton>
      ) : (
        <PdfPrintButton {...props} share={share} />
      )}
      {showChoice && <LabelPrinterChoice compact group={group} defaultPrinter={defaultPrinter} />}
    </span>
  );
}

/** The PDF path (Labelife share sheet on a phone, QZ Tray or a new tab on a computer). */
function PdfPrintButton({
  pdfUrl,
  fileName,
  bagIds,
  paper,
  children,
  variant = "primary",
  markPrinted = true,
  onPrinted,
  share,
}: Omit<LabelPrintProps, "imageUrl" | "defaultPrinter" | "showPrinterChoice"> & { share: boolean }) {
  const [loaded, setLoaded] = useState<{ url: string; file: File | null } | null>(null);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const file = loaded?.url === pdfUrl ? loaded.file : null;
  const loading = share && loaded?.url !== pdfUrl;

  useEffect(() => {
    if (!share) return;
    let cancelled = false;
    fetch(pdfUrl, { cache: "no-store" })
      .then(async (res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const blob = await res.blob();
        if (!cancelled) setLoaded({ url: pdfUrl, file: new File([blob], fileName, { type: "application/pdf" }) });
      })
      .catch(() => {
        if (!cancelled) setLoaded({ url: pdfUrl, file: null });
      });
    return () => {
      cancelled = true;
    };
  }, [share, pdfUrl, fileName]);

  const recordPrint = () => recordBagPrint(bagIds, markPrinted, onPrinted);

  async function shareFile(f: File) {
    setBusy(true);
    setProblem(null);
    try {
      await navigator.share({ files: [f], title: fileName });
      await recordPrint();
    } catch (err) {
      // Cancelled: nothing printed. Anything else: offer the PDF itself.
      if ((err as Error)?.name !== "AbortError") setProblem("The share sheet didn't open. Open the PDF instead.");
    } finally {
      setBusy(false);
    }
  }

  async function printWithQz() {
    setBusy(true);
    setProblem(null);
    try {
      const res = await fetch(pdfUrl, { cache: "no-store" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const base64 = toBase64(await res.arrayBuffer());
      const printer = await findPrinter(localStorage.getItem("qz_printer") ?? "D520");
      await printPdfBase64(base64, printer, paper);
      await recordPrint();
    } catch (err) {
      console.error("QZ Tray print failed:", err);
      setProblem("QZ Tray couldn't print. Open the PDF instead.");
    } finally {
      setBusy(false);
    }
  }

  function print() {
    if (share && file && navigator.canShare?.({ files: [file] })) {
      void shareFile(file);
      return;
    }
    if (!share && isQZActive()) {
      void printWithQz();
      return;
    }
    // Opened straight from the tap so the browser allows the new tab
    window.open(pdfUrl, "_blank");
    void recordPrint();
  }

  const cls =
    variant === "primary"
      ? "bg-foreground text-background hover:opacity-90"
      : "border border-border bg-white text-foreground hover:bg-muted";

  return (
    <span className="inline-flex flex-col gap-1">
      <button
        type="button"
        onClick={print}
        disabled={busy || loading}
        className={`${cls} inline-flex min-h-11 items-center justify-center gap-2 rounded-lg px-4 text-sm font-bold transition-opacity disabled:opacity-50`}
      >
        <Printer className="size-4" strokeWidth={1.75} aria-hidden />
        {loading ? "Loading…" : busy ? "Printing…" : children}
      </button>
      {problem && (
        <span role="status" className="text-xs font-medium text-red-600">
          {problem}{" "}
          <a href={pdfUrl} target="_blank" rel="noreferrer" className="text-primary underline">
            Open PDF
          </a>
        </span>
      )}
    </span>
  );
}
