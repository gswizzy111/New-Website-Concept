"use client";

import { useCart } from "@/lib/cart-context";
import { formatCurrency } from "@/lib/utils";
import Link from "next/link";
import { ArrowRight, Minus, Package, Plus, Trash2 } from "lucide-react";
import { Print, cta } from "@/components/brand";
import charmanderAfter from "@/public/home/charmander-after.jpg";
import { BLOCK_TITLE, FORM_PANEL, SUM_ROW, SUM_TOTAL } from "@/components/checkout/form-styles";

const TAX_RATE = 0.06625;

const STEPPER =
  "grid size-11 place-items-center rounded-full text-ink transition-colors hover:bg-chalk focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-cobalt";

export default function CartPage() {
  const { items, totalCents, removeItem, updateQty } = useCart();
  const taxCents = Math.round(totalCents * TAX_RATE);

  if (items.length === 0) {
    return (
      <section className="surface-chalk flex min-h-[70vh] items-center py-16 md:py-24">
        <div className="wrap">
          <div className="mx-auto flex max-w-xl flex-col items-center text-center">
            <Print
              src={charmanderAfter}
              alt="A restored Base Set Charmander card"
              aspect="364/503"
              tilt={-5}
              border="sm"
              enterDelay={80}
              sizes="128px"
              className="mb-10 w-28 md:w-32"
            />
            <h1 className="font-heading text-[2.75rem] leading-[0.92] font-black text-ink md:text-[3.5rem]">Your cart is empty</h1>
            <p className="mt-4 mb-8 text-[17px] text-ink-soft">Browse the shop to add products.</p>
            <div className="flex w-full flex-col gap-3 sm:w-auto sm:flex-row">
              <Link href="/shop" className={cta({ tone: "sun", size: "lg", className: "w-full sm:w-auto" })}>
                Browse Shop
                <ArrowRight aria-hidden className="size-5" strokeWidth={2} />
              </Link>
              <Link href="/tier-selection" className={cta({ tone: "outline", size: "lg", className: "w-full sm:w-auto" })}>
                Book a Restoration
              </Link>
            </div>
          </div>
        </div>
      </section>
    );
  }

  const count = items.reduce((n, i) => n + i.quantity, 0);

  return (
    <div className="surface-chalk">
      <div className="wrap pt-10 pb-24 md:pt-16 md:pb-28">
        <div className="mb-8 flex items-end gap-4 md:mb-12">
          <h1 className="font-heading text-[3rem] leading-[0.9] font-black text-ink md:text-[4.5rem]">Your Cart</h1>
          <span aria-hidden className="mb-1.5 grid h-9 min-w-9 place-items-center rounded-full bg-sun px-2.5 font-heading text-xl font-black text-ink tabular-nums md:mb-3">
            {count}
          </span>
        </div>

        <div className="grid grid-cols-1 gap-8 lg:grid-cols-[minmax(0,1fr)_380px] lg:gap-10">
          {/* Items */}
          <div className="self-start overflow-hidden rounded-[22px] bg-white shadow-[0_0_0_1px_var(--line),var(--panel-shadow)]">
            <ul className="divide-y divide-line">
              {items.map((item) => (
                <li key={item.id} className="grid grid-cols-[5rem_minmax(0,1fr)] items-center gap-x-4 gap-y-3 p-4 sm:flex sm:gap-5 sm:p-5">
                  <div className="row-span-2 size-20 shrink-0 self-start overflow-hidden rounded-[14px] bg-chalk sm:self-auto">
                    {item.image ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={item.image} alt={item.name} className="h-full w-full object-cover" />
                    ) : (
                      <div aria-hidden className="grid h-full w-full place-items-center text-ink/25">
                        <Package className="size-8" strokeWidth={1.25} />
                      </div>
                    )}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="font-heading text-[1.35rem] leading-[1.02] font-extrabold text-ink">{item.name}</p>
                    {item.size && <p className="mt-1 text-sm text-ink-soft">Size: {item.size}</p>}
                    <p className="mt-1 text-sm text-ink-soft tabular-nums">{formatCurrency(item.price_cents)}</p>
                  </div>
                  {/* Phones: quantity and total share a line under the name; from sm the row is one line */}
                  <div className="col-start-2 flex flex-wrap items-center justify-between gap-x-4 gap-y-2 sm:contents">
                    <div className="flex items-center rounded-full bg-white shadow-[inset_0_0_0_1.5px_var(--line-strong)]">
                      <button
                        onClick={() => updateQty(item.id, item.quantity - 1)}
                        aria-label={`Decrease quantity of ${item.name}`}
                        className={STEPPER}
                      >
                        <Minus className="size-4" strokeWidth={2.25} />
                      </button>
                      <span className="grid h-11 w-8 place-items-center font-heading text-xl font-black text-ink tabular-nums">{item.quantity}</span>
                      <button
                        onClick={() => updateQty(item.id, item.quantity + 1)}
                        aria-label={`Increase quantity of ${item.name}`}
                        className={STEPPER}
                      >
                        <Plus className="size-4" strokeWidth={2.25} />
                      </button>
                    </div>
                    <div className="ml-auto flex items-center gap-1">
                      <span className="w-24 text-right font-heading text-[1.5rem] font-black text-ink tabular-nums">
                        {formatCurrency(item.price_cents * item.quantity)}
                      </span>
                      <button
                        onClick={() => removeItem(item.id)}
                        aria-label={`Remove ${item.name} from cart`}
                        className="grid size-11 place-items-center rounded-full text-ink-soft transition-colors hover:bg-red-50 hover:text-destructive focus-visible:outline-3 focus-visible:outline-offset-0 focus-visible:outline-cobalt"
                      >
                        <Trash2 className="size-[18px]" strokeWidth={1.75} />
                      </button>
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          </div>

          {/* Summary: the receipt */}
          <div>
            <div className={`${FORM_PANEL} lg:sticky lg:top-[calc(var(--header-h)+24px)]`}>
              <h2 className={`${BLOCK_TITLE} mb-6`}>Order Summary</h2>
              <div className="mb-7 flex flex-col gap-3">
                <div className={SUM_ROW}>
                  <span>Subtotal</span>
                  <span className="tabular-nums">{formatCurrency(totalCents)}</span>
                </div>
                <div className={SUM_ROW}>
                  <span>Sales Tax (6.625%)</span>
                  <span className="tabular-nums">{formatCurrency(taxCents)}</span>
                </div>
                <div className={SUM_ROW}>
                  <span>Shipping</span>
                  <span className="text-right">Calculated at checkout</span>
                </div>
                <div className={SUM_TOTAL}>
                  <span>Total</span>
                  <span className="tabular-nums">{formatCurrency(totalCents + taxCents)}</span>
                </div>
              </div>
              <Link href="/cart/upsell" className={cta({ tone: "sun", size: "lg", className: "w-full" })}>
                Checkout — US Shipping
              </Link>
              <Link href="/cart/upsell?international=true" className={cta({ tone: "outline", size: "md", className: "mt-3 w-full" })}>
                International Shipping
              </Link>
              <Link href="/shop" className="mt-3 flex min-h-11 items-center justify-center text-sm font-semibold text-ink-soft underline-offset-4 hover:text-ink hover:underline">
                Continue shopping
              </Link>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
