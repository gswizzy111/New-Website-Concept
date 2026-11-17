import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { Print, cta } from "@/components/brand";
import charmanderAfter from "@/public/home/charmander-after.jpg";

/** The empty-cart panel, shared by /cart and /cart/upsell. */
export function EmptyCart() {
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
