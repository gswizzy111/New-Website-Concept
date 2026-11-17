"use client";

import { useEffect, useState, Suspense } from "react";
import { useCart } from "@/lib/cart-context";
import { formatCurrency } from "@/lib/utils";
import { useRouter, useSearchParams } from "next/navigation";
import { ArrowLeft, ArrowRight, Check, Package, Plus } from "lucide-react";
import { cta } from "@/components/brand";
import { BLOCK_TITLE, FORM_PANEL, SUM_ROW, SUM_TOTAL } from "@/components/checkout/form-styles";
import { cn } from "@/lib/utils";

const SIZES = ["Small", "Medium", "Large", "XL"] as const;

type UpsellProduct = {
  id: string;
  name: string;
  slug: string;
  description: string;
  price_cents: number;
  images: string[];
  inventory_count: number;
};

function UpsellInner() {
  const { items, totalCents, addItem } = useCart();
  const router = useRouter();
  const searchParams = useSearchParams();
  const isInternational = searchParams.get("international") === "true";
  const destination = isInternational ? "/cart/checkout?international=true" : "/cart/checkout";

  const [products, setProducts] = useState<UpsellProduct[]>([]);
  const [loading, setLoading] = useState(true);
  const [added, setAdded] = useState<Record<string, boolean>>({});
  const [sizes, setSizes] = useState<Record<string, string>>({});

  useEffect(() => {
    fetch("/api/shop/upsell-products")
      .then((r) => r.json())
      .then((d) => {
        setProducts(d.products ?? []);
        setLoading(false);
        if (!d.products?.length) router.replace(destination);
      })
      .catch(() => {
        setLoading(false);
        router.replace(destination);
      });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function handleAdd(product: UpsellProduct) {
    const isGlove = product.name.toLowerCase().includes("glove");
    const size = sizes[product.id];
    if (isGlove && !size) return;
    addItem({
      id: isGlove && size ? `${product.id}-${size}` : product.id,
      name: product.name,
      slug: product.slug,
      price_cents: product.price_cents,
      image: product.images?.[0] ?? undefined,
      size: isGlove && size ? size : undefined,
    });
    setAdded((prev) => ({ ...prev, [product.id]: true }));
  }

  if (loading) {
    return (
      <div className="surface-chalk flex min-h-[70vh] items-center justify-center">
        <p role="status" className="label-caps animate-pulse text-lg text-ink-soft motion-reduce:animate-none">Loading</p>
      </div>
    );
  }

  const cartIds = new Set(items.map((i) => i.id));

  return (
    <div className="surface-chalk min-h-[70vh]">
      <div className="wrap pt-10 pb-24 md:pt-16 md:pb-28">

        {/* Header */}
        <div className="mb-10 md:mb-14">
          <p className="eyebrow mb-5 inline-flex items-center gap-2.5 text-cobalt">
            <span aria-hidden className="h-[3px] w-6 rounded-full bg-cobalt" />
            Pre-Checkout
          </p>
          <h1 className="font-heading text-[3rem] leading-[0.9] font-black text-ink md:text-[4.5rem]">Want to add anything else?</h1>
          <p className="lead mt-5 text-ink-soft">These pair great with your order.</p>
        </div>

        <div className="grid grid-cols-1 items-start gap-8 lg:grid-cols-[minmax(0,1fr)_360px] lg:gap-10">

          {/* Left — upsell products */}
          <div className="flex w-full flex-col gap-4">
            {products.map((product) => {
              const isGlove = product.name.toLowerCase().includes("glove");
              const selectedSize = sizes[product.id];
              const inCart = cartIds.has(product.id) || added[product.id];
              return (
                <div
                  key={product.id}
                  className={cn(
                    "flex flex-wrap items-start gap-4 rounded-[22px] p-4 transition-[background-color,box-shadow] duration-200 sm:flex-nowrap sm:gap-5 sm:p-5",
                    inCart
                      ? "bg-success-tint shadow-[inset_0_0_0_2px_var(--success)]"
                      : "bg-white shadow-[0_0_0_1px_var(--line),var(--panel-shadow)]"
                  )}
                >
                  {/* Image */}
                  <div className="size-24 shrink-0 overflow-hidden rounded-[14px] bg-chalk">
                    {product.images?.[0] ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={product.images[0]} alt={product.name} className="h-full w-full object-cover" />
                    ) : (
                      <div aria-hidden className="grid h-full w-full place-items-center text-ink/25">
                        <Package className="size-8" strokeWidth={1.25} />
                      </div>
                    )}
                  </div>

                  {/* Info + size */}
                  <div className="min-w-0 flex-1">
                    <p className="font-heading text-[1.5rem] leading-[1.02] font-extrabold text-ink">{product.name}</p>
                    {product.description && (
                      <p className="mt-1.5 line-clamp-2 text-sm leading-relaxed text-ink-soft">{product.description}</p>
                    )}
                    <p className="mt-2.5 font-heading text-[1.6rem] leading-none font-black text-ink tabular-nums">
                      {formatCurrency(product.price_cents)}
                    </p>

                    {isGlove && !inCart && (
                      <div className="mt-4">
                        <p className="label-caps mb-2.5 text-[15px] text-ink">Select Size</p>
                        <div className="flex flex-wrap gap-2">
                          {SIZES.map((s) => (
                            <button
                              key={s}
                              onClick={() => setSizes((prev) => ({ ...prev, [product.id]: s }))}
                              aria-pressed={selectedSize === s}
                              className={cn(
                                "min-h-11 min-w-14 rounded-full px-4 text-[15px] font-bold transition-[background-color,box-shadow,color] duration-150 focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-cobalt",
                                selectedSize === s
                                  ? "bg-ink text-white"
                                  : "bg-white text-ink shadow-[inset_0_0_0_1.5px_var(--line-strong)] hover:shadow-[inset_0_0_0_1.5px_var(--ink-soft)]"
                              )}
                            >
                              {s}
                            </button>
                          ))}
                        </div>
                        {!selectedSize && (
                          <p className="mt-2 text-sm text-ink-soft">Select a size to add.</p>
                        )}
                      </div>
                    )}
                  </div>

                  {/* Add button */}
                  <div className="w-full shrink-0 sm:w-auto sm:pt-1">
                    {inCart ? (
                      <span className="inline-flex min-h-11 items-center gap-1.5 rounded-full bg-success px-4 text-[15px] font-bold text-white">
                        <Check aria-hidden className="size-4" strokeWidth={2.75} />
                        Added
                      </span>
                    ) : (
                      <button
                        onClick={() => handleAdd(product)}
                        disabled={isGlove && !selectedSize}
                        className={cta({ tone: "sun", size: "sm", className: "w-full gap-1.5 sm:w-auto" })}
                      >
                        <Plus aria-hidden className="size-4" strokeWidth={2.5} />
                        Add
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>

          {/* Right — order summary + continue */}
          <div className="w-full lg:sticky lg:top-[calc(var(--header-h)+24px)]">
            <div className={FORM_PANEL}>
              <h2 className={`${BLOCK_TITLE} mb-5`}>Your Cart</h2>
              <div className="mb-6 flex flex-col gap-3">
                {items.map((item) => (
                  <div key={item.id} className={SUM_ROW}>
                    <span className="mr-2 truncate">{item.name} × {item.quantity}</span>
                    <span className="shrink-0 font-semibold text-ink tabular-nums">{formatCurrency(item.price_cents * item.quantity)}</span>
                  </div>
                ))}
                <div className={SUM_ROW}>
                  <span>Sales Tax (6.625%)</span>
                  <span className="font-semibold text-ink tabular-nums">{formatCurrency(Math.round(totalCents * 0.06625))}</span>
                </div>
                <div className={SUM_ROW}>
                  <span>Shipping</span>
                  <span>At checkout</span>
                </div>
                <div className={SUM_TOTAL}>
                  <span>Total</span>
                  <span className="tabular-nums">{formatCurrency(totalCents + Math.round(totalCents * 0.06625))}</span>
                </div>
              </div>

              <button
                onClick={() => router.push(destination)}
                className={cta({ tone: "sun", size: "lg", className: "w-full" })}
              >
                Continue to Checkout
                <ArrowRight aria-hidden className="size-5" strokeWidth={2} />
              </button>
              <button
                onClick={() => router.back()}
                className="mt-2 flex min-h-11 w-full items-center justify-center gap-1.5 text-sm font-semibold text-ink-soft hover:text-ink hover:underline"
              >
                <ArrowLeft aria-hidden className="size-4" strokeWidth={2} />
                Back to cart
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function UpsellPage() {
  return (
    <Suspense>
      <UpsellInner />
    </Suspense>
  );
}
