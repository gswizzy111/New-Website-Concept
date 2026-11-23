"use client";

import { useEffect, useState, useSyncExternalStore, type ReactNode } from "react";
import { Printer } from "lucide-react";
import { findPrinter, isQZActive, printPdfBase64 } from "@/lib/qz-print";

/**
 * True on an iPhone, iPad or Android phone that can hand a file to the share
 * sheet: there the Labelife app prints over Bluetooth.
 */
function detectShareDevice(): boolean {
  if (typeof navigator === "undefined" || typeof navigator.canShare !== "function") return false;
  const ua = navigator.userAgent;
  const ipadOs = navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1;
  return /iPhone|iPad|iPod|Android/i.test(ua) || ipadOs;
}

export function useShareDevice(): boolean {
  return useSyncExternalStore(() => () => {}, detectShareDevice, () => false);
}

function toBase64(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  let s = "";
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

/**
 * Prints a label (or tag) PDF from our own label routes:
 * - iPhone / iPad / Android: the PDF is fetched ahead of the tap (Safari only
 *   opens the share sheet straight from a tap) and handed to the share sheet,
 *   where Labelife prints it.
 * - A computer with QZ Tray connected: the browser fetches the PDF (QZ can't
 *   send the admin sign-in) and QZ prints it at the stock's size, 1:1.
 * - Otherwise the PDF opens in a new tab to print from there.
 * After the print request it records the print (label_printed_at).
 */
export function LabelPrintButton({
  pdfUrl,
  fileName,
  bagIds,
  paper,
  children,
  variant = "primary",
  markPrinted = true,
  onPrinted,
}: {
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
}) {
  const share = useShareDevice();
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

  async function recordPrint() {
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
