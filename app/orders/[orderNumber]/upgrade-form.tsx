"use client";

import { useState } from "react";
import { formatCents } from "@/lib/restoration-tiers";
import { formatCurrency } from "@/lib/utils";
import type { RestorationTier, RestorationTierId } from "@/lib/restoration-tiers";
import { Zap } from "lucide-react";
import { cta } from "@/components/brand";

/** A higher tier the order can move to, with the admin's name and price, and its fee as the upgrade route charges it. */
export type UpgradeOffer = { tier: RestorationTier; totalCents: number; chargeCents: number; bulkPercent: number };

interface Props {
  orderNumber: string;
  customerEmail: string;
  /** Priced in upgrade-section.tsx (lib/upgrade-pricing.ts) */
  offers: UpgradeOffer[];
}

export function UpgradeForm({ orderNumber, customerEmail, offers }: Props) {
  const [loading, setLoading] = useState<RestorationTierId | null>(null);
  const [error, setError] = useState("");

  async function handleUpgrade(tierId: RestorationTierId) {
    setLoading(tierId);
    setError("");
    try {
      const res = await fetch(`/api/orders/${orderNumber}/upgrade`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: customerEmail, new_tier: tierId }),
      });
      const data = await res.json();
      if (data.url) {
        window.location.assign(data.url);
      } else {
        setError(data.error ?? "Something went wrong. Please try again.");
        setLoading(null);
      }
    } catch {
      setError("Network error. Please try again.");
      setLoading(null);
    }
  }

  return (
    <div className="surface-cobalt relative isolate overflow-hidden rounded-[22px] p-5 sm:p-7">
      <span aria-hidden className="halftone-dots -top-[20%] -right-[10%] h-[140%] w-[60%]" />
      <p className="eyebrow mb-3 inline-flex items-center gap-2 text-sun"><Zap aria-hidden className="size-4 fill-current" strokeWidth={1.5} />Want Faster Service?</p>
      <h2 className="mb-2 font-heading text-[2rem] leading-[0.95] font-black text-white md:text-[2.5rem]">Upgrade Your Restoration</h2>
      <p className="mb-6 max-w-[52ch] text-[15px] text-[#e6ebff]">
        You can upgrade to a higher service level until your cards arrive. You only pay the difference.
      </p>

      <div className="flex flex-col gap-3">
        {offers.map(({ tier, totalCents: total, bulkPercent }) => (
            <div key={tier.id} className="flex flex-wrap items-center justify-between gap-4 rounded-[16px] bg-white p-4 text-ink sm:flex-nowrap">
              <div className="min-w-0 flex-1">
                <p className="font-heading text-[1.4rem] leading-none font-extrabold">{tier.name}</p>
                <p className="mt-1 text-xs text-ink-soft">
                  {tier.turnaround_min_days}–{tier.turnaround_max_days} business days · {formatCents(tier.price_cents)}/card
                </p>
                <p className="mt-1 text-sm font-bold text-cobalt-deep">
                  +{formatCurrency(total)} upgrade fee <span className="text-xs font-normal text-ink-soft">(incl. tax{bulkPercent > 0 ? `, ${bulkPercent}% bulk discount` : ""})</span>
                </p>
              </div>
              <button
                onClick={() => handleUpgrade(tier.id)}
                disabled={loading !== null}
                className={cta({ tone: "sun", size: "sm", className: "w-full shrink-0 sm:w-auto" })}
              >
                {loading === tier.id ? "Redirecting..." : "Upgrade"}
              </button>
            </div>
        ))}
      </div>

      {error && <p className="mt-3 rounded-[12px] bg-white px-3 py-2 text-sm font-semibold text-destructive">{error}</p>}
    </div>
  );
}
