"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { cta } from "@/components/brand";

type ProductType = "kit" | "polish" | "spray";

const PRODUCTS: { type: ProductType; label: string }[] = [
  { type: "kit",    label: "Restoration Kit" },
  { type: "polish", label: "Card Polish" },
  { type: "spray",  label: "Card Spray" },
];

type Props = {
  remainingKits: number;
  remainingPolish: number;
  remainingSpray: number;
};

export function LogSaleButton({ remainingKits, remainingPolish, remainingSpray }: Props) {
  const [open, setOpen] = useState(false);
  const [productType, setProductType] = useState<ProductType>("kit");
  const [quantity, setQuantity] = useState(1);
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const router = useRouter();

  const remaining = productType === "kit" ? remainingKits : productType === "polish" ? remainingPolish : remainingSpray;
  const anyAvailable = remainingKits > 0 || remainingPolish > 0 || remainingSpray > 0;

  async function submit() {
    setSaving(true);
    setError("");
    try {
      const res = await fetch("/api/partners/kit-sales", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ quantity, notes, product_type: productType }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setOpen(false);
      setQuantity(1);
      setNotes("");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed");
    } finally {
      setSaving(false);
    }
  }

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        disabled={!anyAvailable}
        className={cta({ tone: "sun", size: "lg", className: "w-full" })}
      >
        Log a Sale
      </button>
    );
  }

  return (
    <div className="col-span-2 flex flex-col gap-3 rounded-[22px] bg-white p-5 shadow-[0_0_0_1px_var(--line),var(--panel-shadow)]">
      <p className="font-heading text-[1.5rem] leading-none font-extrabold text-ink">Log a Sale</p>

      {/* Product selector */}
      <div className="flex gap-2">
        {PRODUCTS.map((p) => {
          const rem = p.type === "kit" ? remainingKits : p.type === "polish" ? remainingPolish : remainingSpray;
          return (
            <button
              key={p.type}
              onClick={() => { setProductType(p.type); setQuantity(1); }}
              disabled={rem <= 0}
              aria-pressed={productType === p.type}
              className={`min-h-14 flex-1 rounded-[14px] px-2 py-2 text-xs font-bold transition-[background-color,box-shadow] disabled:opacity-40 ${
                productType === p.type
                  ? "bg-cobalt-wash text-ink shadow-[inset_0_0_0_2px_var(--cobalt)]"
                  : "bg-white text-ink shadow-[inset_0_0_0_1.5px_var(--line-strong)] hover:shadow-[inset_0_0_0_1.5px_var(--ink-soft)]"
              }`}
            >
              {p.label}
              <span className="block text-xs font-normal">{rem} left</span>
            </button>
          );
        })}
      </div>

      {/* Quantity */}
      <div className="flex items-center gap-3">
        <label htmlFor="sale-qty" className="shrink-0 text-sm font-semibold text-ink">Qty sold</label>
        <input
          id="sale-qty"
          type="number"
          min={1}
          max={remaining}
          value={quantity}
          onChange={(e) => setQuantity(Math.max(1, Math.min(remaining, parseInt(e.target.value) || 1)))}
          className="w-20 text-center h-11 min-w-0 rounded-[12px] border-[1.5px] border-input bg-white px-3.5 text-base outline-none transition-[border-color] placeholder:text-muted-foreground hover:border-ink-soft focus-visible:border-cobalt focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-cobalt md:text-[15px]"
        />
        <span className="text-xs text-ink-soft">of {remaining} remaining</span>
      </div>

      <input
        type="text"
        value={notes}
        onChange={(e) => setNotes(e.target.value)}
        placeholder="Notes (optional)"
        className="w-full h-11 min-w-0 rounded-[12px] border-[1.5px] border-input bg-white px-3.5 text-base outline-none transition-[border-color] placeholder:text-muted-foreground hover:border-ink-soft focus-visible:border-cobalt focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-cobalt md:text-[15px]"
      />

      {error && <p className="text-xs text-destructive">{error}</p>}

      <div className="flex gap-2">
        <button
          onClick={submit}
          disabled={saving || remaining <= 0}
          className={cta({ tone: "sun", size: "sm" })}
        >
          {saving ? "Saving..." : "Confirm Sale"}
        </button>
        <button onClick={() => setOpen(false)} className="min-h-11 rounded-full px-4 text-sm font-bold text-ink-soft hover:bg-chalk hover:text-ink">
          Cancel
        </button>
      </div>
    </div>
  );
}
