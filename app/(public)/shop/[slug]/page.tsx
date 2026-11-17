import { cache } from "react";
import type { Metadata } from "next";
import { createAdminClient } from "@/lib/supabase/admin";
import { catalogProduct } from "@/lib/shop-catalog";
import { JsonLd } from "@/components/seo/json-ld";
import { ORG_ID, SITE, breadcrumbs, canonical } from "@/lib/seo";
import { formatCurrency } from "@/lib/utils";
import { notFound } from "next/navigation";
import Link from "next/link";
import { AddToCartButtonLarge } from "./add-to-cart-button-large";
import { ArrowLeft, ArrowRight, Info, Package } from "lucide-react";
import { isSoldOut } from "@/lib/site-config";
import { PixelViewContent } from "@/components/pixel-view-content";
import { cta } from "@/components/brand";
import { KIT_REVIEW } from "@/lib/reviews";

export const dynamic = "force-dynamic";

const getProduct = cache(async (slug: string) => {
  const admin = createAdminClient();
  const { data } = await admin.from("products").select("*").eq("slug", slug).eq("active", true).single();
  // No database product (this preview has none): fall back to the shop's listed item.
  return data ?? catalogProduct(slug) ?? null;
});

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params;
  const product = await getProduct(slug);
  if (!product) return {};
  const description = typeof product.description === "string" ? product.description.slice(0, 160) : undefined;
  const image = product.images?.[0];
  return {
    title: `${product.name} | The Card Doc`,
    description,
    alternates: canonical(`/shop/${slug}`),
    openGraph: image ? { images: [image] } : undefined,
  };
}

function DescriptionBlock({ text }: { text: string }) {
  // If description contains "includes:" pull out the items after it and render as bullets
  const match = text.match(/^(.+?includes:)\s*/i);
  if (match) {
    const itemsText = text.slice(match[0].length);
    // Split before each quantity pattern like "10x", "2x", "5×", "1×"
    const items = itemsText.split(/\s+(?=\d+[x×])/).filter(Boolean);
    if (items.length > 1) {
      return (
        <ul className="flex flex-col">
          {items.map((item, i) => (
            <li key={i} className="flex items-start gap-3 border-b border-line py-3 text-[16px] leading-snug last:border-0">
              <span className="mt-[7px] size-2.5 shrink-0 rounded-[3px] bg-cobalt" aria-hidden />
              <span className="text-ink">{item.trim()}</span>
            </li>
          ))}
        </ul>
      );
    }
  }
  return <p className="text-[16px] leading-relaxed text-ink">{text}</p>;
}

export default async function ProductPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const product = await getProduct(slug);

  if (!product) notFound();

  const inStock = !isSoldOut() && (product.inventory_count === null || product.inventory_count === undefined || product.inventory_count > 0);
  const structured = [
    {
      "@context": "https://schema.org",
      "@type": "Product",
      name: product.name,
      description: product.description ?? undefined,
      image: product.images?.length ? product.images : undefined,
      sku: String(product.id),
      category: product.category ?? undefined,
      brand: { "@type": "Brand", name: "The Card Doc" },
      offers: {
        "@type": "Offer",
        price: (product.price_cents / 100).toFixed(2),
        priceCurrency: "USD",
        availability: inStock ? "https://schema.org/InStock" : "https://schema.org/OutOfStock",
        url: `${SITE}/shop/${product.slug}`,
        seller: { "@id": ORG_ID },
      },
    },
    breadcrumbs([
      { name: "Shop Kits", path: "/shop" },
      { name: product.name, path: `/shop/${product.slug}` },
    ]),
  ];

  const images: string[] = product.images ?? [];
  const isKit = product.name.toLowerCase().includes("kit");

  return (
    <div className="surface-chalk">
      <JsonLd data={structured} />
      <PixelViewContent contentName={product.name} contentCategory={product.category ?? "Shop"} />
      <div className="wrap pt-6 pb-20 md:pt-10 md:pb-28">
        <Link
          href="/shop"
          className="mb-6 -ml-3 inline-flex min-h-11 items-center gap-2 rounded-full px-3 text-[15px] font-bold text-ink-soft transition-colors hover:bg-white hover:text-ink md:mb-10"
        >
          <ArrowLeft aria-hidden className="size-4" strokeWidth={2} />
          Back to Shop
        </Link>

        <div className="grid grid-cols-1 gap-10 md:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)] md:gap-14 lg:gap-20">
          {/* The item, on a studio sweep */}
          <div className="flex flex-col gap-4 md:sticky md:top-[calc(var(--header-h)+24px)] md:self-start">
            <div className="seamless relative aspect-square overflow-hidden shadow-[0_0_0_1px_var(--line),var(--panel-shadow)]">
              {images[0] ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={images[0]} alt={product.name} className="h-full w-full object-cover" />
              ) : (
                <div aria-hidden className="grid h-full w-full place-items-center text-ink/20">
                  <Package className="size-20" strokeWidth={1} />
                </div>
              )}
            </div>
            {images.length > 1 && (
              <div className="flex flex-wrap gap-3">
                {images.slice(1).map((url: string, i: number) => (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img key={i} src={url} alt={product.name} className="size-20 rounded-[12px] bg-white object-cover shadow-[0_0_0_1px_var(--line)] md:size-24" />
                ))}
              </div>
            )}
          </div>

          {/* Item card */}
          <div className="flex flex-col gap-8">
            <div>
              {product.category && (
                <p className="eyebrow mb-4 inline-flex items-center gap-2.5 text-cobalt">
                  <span aria-hidden className="h-[3px] w-6 rounded-full bg-cobalt" />
                  {product.category}
                </p>
              )}
              <h1 className="font-heading text-[3rem] leading-[0.9] font-black tracking-[-0.01em] text-ink md:text-[4.25rem]">{product.name}</h1>

              <p className="mt-6 font-heading text-[2.75rem] leading-none font-black text-ink tabular-nums">
                {formatCurrency(product.price_cents)}
              </p>
            </div>

            {product.description && (
              <div className="rounded-[22px] bg-white p-5 shadow-[0_0_0_1px_var(--line)] sm:p-6">
                <DescriptionBlock text={product.description} />
              </div>
            )}

            {product.inventory_count > 0 && product.inventory_count <= 5 && (
              <p className="inline-flex items-center gap-2 self-start rounded-full bg-sun-tint px-3.5 py-2 text-sm font-bold text-ink">
                <span aria-hidden className="size-2 rounded-full bg-sun-deep" />
                Only {product.inventory_count} left in stock
              </p>
            )}

            <div className="flex flex-col gap-4">
              {isSoldOut() ? (
                <div className="flex min-h-14 items-center justify-center rounded-full bg-white px-6 shadow-[inset_0_0_0_1.5px_var(--line-strong)]">
                  <span className="font-heading text-xl font-extrabold text-ink-soft">Sold Out — Back Soon</span>
                </div>
              ) : product.inventory_count === 0 ? (
                <p className="font-heading text-2xl font-extrabold text-ink-soft">Out of stock</p>
              ) : (
                <AddToCartButtonLarge
                  product={{
                    id: product.id,
                    name: product.name,
                    price_cents: product.price_cents,
                    slug: product.slug,
                    image: product.images?.[0],
                  }}
                  requiresSize={product.name.toLowerCase().includes("glove")}
                />
              )}

              <p className="mt-1 flex items-start gap-2.5 text-sm leading-relaxed text-ink-soft">
                <Info aria-hidden className="mt-0.5 size-4 shrink-0 text-cobalt" strokeWidth={1.75} />
                All sales final. Defective or missing items are replaced or refunded.
              </p>
            </div>

            {isKit && (
              <figure className="border-t border-line pt-8">
                <blockquote className="font-heading text-[1.75rem] leading-[1.05] font-extrabold text-ink">
                  <p><span aria-hidden className="text-sun-deep">&ldquo;</span>{KIT_REVIEW.quote}<span aria-hidden className="text-sun-deep">&rdquo;</span></p>
                </blockquote>
                <figcaption className="label-caps mt-3 text-[15px] text-ink-soft">{KIT_REVIEW.from}</figcaption>
              </figure>
            )}
          </div>
        </div>

        <div className="mt-20 flex flex-col items-start justify-between gap-6 rounded-[22px] bg-ink p-7 text-white sm:flex-row sm:items-center md:mt-28 md:p-10">
          <p className="font-heading text-[2rem] leading-[0.95] font-black md:text-[2.5rem]">Your Collection Means Something.</p>
          <Link href="/tier-selection" className={cta({ tone: "sun", size: "lg", className: "shrink-0" })}>
            Book a Restoration
            <ArrowRight aria-hidden className="size-5" strokeWidth={2} />
          </Link>
        </div>
      </div>
    </div>
  );
}
