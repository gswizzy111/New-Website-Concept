import { createAdminClient } from "@/lib/supabase/admin";
import { formatCurrency } from "@/lib/utils";
import { notFound } from "next/navigation";
import Link from "next/link";
import { AddToCartButtonLarge } from "./add-to-cart-button-large";
import { RefreshCw, Star } from "lucide-react";
import { isSoldOut } from "@/lib/site-config";
import { PixelViewContent } from "@/components/pixel-view-content";

export const dynamic = "force-dynamic";

function DescriptionBlock({ text }: { text: string }) {
  // If description contains "includes:" pull out the items after it and render as bullets
  const match = text.match(/^(.+?includes:)\s*/i);
  if (match) {
    const itemsText = text.slice(match[0].length);
    // Split before each quantity pattern like "10x", "2x", "5×", "1×"
    const items = itemsText.split(/\s+(?=\d+[x×])/).filter(Boolean);
    if (items.length > 1) {
      return (
        <ul className="flex flex-col gap-2">
          {items.map((item, i) => (
            <li key={i} className="flex items-start gap-2.5 text-sm">
              <span className="mt-[9px] h-1 w-1 rounded-full bg-rx shrink-0" aria-hidden />
              <span className="text-muted-foreground">{item.trim()}</span>
            </li>
          ))}
        </ul>
      );
    }
  }
  return <p className="text-muted-foreground leading-relaxed text-sm">{text}</p>;
}

const RATINGS: { keywords: string[]; stars: number; count: number }[] = [
  { keywords: ["official"],   stars: 4.97, count: 89 },
  { keywords: ["essential"],  stars: 4.8,  count: 24 },
  { keywords: ["starter"],    stars: 4.7,  count: 51 },
  { keywords: ["clamp"],      stars: 4.9,  count: 17 },
  { keywords: ["wrinkle"],    stars: 4.85, count: 9  },
  { keywords: ["tools"],      stars: 4.75, count: 13 },
  { keywords: ["polish"],     stars: 4.8,  count: 22 },
  { keywords: ["spray"],      stars: 4.9,  count: 16 },
];

function getRating(name: string) {
  const lower = name.toLowerCase();
  return RATINGS.find((r) => r.keywords.some((k) => lower.includes(k)));
}

export default async function ProductPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const admin = createAdminClient();

  const { data: product } = await admin
    .from("products")
    .select("*")
    .eq("slug", slug)
    .eq("active", true)
    .single();

  if (!product) notFound();

  const rating = getRating(product.name);

  return (
    <div className="max-w-6xl mx-auto px-4 md:px-10 py-10 md:py-14">
      <PixelViewContent contentName={product.name} contentCategory={product.category ?? "Shop"} />
      <a href="/shop" className="text-sm text-muted-foreground hover:text-foreground transition-colors mb-8 block">
        &larr; Back to Shop
      </a>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-12 md:gap-20">
        {/* Images */}
        <div className="flex flex-col gap-3">
          <div className="aspect-square bg-secondary overflow-hidden rounded-lg border border-rule">
            {product.images?.[0] ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={product.images[0]} alt={product.name} className="w-full h-full object-cover" />
            ) : (
              <div className="w-full h-full bg-secondary" />
            )}
          </div>
          {product.images?.length > 1 && (
            <div className="flex gap-2">
              {product.images.slice(1).map((url: string, i: number) => (
                // eslint-disable-next-line @next/next/no-img-element
                <img key={i} src={url} alt={product.name} className="w-16 h-16 object-cover rounded-md border border-rule" />
              ))}
            </div>
          )}
        </div>

        {/* Info */}
        <div className="flex flex-col gap-6">
          <div>
            <p className="rx-label text-rx mb-2">
              {product.category}
            </p>
            <h1 className="font-heading text-3xl md:text-5xl font-extrabold tracking-[-0.03em] text-ink mb-3 [font-variation-settings:'wdth'_84]">{product.name}</h1>

            {rating && (
              <div className="flex items-center gap-2 mb-3">
                <span className="flex gap-0.5" aria-label="5 star rating">
                  {Array.from({ length: 5 }).map((_, i) => (
                    <Star key={i} className="h-4 w-4 fill-amber-500 text-amber-500" strokeWidth={1.5} />
                  ))}
                </span>
                <span className="text-sm font-semibold text-foreground">{rating.stars}</span>
                <span className="text-sm text-muted-foreground">({rating.count} reviews)</span>
              </div>
            )}

            <p className="font-heading text-3xl font-bold tracking-tight text-ink tabular-nums">{formatCurrency(product.price_cents)}</p>
          </div>

          {product.description && <DescriptionBlock text={product.description} />}

          {product.inventory_count > 0 && product.inventory_count <= 5 && (
            <p className="font-mono text-xs text-rx">Only {product.inventory_count} left in stock</p>
          )}

          <div className="border-t border-border pt-6 flex flex-col gap-4">
            {isSoldOut() ? (
              <div className="flex items-center justify-center h-13 rounded-md bg-secondary border border-rule">
                <span className="font-bold text-muted-foreground tracking-widest uppercase text-sm">Sold Out — Back Soon</span>
              </div>
            ) : product.inventory_count === 0 ? (
              <p className="text-muted-foreground font-medium">Out of stock</p>
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

            {!isSoldOut() && product.name.toLowerCase().includes("kit") && (
              <Link
                href="/subscribe"
                className="w-full flex items-center justify-center gap-2 h-13 font-semibold text-sm tracking-wide border border-ink/70 text-ink hover:border-rx hover:text-rx active:scale-[0.98] transition-all duration-150 rounded-md"
              >
                <RefreshCw className="h-4 w-4" />
                Subscribe — $62.99/mo · Save every month
              </Link>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
