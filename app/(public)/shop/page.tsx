import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight, Package, Star } from "lucide-react";
import { JsonLd } from "@/components/seo/json-ld";
import { SITE, breadcrumbs, canonical } from "@/lib/seo";
import { KIT_REVIEW, type Review } from "@/lib/reviews";
import { SERVICE_CARDS } from "@/lib/service-cards";
import { createAdminClient } from "@/lib/supabase/admin";
import { SHOP_CATALOG } from "@/lib/shop-catalog";
import { formatCurrency } from "@/lib/utils";
import { cn } from "@/lib/utils";
import { AddToCartButton } from "./add-to-cart-button";
import { isSoldOut } from "@/lib/site-config";
import { CtaPanel, Print, Sticker, cta } from "@/components/brand";
import charizardPsa from "@/public/home/charizard-psa.jpg";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Shop Kits | The Card Doc",
  description: "The same pro-grade tools The Card Doc uses — delivered to you. US shipping at cost + $2 handling.",
  alternates: canonical("/shop"),
};

const KITS = SERVICE_CARDS[2];
const RESTORATION = SERVICE_CARDS[0];

type Product = {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  price_cents: number;
  images: string[] | null;
  category: string | null;
  inventory_count: number;
  rating?: { value: string; count: number };
};

function ProductCard({ product }: { product: Product }) {
  const isKit = product.name.toLowerCase().includes("official");
  const soldOut = isSoldOut();
  return (
    <article className="lift group relative flex flex-col overflow-hidden rounded-[22px] bg-white shadow-[0_0_0_1px_var(--line),var(--panel-shadow)]">
      <Link
        href={`/shop/${product.slug}`}
        className="relative block overflow-hidden rounded-t-[22px] focus-visible:outline-3 focus-visible:-outline-offset-3 focus-visible:outline-cobalt"
      >
        {/* The item on a studio sweep */}
        <div className="seamless-chalk relative aspect-square">
          {product.images?.[0] ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={product.images[0]}
              alt={product.name}
              className="h-full w-full object-cover transition-transform duration-500 ease-[var(--ease-out)] motion-safe:group-hover:scale-[1.04]"
            />
          ) : (
            <div aria-hidden className="grid h-full w-full place-items-center text-ink/25">
              <Package className="size-14" strokeWidth={1.25} />
            </div>
          )}
          {soldOut && (
            <div className="absolute inset-0 grid place-items-center bg-chalk/70 backdrop-blur-[1px]">
              <span className="sticker sticker-ink sticker-sm">Sold Out</span>
            </div>
          )}
        </div>
      </Link>
      {isKit && (
        <Sticker size="sm" tilt={-3} className="pointer-events-none absolute top-3 left-3 z-10">
          Most Popular
        </Sticker>
      )}
      <div className="flex flex-1 flex-col gap-4 p-4 sm:p-5">
        <h3 className="flex-1">
          <Link
            href={`/shop/${product.slug}`}
            className="font-heading text-[1.3rem] leading-[1.02] font-extrabold text-ink decoration-sun-deep decoration-[3px] underline-offset-4 hover:underline sm:text-[1.45rem]"
          >
            {product.name}
          </Link>
        </h3>
        {product.rating && (
          <p className="-mt-2 flex items-center gap-1.5 text-sm text-ink-soft">
            <span className="flex text-sun-deep" aria-hidden>
              {Array.from({ length: 5 }, (_, i) => (
                <Star key={i} className="size-3.5 fill-current" strokeWidth={0} />
              ))}
            </span>
            <span className="font-bold text-ink tabular-nums">{product.rating.value}</span>
            <span className="tabular-nums">({product.rating.count})</span>
            <span className="sr-only">
              Rated {product.rating.value} out of 5 from {product.rating.count} reviews
            </span>
          </p>
        )}
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <span className="font-heading text-[1.75rem] leading-none font-black text-ink tabular-nums">
            {formatCurrency(product.price_cents)}
          </span>
          {soldOut || product.inventory_count === 0 ? (
            <span className="inline-flex min-h-11 items-center self-start rounded-full bg-chalk px-4 text-sm font-bold text-ink-soft sm:self-auto">
              Sold Out
            </span>
          ) : (
            <AddToCartButton
              product={{
                id: product.id,
                name: product.name,
                price_cents: product.price_cents,
                slug: product.slug,
                image: product.images?.[0],
              }}
            />
          )}
        </div>
      </div>
    </article>
  );
}

const SECTION_GRID: Record<number, string> = {
  1: "grid-cols-1 max-w-[300px] sm:max-w-sm",
  2: "grid-cols-2 max-w-3xl",
  3: "grid-cols-2 md:grid-cols-3",
  4: "grid-cols-2 md:grid-cols-4",
  5: "grid-cols-2 md:grid-cols-3",
  6: "grid-cols-2 md:grid-cols-3",
  7: "grid-cols-2 md:grid-cols-4",
  8: "grid-cols-2 md:grid-cols-4",
  9: "grid-cols-2 md:grid-cols-3",
  12: "grid-cols-2 md:grid-cols-4",
};

function getSectionGridClass(count: number): string {
  return SECTION_GRID[count] ?? "grid-cols-2 md:grid-cols-4";
}

function KitReview({ review, className }: { review: Review; className?: string }) {
  return (
    <figure data-reveal className={cn("relative max-w-2xl pl-14 md:pl-16", className)}>
      <span aria-hidden className="absolute top-[-0.15em] left-0 font-heading text-[5.5rem] leading-none font-black text-sun-deep md:text-[6.5rem]">
        &ldquo;
      </span>
      <blockquote className="font-heading text-[2rem] leading-[1.02] font-extrabold text-ink md:text-[2.75rem]">
        <p>{review.quote}</p>
      </blockquote>
      <figcaption className="label-caps mt-4 text-[15px] text-ink-soft">{review.from}</figcaption>
    </figure>
  );
}

function ProductSection({ title, products, review }: { title: string; products: Product[]; review?: Review }) {
  if (products.length === 0) return null;
  return (
    <section aria-labelledby={`shelf-${title}`}>
      <div className="mb-8 flex items-end gap-5 md:mb-10">
        <h2 id={`shelf-${title}`} className="display-md caps text-ink">{title}</h2>
        <span aria-hidden className="mb-2 h-[3px] flex-1 rounded-full bg-ink/10" />
        <span className="label-caps mb-1 text-[15px] text-ink-soft tabular-nums">{products.length}</span>
      </div>
      <div data-reveal="stagger" className={`grid ${getSectionGridClass(products.length)} gap-x-3 gap-y-6 sm:gap-x-6 md:gap-8`}>
        {products.map((p) => <ProductCard key={p.id} product={p} />)}
      </div>
      {review && <KitReview review={review} className="mt-14" />}
    </section>
  );
}

export default async function ShopPage() {
  const admin = createAdminClient();

  const { data } = await admin
    .from("products")
    .select("id, name, slug, description, price_cents, images, category, inventory_count")
    .eq("active", true)
    .order("display_order", { ascending: true });

  // No products from the database (this preview has none): show the shop's
  // listed kits, tools and supplies instead.
  const products: Product[] = data && data.length > 0 ? (data as Product[]) : SHOP_CATALOG;

  const kits = products.filter((p) => p.category === "Kits");
  const tools = products.filter((p) => p.category === "Tools");
  const supplies = products.filter((p) => p.category === "Supplies" || p.category === "Cleaning" || p.category === "Storage");

  return (
    <div>
      <JsonLd
        data={[
          breadcrumbs([{ name: "Shop Kits", path: "/shop" }]),
          {
            "@context": "https://schema.org",
            "@type": "ItemList",
            itemListElement: products.map((p, i) => ({
              "@type": "ListItem",
              position: i + 1,
              name: p.name,
              url: `${SITE}/shop/${p.slug}`,
            })),
          },
        ]}
      />

      {/* No intro header: the shelves open the page, so the products show at once. */}
      <h1 className="sr-only">Shop</h1>

      {/* The shelves, only once there is stock */}
      {products.length > 0 && (
        <section id="shelves" aria-label={KITS.name} className="surface-white scroll-mt-24 pt-10 pb-[var(--section-y)] md:pt-14">
          <div className="wrap flex flex-col gap-20 md:gap-28">
            <ProductSection title="Kits" products={kits} review={KIT_REVIEW} />
            <ProductSection title="Tools" products={tools} />
            <ProductSection title="Supplies" products={supplies} />
          </div>
        </section>
      )}

      {/* Cross-sell: the service itself */}
      <section className="surface-chalk pb-24 md:pb-28">
        <div className="wrap pt-4 md:pt-6">
          <CtaPanel
            tone="cobalt"
            eyebrow={RESTORATION.name}
            title={RESTORATION.line}
            lead={RESTORATION.price}
            actions={
              <>
                <Link href="/tier-selection" className={cta({ tone: "sun", size: "lg" })}>
                  Book a Restoration
                  <ArrowRight aria-hidden className="size-5" strokeWidth={2} />
                </Link>
                <Link href="/prep" className={cta({ tone: "outline-light", size: "lg" })}>
                  PSA Prep Pricing
                </Link>
              </>
            }
            aside={
              <div className="hidden justify-center md:flex">
                <Print
                  src={charizardPsa}
                  alt="A Charizard Gold Star card in a PSA slab, held in a blue glove"
                  aspect="800/1407"
                  surface="dark"
                  tilt={-5}
                  border="md"
                  lift
                  sizes="(min-width: 768px) 22vw, 0px"
                  className="w-[62%] max-w-[260px]"
                />
              </div>
            }
          />
        </div>
      </section>
    </div>
  );
}
