"use client";

import { useCart } from "@/lib/cart-context";
import { useState } from "react";

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
      className={`h-8 rounded-md text-xs font-semibold px-3.5 transition-colors ${
        added
          ? "bg-rx-soft text-rx"
          : "bg-ink text-paper hover:bg-rx"
      }`}
    >
      {added ? "Added!" : "Add"}
    </button>
  );
}
