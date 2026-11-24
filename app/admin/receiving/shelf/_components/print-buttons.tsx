"use client";

import { useState, type ReactNode } from "react";
import { Printer } from "lucide-react";
import { LabelPrintButton } from "@/components/intake/label-print-button";
import { LABEL_PAPER, placeLabelsUrl } from "../_lib/places";

/**
 * Print buttons for 50 x 80 mm slot labels and shelf signs: the one place the
 * receiving workspace, the Places page and the Shelf view print from. They go
 * through LabelPrintButton, which sends 50 x 80 mm labels to the Katasymbol as
 * pictures (or the PDF path, per device). Nothing here marks a bag label
 * printed (slot labels and signs aren't bag labels).
 */

/** Prints one label PDF route at once (on a phone the file is fetched ahead of the tap). */
export function PlaceLabelButton({
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
    <LabelPrintButton pdfUrl={pdfUrl} fileName={fileName} bagIds={[]} paper={LABEL_PAPER} markPrinted={false} variant={variant}>
      {children}
    </LabelPrintButton>
  );
}

/**
 * A print button for long lists (a slot per tile, a range per station): the
 * file is made only when asked. The first tap gets it ready (`load` may first
 * make places, e.g. shelf slots, and returns the label route), the second
 * prints it (a phone's share sheet needs the file ready before the tap).
 */
export function LazyPrintButton({
  url,
  load,
  fileName,
  prepareLabel,
  printLabel,
  compact = false,
  ariaLabel,
}: {
  /** The label route, when it's known already. */
  url?: string;
  /** Otherwise: make what's needed, then return the label route. */
  load?: () => Promise<{ url: string; count: number } | { error: string }>;
  fileName: string;
  prepareLabel: ReactNode;
  printLabel: (count: number | null) => ReactNode;
  /** A small button (slot tiles). */
  compact?: boolean;
  ariaLabel?: string;
}) {
  const [ready, setReady] = useState<{ url: string; count: number | null } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function prepare() {
    setError(null);
    if (url) return setReady({ url, count: null });
    if (!load) return;
    setBusy(true);
    try {
      const got = await load();
      if ("error" in got) setError(got.error);
      else setReady({ url: got.url, count: got.count });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't get the labels ready.");
    } finally {
      setBusy(false);
    }
  }

  if (ready) {
    return (
      <span className="inline-flex flex-wrap items-center gap-1">
        <LabelPrintButton
          key={ready.url}
          pdfUrl={ready.url}
          fileName={fileName}
          bagIds={[]}
          paper={LABEL_PAPER}
          markPrinted={false}
          variant="primary"
          // Slot tiles stay small: the printer is picked on the bigger print buttons
          showPrinterChoice={compact ? false : undefined}
        >
          {printLabel(ready.count)}
        </LabelPrintButton>
        <button type="button" onClick={() => setReady(null)} className="min-h-11 px-2 rounded-lg text-sm font-bold text-muted-foreground hover:text-foreground">
          Cancel
        </button>
      </span>
    );
  }
  return (
    <span className="inline-flex flex-col gap-1">
      <button
        type="button"
        onClick={prepare}
        disabled={busy}
        aria-label={ariaLabel}
        className={`border border-border bg-white text-foreground hover:bg-muted inline-flex min-h-11 items-center justify-center gap-2 rounded-lg ${compact ? "px-2.5" : "px-4"} text-sm font-bold transition-opacity disabled:opacity-50`}
      >
        <Printer className="size-4" strokeWidth={1.75} aria-hidden />
        {busy ? "Getting ready…" : prepareLabel}
      </button>
      {error && <span role="alert" className="text-xs font-semibold text-red-600">{error}</span>}
    </span>
  );
}

/** A shelf slot's sign, made only when asked (the Shelf view lists many). */
export function ShelfSignButton({ placeId, code, name }: { placeId: string; code: string; name: string }) {
  return (
    <LazyPrintButton
      url={placeLabelsUrl({ ids: [placeId] })}
      fileName={`${code}-sign.pdf`}
      prepareLabel="Sign"
      printLabel={() => "Print sign"}
      ariaLabel={`Print the ${name} sign`}
    />
  );
}
