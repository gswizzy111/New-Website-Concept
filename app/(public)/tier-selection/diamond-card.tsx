"use client";

import { useState } from "react";
import Link from "next/link";
import { Gem } from "lucide-react";
import { FACT_ROW } from "./fact-row";

const RATE = 0.07;
const MIN_VALUE = 5000;

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

  // Same structure as the other tiers: the badge in the corner, slots in the facts
  const bannerLabel = isSoldOut ? "SOLD OUT" : "White Glove";
  const bannerCls = isSoldOut ? "bg-secondary text-muted-foreground" : "bg-rx-soft text-rx";
  const showSlots = !isSoldOut && slotsLeft !== null && restorationsOpen;

  return (
    <div className={`lift spotlight holo-ring relative h-full rounded-xl border border-transparent bg-card flex flex-col shadow-[0_24px_50px_-34px_oklch(0.25_0.006_70/0.55)] ${(isSoldOut || !restorationsOpen) ? "opacity-70" : ""}`}>
      {/* Foil wash: Diamond is the one tier printed on holo stock */}
      <div aria-hidden className="holo-bands pointer-events-none absolute inset-x-0 top-0 h-28 rounded-t-xl opacity-[0.16] [background-position:30%_40%] [mask-image:linear-gradient(to_bottom,#000,transparent)]" />
      <div className="relative flex h-12 items-end justify-between gap-3 px-6">
        <span className="metal metal-diamond mb-[5px] h-3.5 w-11 rounded-[3px]" aria-hidden />
        <span className={`whitespace-nowrap font-mono text-[11px] leading-4 uppercase tracking-wide rounded-full px-2.5 py-1 ${bannerCls}`}>
          {bannerLabel}
        </span>
      </div>

      <div className="relative p-6 pt-4 flex flex-col flex-1">
        <div className="flex items-start gap-3 mb-5">
          <Gem className="w-5 h-5 flex-shrink-0 mt-1.5 text-muted-foreground" strokeWidth={1.75} />
          <div>
            <h3 className="font-heading text-[1.75rem] font-extrabold tracking-[-0.01em] text-ink leading-tight">Diamond</h3>
            <p className="text-sm text-muted-foreground mt-0.5 min-h-10">White-glove service for high-value cards</p>
          </div>
        </div>

        {/* Dynamic price display */}
        <div className="mb-6">
          <div className="font-heading text-5xl font-extrabold tracking-[-0.02em] text-ink tabular-nums">
            {priceDollars ? `$${priceDollars}` : "7%"}
          </div>
          <p className="font-mono text-xs text-muted-foreground mt-1">
            {priceDollars
              ? `of your $${numericValue.toLocaleString()} card value`
              : "of declared card value · cards $5,000+"}
          </p>
        </div>

        {/* Facts, then the value field as one more row of them */}
        <div className="@container">
          <dl className="divide-y divide-rule border-t border-rule">
            <div className={FACT_ROW}>
              <dt className="rx-label @min-[16.5rem]:self-center">Turnaround</dt>
              <dd className="font-medium text-ink @min-[16.5rem]:text-right">5–10 business days <span className="text-xs text-muted-foreground">(est.)</span></dd>
            </div>
            <div className={`${FACT_ROW} @min-[16.5rem]:items-center`}>
              <dt className="rx-label">Card value</dt>
              <dd className="font-medium text-ink flex items-center gap-1">
                $5,000+
                <span className="relative group">
                  <span className="text-xs text-muted-foreground cursor-help">*</span>
                  <span className="pointer-events-none absolute bottom-full right-0 mb-1.5 w-max max-w-[180px] rounded-md bg-ink px-2.5 py-1.5 text-xs text-paper opacity-0 group-hover:opacity-100 transition-opacity z-20 leading-snug">
                    Current value, raw or graded
                  </span>
                </span>
              </dd>
            </div>
            {showSlots && (
              <div className={FACT_ROW}>
                <dt className="rx-label @min-[16.5rem]:self-center">Slots</dt>
                <dd className={`tabular-nums @min-[16.5rem]:text-right ${slotsLeft! <= 3 ? "font-semibold text-red-700" : "font-medium text-ink"}`}>
                  {slotsLeft} left
                </dd>
              </div>
            )}
          </dl>

          <div className="border-t border-rule py-2.5">
            <div className="flex flex-col gap-1.5 @min-[16.5rem]:flex-row @min-[16.5rem]:items-center @min-[16.5rem]:gap-3">
              <label htmlFor="diamond-card-value" className="rx-label @min-[16.5rem]:min-w-0 @min-[16.5rem]:flex-1">
                Estimated card value (USD)
              </label>
              <div className="relative shrink-0 @min-[16.5rem]:w-[8rem]">
                <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-sm font-semibold text-muted-foreground">$</span>
                <input
                  id="diamond-card-value"
                  type="number"
                  inputMode="decimal"
                  placeholder="e.g. 6000"
                  value={rawValue}
                  onChange={(e) => setRawValue(e.target.value)}
                  className="w-full h-10 pl-6 pr-2.5 rounded-md border border-input bg-white text-base md:text-sm tabular-nums [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none placeholder:text-muted-foreground focus:outline-none focus:border-rx focus:ring-2 focus:ring-rx/20"
                />
              </div>
            </div>
            {tooLow && (
              <p className="text-xs text-amber-800 font-semibold mt-2">
                Diamond requires cards valued at $5,000+. Consider Fast Pass for cards under $5,000.
              </p>
            )}
            {priceDollars && (
              <p className="text-xs text-rx font-semibold mt-2">
                Your price: <span className="text-lg font-bold">${priceDollars}</span> per card
              </p>
            )}
          </div>
        </div>

        {/* The action sits on the card's floor, level with the other tiers */}
        <div className="mt-auto pt-6">
        {isSoldOut ? (
          <div className="w-full h-12 flex items-center justify-center rounded-md font-semibold text-[15px] bg-secondary text-muted-foreground cursor-not-allowed">
            Sold Out
          </div>
        ) : !restorationsOpen ? (
          <div className="w-full h-12 flex items-center justify-center rounded-md font-semibold text-[15px] bg-secondary text-muted-foreground cursor-not-allowed">
            Currently Closed
          </div>
        ) : (
          <Link
            href="/restoration?tier=elite"
            className="btn-depth btn-sheen w-full h-12 flex items-center justify-center rounded-md font-semibold text-[15px] bg-rx text-primary-foreground hover:bg-rx/90 transition-colors duration-150"
          >
            Select Diamond
          </Link>
        )}
        </div>
      </div>
    </div>
  );
}
