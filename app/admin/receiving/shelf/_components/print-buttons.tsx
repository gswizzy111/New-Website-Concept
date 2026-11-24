"use client";

import { useEffect, useState, type ReactNode } from "react";
import { Printer } from "lucide-react";
import { LabelPrintButton } from "@/components/intake/label-print-button";
import { STICKER_PAPER } from "../_lib/places";

/**
 * Print buttons for 50 x 80 mm card stickers and place signs (Katasymbol).
 * The one place the receiving workspace, the Places page and the Shelf view
 * print from, so the printing path can change here alone. Nothing here marks
 * a bag label printed (stickers and signs aren't bag labels).
 */

/** One PDF (card stickers of an order or bag, or one place's sign). */
export function StickerPrintButton({
  pdfUrl,
  fileName,
  children,
  variant = "secondary",
}: {
  pdfUrl: string;
  fileName: string;
  children: ReactNode;
  variant?: "primary" | "secondary";
}) {
  return (
    <LabelPrintButton pdfUrl={pdfUrl} fileName={fileName} bagIds={[]} paper={STICKER_PAPER} markPrinted={false} variant={variant}>
      {children}
    </LabelPrintButton>
  );
}

type Ready = { url: string; count: number; key: string };

/**
 * Several PDFs printed as one (all station signs, a run of shelf signs): a
 * first tap gets them ready (`load` returns the PDF routes, after any set-up
 * such as making shelf slots), merged into one file in the browser; a second
 * tap prints it like any label (the phone's share sheet needs the file ready
 * before the tap).
 */
export function MergedPrintButton({
  load,
  fileName,
  prepareLabel,
  printLabel,
  variant = "secondary",
}: {
  load: () => Promise<{ urls: string[] } | { error: string }>;
  fileName: string;
  /** "Print all station signs" */
  prepareLabel: string;
  /** "Print 8 signs" */
  printLabel: (count: number) => string;
  variant?: "primary" | "secondary";
}) {
  const [busy, setBusy] = useState(false);
  const [ready, setReady] = useState<Ready | null>(null);
  const [error, setError] = useState<string | null>(null);

  // The merged file lives until it's replaced or the page closes
  useEffect(() => () => {
    if (ready) URL.revokeObjectURL(ready.url);
  }, [ready]);

  async function prepare() {
    setBusy(true);
    setError(null);
    try {
      const got = await load();
      if ("error" in got) throw new Error(got.error);
      if (!got.urls.length) throw new Error("Nothing to print.");
      const [{ PDFDocument }, files] = await Promise.all([
        import("pdf-lib"),
        Promise.all(got.urls.map(async (u) => {
          const res = await fetch(u, { cache: "no-store" });
          if (!res.ok) {
            const data = await res.json().catch(() => ({}));
            throw new Error(data.error ?? `A sign couldn't be made (${res.status}).`);
          }
          return res.arrayBuffer();
        })),
      ]);
      const out = await PDFDocument.create();
      for (const bytes of files) {
        const src = await PDFDocument.load(bytes);
        for (const page of await out.copyPages(src, src.getPageIndices())) out.addPage(page);
      }
      const blob = new Blob([(await out.save()) as unknown as BlobPart], { type: "application/pdf" });
      setReady({ url: URL.createObjectURL(blob), count: got.urls.length, key: got.urls.join("|") });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't get the signs ready.");
    } finally {
      setBusy(false);
    }
  }

  const cls =
    variant === "primary"
      ? "bg-foreground text-background hover:opacity-90"
      : "border border-border bg-white text-foreground hover:bg-muted";

  return (
    <span className="inline-flex flex-col gap-1">
      {ready ? (
        <span className="inline-flex flex-wrap items-center gap-2">
          <LabelPrintButton key={ready.key} pdfUrl={ready.url} fileName={fileName} bagIds={[]} paper={STICKER_PAPER} markPrinted={false} variant="primary">
            {printLabel(ready.count)}
          </LabelPrintButton>
          <button type="button" onClick={() => setReady(null)} className="min-h-11 px-3 rounded-lg text-sm font-bold text-muted-foreground hover:text-foreground">
            Cancel
          </button>
        </span>
      ) : (
        <button
          type="button"
          onClick={prepare}
          disabled={busy}
          className={`${cls} inline-flex min-h-11 items-center justify-center gap-2 rounded-lg px-4 text-sm font-bold transition-opacity disabled:opacity-50`}
        >
          <Printer className="size-4" strokeWidth={1.75} aria-hidden />
          {busy ? "Getting ready…" : prepareLabel}
        </button>
      )}
      {error && <span role="alert" className="text-xs font-semibold text-red-600">{error}</span>}
    </span>
  );
}
