"use client";

import { useState } from "react";
import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { cta } from "@/components/brand";
import { cn } from "@/lib/utils";
import { CLOSED_ACTION, FACT_ROW } from "./fact-row";
import { ValueNote } from "./value-note";

const RATE = 0.07;
const MIN_VALUE = 5000;

/** The closed / sold-out plate, recoloured for the ink card. */
const CLOSED_DARK = "bg-white/10 text-on-dark-muted shadow-[inset_0_0_0_1.5px_var(--line-dark)] [background-image:repeating-linear-gradient(135deg,transparent_0_7px,rgba(255,255,255,0.05)_7px_10px)]";

/**
 * Diamond: the one tier priced from the card's value, so it carries its own
 * calculator. Printed on ink (the dark card in the grid) with its price in sun.
 */
export function DiamondCard({
  slotsLeft,
  isSoldOut,
  restorationsOpen,
}: {
  slotsLeft: number | null;
  isSoldOut: boolean;
  restorationsOpen: boolean;
}) {
  const [rawValue, setRawValue] = useState("");

  const numericValue = parseFloat(rawValue.replace(/[^0-9.]/g, "")) || 0;
  const priceDollars = numericValue >= MIN_VALUE ? (numericValue * RATE).toFixed(2) : null;
  const tooLow = rawValue !== "" && numericValue > 0 && numericValue < MIN_VALUE;

  const bannerLabel = isSoldOut ? "SOLD OUT" : "White Glove";
  const showSlots = !isSoldOut && slotsLeft !== null && restorationsOpen;
  const closed = isSoldOut || !restorationsOpen;

  return (
    <article id="tier-elite" className="lift surface-ink relative isolate flex h-full scroll-mt-[calc(var(--header-h)+5.5rem)] flex-col overflow-hidden rounded-2xl shadow-[0_30px_60px_-30px_rgba(13,18,51,0.75)]">
      <span aria-hidden className="metal metal-diamond absolute inset-x-0 top-0 h-1.5" />
      <div className="flex flex-1 flex-col p-6 md:p-7">
        <div className="flex min-h-9 items-center justify-between gap-3">
          <span
            aria-hidden
            className={cn(
              "metal metal-diamond block h-9 w-[26px] -rotate-6 rounded-[5px] shadow-[0_0_0_2px_var(--ink),0_0_0_3.5px_rgba(255,255,255,0.35)]",
              closed && "grayscale"
            )}
          />
          <span
            className={cn(
              "inline-flex min-h-8 items-center rounded-full px-3.5 text-[13px] font-extrabold uppercase tracking-[0.06em]",
              isSoldOut ? "bg-white/15 text-white" : "bg-sun text-ink"
            )}
          >
            {bannerLabel}
          </span>
        </div>

        <h3 className="caps mt-5 font-display text-[40px] font-black leading-[0.9] text-white">Diamond</h3>
        <p className="mt-2 mb-6 min-h-12 text-[15px] leading-snug text-on-dark-muted">White-glove service for high-value cards</p>

        {/* Dynamic price display */}
        <div className="mb-6">
          <div className="font-display text-[72px] font-black leading-[0.82] tracking-[-0.01em] text-sun tabular-nums lining-nums">
            {priceDollars ? `$${priceDollars}` : "7%"}
          </div>
          <p className="label-caps mt-3 text-[13px] text-on-dark-muted">
            {priceDollars
              ? `of your $${numericValue.toLocaleString()} card value`
              : "of declared card value · cards $5,000+"}
          </p>
        </div>

        <div className="@container">
          <dl className="divide-y divide-line-dark border-t-2 border-white">
            <div className={FACT_ROW}>
              <dt className="label-caps text-[14px] text-on-dark-muted @min-[16.5rem]:self-center">Turnaround</dt>
              <dd className="font-bold text-white @min-[16.5rem]:text-right">
                5–10 business days <span className="text-xs font-medium text-on-dark-muted">(est.)</span>
              </dd>
            </div>
            <div className={`${FACT_ROW} @min-[16.5rem]:items-center`}>
              <dt className="label-caps text-[14px] text-on-dark-muted">Card value</dt>
              <dd className="flex flex-wrap items-center gap-x-1 font-bold text-white">
                $5,000+
                <ValueNote dark />
              </dd>
            </div>
            {showSlots && (
              <div className={FACT_ROW}>
                <dt className="label-caps text-[14px] text-on-dark-muted @min-[16.5rem]:self-center">Slots</dt>
                <dd className={cn("tabular-nums @min-[16.5rem]:text-right", slotsLeft! <= 3 ? "font-extrabold text-sun" : "font-bold text-white")}>
                  {slotsLeft} left
                </dd>
              </div>
            )}
          </dl>

          {/* The value field: a small calculator on the card */}
          <div className="border-t border-line-dark pt-4 pb-1">
            <div className="flex flex-col gap-2 @min-[16.5rem]:flex-row @min-[16.5rem]:items-center @min-[16.5rem]:gap-3">
              <label
                htmlFor="diamond-card-value"
                className="label-caps text-[14px] leading-tight text-on-dark-muted @min-[16.5rem]:min-w-0 @min-[16.5rem]:flex-1"
              >
                Estimated card value (USD)
              </label>
              <div className="relative shrink-0 @min-[16.5rem]:w-[9rem]">
                <span className="absolute top-1/2 left-3.5 -translate-y-1/2 text-sm font-bold text-ink-soft">$</span>
                <input
                  id="diamond-card-value"
                  type="number"
                  inputMode="decimal"
                  placeholder="e.g. 6000"
                  value={rawValue}
                  onChange={(e) => setRawValue(e.target.value)}
                  className="h-11 w-full rounded-[12px] border-[1.5px] border-transparent bg-white pr-3 pl-7 text-base text-ink tabular-nums outline-none [appearance:textfield] placeholder:text-ink-soft focus-visible:border-sun focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sun md:text-[15px] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
                />
              </div>
            </div>
            {tooLow && (
              <p className="mt-3 rounded-lg bg-sun-tint px-3 py-2 text-xs font-bold leading-snug text-ink">
                Diamond requires cards valued at $5,000+. Consider Fast Pass for cards under $5,000.
              </p>
            )}
            {priceDollars && (
              <p className="mt-3 flex flex-wrap items-baseline gap-x-1.5 rounded-lg bg-white/10 px-3 py-2 text-xs font-bold text-white">
                Your price: <span className="font-display text-xl font-black leading-none tabular-nums text-sun">${priceDollars}</span> per card
              </p>
            )}
          </div>
        </div>

        <div className="mt-auto pt-7">
          {isSoldOut ? (
            <div className={cn(CLOSED_ACTION, CLOSED_DARK)}>Sold Out</div>
          ) : !restorationsOpen ? (
            <div className={cn(CLOSED_ACTION, CLOSED_DARK)}>Currently Closed</div>
          ) : (
            <Link href="/restoration?tier=elite" className={cta({ size: "lg", className: "w-full" })}>
              Select Diamond
              <ArrowRight aria-hidden className="size-5" strokeWidth={2} />
            </Link>
          )}
        </div>
      </div>
    </article>
  );
}
