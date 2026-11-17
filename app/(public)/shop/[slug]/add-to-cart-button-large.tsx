"use client";

import { useCart } from "@/lib/cart-context";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Check, ShoppingCart, Zap } from "lucide-react";
import { cta } from "@/components/brand";
import { cn } from "@/lib/utils";

const SIZES = ["Small", "Medium", "Large", "XL"] as const;

interface Props {
  product: {
    id: string;
    name: string;
    price_cents: number;
    slug: string;
    image?: string;
  };
  requiresSize?: boolean;
}

export function AddToCartButtonLarge({ product, requiresSize }: Props) {
  const { addItem } = useCart();
  const [added, setAdded] = useState(false);
  const [size, setSize] = useState<string | null>(null);
  const router = useRouter();

  function buildItem() {
    return {
      ...product,
      id: requiresSize && size ? `${product.id}-${size}` : product.id,
      size: requiresSize && size ? size : undefined,
    };
  }

  function handleAdd() {
    if (requiresSize && !size) return;
    addItem(buildItem());
    setAdded(true);
    setTimeout(() => setAdded(false), 2000);
  }

  function handleBuyNow() {
    if (requiresSize && !size) return;
    addItem(buildItem());
    router.push("/cart/checkout");
  }

  return (
    <div className="flex flex-col gap-4">
      {requiresSize && (
        <fieldset className="flex flex-col">
          <legend className="label-caps mb-3 text-[15px] text-ink">Select Size</legend>
          <div className="grid grid-cols-4 gap-2.5">
            {SIZES.map((s) => (
              <button
                key={s}
                onClick={() => setSize(s)}
                aria-pressed={size === s}
                className={cn(
                  "min-h-12 rounded-[14px] px-1 text-[15px] font-bold transition-[background-color,box-shadow,color] duration-150 focus-visible:outline-3 focus-visible:outline-offset-3 focus-visible:outline-cobalt",
                  size === s
                    ? "bg-ink text-white shadow-[inset_0_0_0_2px_var(--ink)]"
                    : "bg-white text-ink shadow-[inset_0_0_0_1.5px_var(--line-strong)] hover:shadow-[inset_0_0_0_1.5px_var(--ink-soft)]"
                )}
              >
                {s}
              </button>
            ))}
          </div>
          {!size && (
            <p className="mt-2.5 text-sm text-ink-soft">Please select a size before adding to cart.</p>
          )}
        </fieldset>
      )}

      <button
        onClick={handleBuyNow}
        disabled={requiresSize && !size}
        className={cta({ tone: "sun", size: "lg", className: "w-full" })}
      >
        <Zap aria-hidden className="size-5 fill-current" strokeWidth={1.75} />
        Buy It Now
      </button>
      <button
        onClick={handleAdd}
        disabled={requiresSize && !size}
        className={cta({ tone: added ? "cobalt" : "outline", size: "lg", className: "w-full" })}
      >
        {added ? <Check aria-hidden className="size-5" strokeWidth={2.25} /> : <ShoppingCart aria-hidden className="size-5" strokeWidth={1.75} />}
        <span aria-live="polite">{added ? "Added to Cart!" : "Add to Cart"}</span>
      </button>
    </div>
  );
}
