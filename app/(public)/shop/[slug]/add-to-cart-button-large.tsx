"use client";

import { useCart } from "@/lib/cart-context";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { ShoppingCart, Zap } from "lucide-react";

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
    <div className="flex flex-col gap-3">
      {requiresSize && (
        <div className="flex flex-col gap-2">
          <p className="text-sm font-semibold text-foreground">Select Size</p>
          <div className="flex gap-2">
            {SIZES.map((s) => (
              <button
                key={s}
                onClick={() => setSize(s)}
                className={`flex-1 h-10 border text-sm font-semibold rounded-md transition-all duration-150 active:scale-[0.97] ${
                  size === s
                    ? "border-ink bg-ink text-paper"
                    : "border-rule text-ink hover:border-ink/50"
                }`}
              >
                {s}
              </button>
            ))}
          </div>
          {!size && (
            <p className="text-xs text-muted-foreground">Please select a size before adding to cart.</p>
          )}
        </div>
      )}

      <button
        onClick={handleBuyNow}
        disabled={requiresSize && !size}
        className="w-full flex items-center justify-center gap-2 h-13 font-semibold text-[15px] bg-rx text-primary-foreground hover:bg-rx/90 active:scale-[0.98] transition-all duration-150 rounded-md disabled:opacity-40 disabled:cursor-not-allowed"
      >
        <Zap className="h-4 w-4 fill-current" />
        Buy It Now
      </button>
      <button
        onClick={handleAdd}
        disabled={requiresSize && !size}
        className={`w-full flex items-center justify-center gap-2 h-13 font-semibold text-[15px] border transition-all duration-150 rounded-md active:scale-[0.98] disabled:opacity-40 disabled:cursor-not-allowed ${
          added
            ? "bg-rx-soft text-rx border-rx/30"
            : "bg-white text-ink border-ink/70 hover:border-ink hover:bg-secondary"
        }`}
      >
        <ShoppingCart className="h-4 w-4" />
        {added ? "Added to Cart!" : "Add to Cart"}
      </button>
    </div>
  );
}
