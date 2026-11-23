"use client";

import { useState } from "react";
import { Camera, Printer } from "lucide-react";
import type { BagSummary } from "@/lib/intake/types";
import { LabelPrintButton } from "./label-print-button";
import { bagVersion, shortHash } from "./bag-label-panel";

/**
 * The receiving workspace's "Print labels" step: once every received card in
 * the order has a receiving photo, one button prints the labels of every bag
 * still missing one (or whose label went out of date). Until then it says how
 * many cards still need a photo and jumps to the first. When every bag is
 * printed it offers a reprint of them all. Previews, single bags and tags stay
 * in the Bag labels panel below.
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
  // Bags printed from this button since the page loaded
  const [printedNow, setPrintedNow] = useState<string[]>([]);
  if (bags.length === 0) return null;

  if (needPhoto.length > 0) {
    const first = needPhoto[0];
    return (
      <section aria-labelledby="print-step-h" className="mt-4 rounded-xl border border-dashed border-border bg-white p-4 sm:p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="min-w-0">
            <h3 id="print-step-h" className="font-heading font-black text-base text-foreground">Print labels</h3>
            <p className="mt-0.5 text-sm text-muted-foreground">
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
            className="inline-flex min-h-11 items-center justify-center gap-2 rounded-lg bg-foreground px-4 text-sm font-bold text-background opacity-40"
          >
            <Printer className="size-4" strokeWidth={1.75} aria-hidden />
            Print labels
          </button>
        </div>
      </section>
    );
  }

  const due = bags.filter((b) => !printedNow.includes(b.id) && (!b.labelPrintedAt || b.labelOutdated));
  const reprint = due.length === 0;
  const targets = reprint ? bags : due;
  const v = shortHash(targets.map(bagVersion).join("~"));
  const url = `/api/admin/intake/labels/order/${orderId}?bags=${targets.map((b) => b.id).join(",")}&v=${v}`;
  const codes = targets.map((b) => b.code).join(", ");

  return (
    <section
      aria-labelledby="print-step-h"
      className={`mt-4 rounded-xl bg-white p-4 sm:p-5 ${reprint ? "border border-border" : "border-2 border-primary/40"}`}
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <h3 id="print-step-h" className="font-heading font-black text-base text-foreground">
            {reprint ? "Labels printed" : "Ready to print"}
          </h3>
          <p className="mt-0.5 text-sm text-muted-foreground">
            {reprint
              ? "Every bag has its label. Reprint them if one got lost or damaged."
              : `Every card has its photo. ${targets.length === 1 ? "Bag" : `${targets.length} bags`}: ${codes}.`}
          </p>
        </div>
        <LabelPrintButton
          pdfUrl={url}
          fileName={`${orderNumber || "order"}-labels.pdf`}
          bagIds={targets.map((b) => b.id)}
          paper={paper}
          variant={reprint ? "secondary" : "primary"}
          onPrinted={() => setPrintedNow((p) => [...new Set([...p, ...targets.map((b) => b.id)])])}
        >
          {reprint ? "Reprint labels" : "Print labels"}
        </LabelPrintButton>
      </div>
    </section>
  );
}
