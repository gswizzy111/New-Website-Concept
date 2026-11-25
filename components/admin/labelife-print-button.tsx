"use client";

import { useEffect, useRef, useState } from "react";
import { connectQZ, findPrinter, printLabel, isQZActive } from "@/lib/qz-print";

export type LabelPrintStatus = "loading" | "ready" | "error" | "sharing";

/**
 * The print path of a shipping label, for any button: on a computer running
 * QZ Tray it goes straight to the label printer (the D520). Otherwise it's
 * for the Bluetooth printer: it hands the label PDF to the share sheet,
 * where Labelife picks it up and prints it. The PDF is fetched ahead of time
 * because Safari only opens the share sheet straight from a tap. Where the
 * share sheet can't take files, the PDF opens instead.
 *
 * `autoPrint` opens the share sheet as soon as the PDF is ready (right after a
 * label is purchased); if the browser won't allow that, the button is there.
 */
export function useLabelPrint(labelUrl: string, { fileName = "shipping-label.pdf", autoPrint = false }: { fileName?: string; autoPrint?: boolean } = {}): {
  status: LabelPrintStatus;
  print: () => Promise<void>;
} {
  // The fetched PDF, kept with the URL it came from so a new label shows as loading
  const [loaded, setLoaded] = useState<{ url: string; file: File | null } | null>(null);
  const [sharing, setSharing] = useState(false);
  const autoTried = useRef(false);
  const file = loaded?.url === labelUrl ? loaded.file : null;
  const status: LabelPrintStatus = sharing ? "sharing" : loaded?.url !== labelUrl ? "loading" : file ? "ready" : "error";

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/admin/proxy-label?url=${encodeURIComponent(labelUrl)}`)
      .then(async (res) => {
        if (!res.ok) throw new Error("Failed to load label");
        const blob = await res.blob();
        if (!cancelled) setLoaded({ url: labelUrl, file: new File([blob], fileName, { type: blob.type || "application/pdf" }) });
      })
      .catch(() => { if (!cancelled) setLoaded({ url: labelUrl, file: null }); });
    return () => { cancelled = true; };
  }, [labelUrl, fileName]);

  function canShareFile(f: File | null): f is File {
    return !!f && typeof navigator !== "undefined" && !!navigator.canShare?.({ files: [f] });
  }

  async function print() {
    if (isQZActive()) {
      setSharing(true);
      try {
        await connectQZ();
        const printer = await findPrinter(localStorage.getItem("qz_printer") ?? "D520");
        if (await printLabel(labelUrl, printer)) return;
      } catch (err) {
        console.error("QZ print failed:", err);
      } finally {
        setSharing(false);
      }
    }
    if (!canShareFile(file)) {
      window.open(labelUrl, "_blank");
      return;
    }
    setSharing(true);
    try {
      await navigator.share({ files: [file], title: "Shipping label" });
    } catch {
      // Cancelled, or not allowed without a tap — the button stays for a manual try
    } finally {
      setSharing(false);
    }
  }

  useEffect(() => {
    if (autoPrint && status === "ready" && !autoTried.current && !isQZActive() && canShareFile(file)) {
      autoTried.current = true;
      print();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoPrint, status, file]);

  return { status, print };
}

/**
 * Print a shipping label (useLabelPrint): QZ Tray, else the share sheet for
 * Labelife, else the PDF opens.
 */
export function LabelifePrintButton({ labelUrl, fileName = "shipping-label.pdf", autoPrint = false, size = "sm" }: {
  labelUrl: string;
  fileName?: string;
  autoPrint?: boolean;
  size?: "xs" | "sm";
}) {
  const { status, print } = useLabelPrint(labelUrl, { fileName, autoPrint });
  const cls = size === "xs" ? "text-xs px-3 py-1.5" : "text-sm px-4 py-2";
  return (
    <button
      onClick={print}
      disabled={status === "loading" || status === "sharing"}
      title="Send to Labelife to print on the Bluetooth label printer"
      className={`${cls} flex items-center gap-1.5 font-bold bg-foreground text-background rounded-lg hover:opacity-90 transition-opacity disabled:opacity-50`}
    >
      <span>🖨</span> {status === "loading" ? "Loading…" : status === "sharing" ? "Printing…" : "Print"}
    </button>
  );
}
