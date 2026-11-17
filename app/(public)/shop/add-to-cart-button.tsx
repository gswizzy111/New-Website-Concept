"use client";

import { Check, Plus } from "lucide-react";
import { useCart } from "@/lib/cart-context";
import { useState } from "react";
import { cta } from "@/components/brand";

interface Props {
  product: {
    id: string;
    name: string;
    price_cents: number;
    slug: string;
    image?: string;
  };
}

export function AddToCartButton({ product }: Props) {
  const { addItem } = useCart();
  const [added, setAdded] = useState(false);

  function handleAdd() {
    addItem(product);
    setAdded(true);
    setTimeout(() => setAdded(false), 1500);
  }

  return (
    <button
      onClick={handleAdd}
      aria-label={added ? undefined : `Add ${product.name} to cart`}
      className={cta({
        tone: added ? "cobalt" : "sun",
        size: "sm",
        className: "w-full gap-1.5 px-4 sm:w-auto sm:min-w-24",
      })}
    >
      {added ? <Check aria-hidden className="size-4" strokeWidth={2.5} /> : <Plus aria-hidden className="size-4" strokeWidth={2.5} />}
      <span aria-live="polite">{added ? "Added!" : "Add"}</span>
    </button>
  );
}
