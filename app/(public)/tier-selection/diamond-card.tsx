"use client";

import { useState } from "react";
import Link from "next/link";
import { Gem } from "lucide-react";

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

  const bannerLabel = isSoldOut
    ? "SOLD OUT"
    : slotsLeft !== null && restorationsOpen
    ? `${slotsLeft} slot${slotsLeft !== 1 ? "s" : ""} left`
    : "White Glove";

  const bannerCls = isSoldOut
    ? "bg-secondary text-muted-foreground"
    : slotsLeft !== null
    ? slotsLeft <= 3 ? "bg-red-50 text-red-700 ring-1 ring-red-200" : "bg-rx-soft text-rx"
    : "bg-rx-soft text-rx";

  return (
    <div className={`relative rounded-lg border border-ink/70 bg-card overflow-hidden flex flex-col transition-shadow duration-200 hover:shadow-[0_16px_32px_-20px_oklch(0.3_0.04_165/0.35)] ${(isSoldOut || !restorationsOpen) ? "opacity-70" : ""}`}>
      <div className="flex items-center justify-between gap-3 px-6 pt-5">
        <span className="h-3 w-8 rounded-sm bg-[#cfdde4] ring-1 ring-rule" aria-hidden />
        <span className={`font-mono text-[11px] uppercase tracking-wide rounded-full px-2.5 py-0.5 ${bannerCls}`}>
          {bannerLabel}
        </span>
      </div>

      <div className="p-6 pt-4 flex flex-col flex-1">
        <div className="flex items-start gap-3 mb-5">
          <Gem className="w-5 h-5 flex-shrink-0 mt-1.5 text-muted-foreground" strokeWidth={1.75} />
          <div>
            <h3 className="font-heading text-2xl font-bold text-ink leading-tight">Diamond</h3>
            <p className="text-sm text-muted-foreground mt-0.5">White-glove service for high-value cards</p>
          </div>
        </div>

        {/* Dynamic price display */}
        <div className="mb-4">
          <div className="font-heading text-4xl font-bold tracking-tight text-ink tabular-nums">
            {priceDollars ? `$${priceDollars}` : "7%"}
          </div>
          <p className="font-mono text-xs text-muted-foreground mt-1">
            {priceDollars
              ? `of your $${numericValue.toLocaleString()} card value`
              : "of declared card value · cards $5,000+"}
          </p>
        </div>

        {/* Value input */}
        <div className="mb-5">
          <label htmlFor="diamond-card-value" className="block rx-label mb-1.5">
            Estimated card value (USD)
          </label>
          <div className="relative">
            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm font-semibold text-muted-foreground">$</span>
            <input
              id="diamond-card-value"
              type="number"
              inputMode="decimal"
              placeholder="e.g. 6000"
              value={rawValue}
              onChange={(e) => setRawValue(e.target.value)}
              className="w-full h-11 pl-7 pr-3 rounded-md border border-input bg-white text-base md:text-sm tabular-nums placeholder:text-muted-foreground focus:outline-none focus:border-rx focus:ring-2 focus:ring-rx/20"
            />
          </div>
          {tooLow && (
            <p className="text-xs text-amber-800 font-semibold mt-1.5">
              Diamond requires cards valued at $5,000+. Consider Fast Pass for cards under $5,000.
            </p>
          )}
          {priceDollars && (
            <p className="text-xs text-rx font-semibold mt-1.5">
              Your price: <span className="text-lg font-bold tabular-nums">${priceDollars}</span> per card
            </p>
          )}
        </div>

        {/* Features */}
        <dl className="divide-y divide-rule border-t border-rule">
          <div className="flex justify-between gap-4 py-2.5 text-sm">
            <dt className="rx-label self-center">Turnaround</dt>
            <dd className="font-medium text-ink text-right">5–10 business days <span className="text-xs text-muted-foreground">(est.)</span></dd>
          </div>
          <div className="flex justify-between gap-4 py-2.5 text-sm items-center">
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
        </dl>

        <div className="mt-auto pt-5">
        {isSoldOut ? (
          <div className="w-full h-11 flex items-center justify-center rounded-md font-semibold text-sm bg-secondary text-muted-foreground cursor-not-allowed">
            Sold Out
          </div>
        ) : !restorationsOpen ? (
          <div className="w-full h-11 flex items-center justify-center rounded-md font-semibold text-sm bg-secondary text-muted-foreground cursor-not-allowed">
            Currently Closed
          </div>
        ) : (
          <Link
            href="/restoration?tier=elite"
            className="w-full h-11 flex items-center justify-center rounded-md font-semibold text-sm bg-rx text-primary-foreground hover:bg-rx/90 transition-colors duration-150"
          >
            Select Diamond
          </Link>
        )}

        </div>
      </div>
    </div>
  );
}
