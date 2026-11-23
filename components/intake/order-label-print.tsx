"use client";

import { Camera, Printer } from "lucide-react";
import type { BagSummary } from "@/lib/intake/types";
import { LabelPrintButton } from "./label-print-button";
import { bagVersion, printedWhen, shortHash, useBagLabels } from "./bag-label-panel";

/**
 * The receiving workspace's "Print labels" step: once every received card in
 * the order has a receiving photo, one button prints the label of every bag
 * (one per tier) still missing one or whose label went out of date. Until
 * then it says how many cards still need a photo and jumps to the first. When
 * every bag's label is printed and current it offers a reprint of them all.
 * Previews and single bags stay in the Bag labels panel below. Bags with no
 * cards left (every card refunded) get no label: the page leaves them out.
 */
export function OrderLabelPrint({
  orderId,
  orderNumber,
  bags,
  paper,
  needPhoto,
}: {
  orderId: string;
  orderNumber: string;
  bags: BagSummary[];
  /** The label stock, for QZ Tray. */
  paper: { widthIn: number; heightIn: number };
  /** Received cards without a receiving photo yet, in card order. */
  needPhoto: { id: string; label: string }[];
}) {
  const { state, onPrinted } = useBagLabels();
  if (bags.length === 0) return null;

  if (needPhoto.length > 0) {
    const first = needPhoto[0];
    return (
      <section aria-labelledby="print-step-h" className="mt-4 rounded-xl border border-dashed border-border bg-white p-4 sm:p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="min-w-0">
            <h3 id="print-step-h" className="font-heading font-black text-base text-foreground">Print labels</h3>
            <p id="print-step-gate" className="mt-0.5 text-sm text-muted-foreground">
              Take a photo of every card first: {needPhoto.length} card{needPhoto.length === 1 ? " still needs" : "s still need"} one.
            </p>
            <a href={`#card-${first.id}`} className="mt-1 inline-flex min-h-11 items-center gap-1.5 text-sm font-bold text-primary hover:underline">
              <Camera className="size-4" strokeWidth={1.75} aria-hidden />
              Go to {first.label}
            </a>
          </div>
          <button
            type="button"
            disabled
            aria-describedby="print-step-gate"
            className="inline-flex min-h-11 items-center justify-center gap-2 rounded-lg bg-foreground px-4 text-sm font-bold text-background opacity-40"
          >
            <Printer className="size-4" strokeWidth={1.75} aria-hidden />
            Print labels
          </button>
        </div>
      </section>
    );
  }

  const due = bags.filter((b) => {
    const st = state(b);
    return !st.printedAt || st.outdated;
  });
  const reprint = due.length === 0;
  const targets = reprint ? bags : due;
  // Every bag of the order: each label also names the order's other bags and their card counts
  const v = shortHash(bags.map(bagVersion).join("~"));
  const url = `/api/admin/intake/labels/order/${orderId}?bags=${targets.map((b) => b.id).join(",")}&v=${v}`;
  const n = targets.length;
  const lastPrint = reprint
    ? bags.map((b) => state(b).printedAt).filter((s): s is string => !!s).sort((a, b) => Date.parse(b) - Date.parse(a))[0]
    : undefined;
  // Bag IDs never break at their hyphens ("CD-" / "2549-G")
  const codes = targets.map((b, i) => (
    <span key={b.id}>
      {i > 0 && ", "}
      <span className="whitespace-nowrap">{b.code}</span>
      {state(b).outdated ? " (out of date)" : ""}
    </span>
  ));

  return (
    <section
      aria-labelledby="print-step-h"
      className={`mt-4 rounded-xl bg-white p-4 sm:p-5 ${reprint ? "border border-border" : "border-2 border-primary/40"}`}
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0" aria-live="polite">
          <h3 id="print-step-h" className="font-heading font-black text-base text-foreground">
            {reprint ? (n === 1 ? "Label printed" : "Labels printed") : `Ready to print: ${n} label${n === 1 ? "" : "s"} (one per tier)`}
          </h3>
          <p className="mt-0.5 text-sm text-muted-foreground">
            {reprint
              ? `${n === 1 ? "The bag has" : "Every bag has"} its label${lastPrint ? ` (last printed ${printedWhen(lastPrint)})` : ""}. ${n === 1 ? "Reprint it if it got" : "Reprint them if one got"} lost or damaged.`
              : <>Every card has its photo. {n === 1 ? "Bag" : "Bags"}: {codes}.</>}
          </p>
        </div>
        <LabelPrintButton
          pdfUrl={url}
          fileName={`${orderNumber || "order"}-labels.pdf`}
          bagIds={targets.map((b) => b.id)}
          paper={paper}
          variant={reprint ? "secondary" : "primary"}
          onPrinted={onPrinted(targets)}
        >
          {reprint ? (n === 1 ? "Reprint label" : "Reprint all") : n === 1 ? "Print label" : `Print ${n} labels`}
        </LabelPrintButton>
      </div>
    </section>
  );
}
