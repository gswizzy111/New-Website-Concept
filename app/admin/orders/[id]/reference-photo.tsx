import { catalogThumb, isCatalogImageUrl } from "@/lib/card-catalog";

/**
 * The card catalog's picture of the card staff picked (cards.catalog_image_url),
 * shown beside the customer's photos and labelled, so nobody takes it for the
 * customer's own card. Admin only.
 */
export function ReferencePhoto({ url, small = false }: { url: string | null | undefined; small?: boolean }) {
  if (!url || !isCatalogImageUrl(url)) return null;
  return (
    <a
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      title="Reference photo from the card catalog, not the customer's card"
      className="flex flex-col items-center gap-0.5 shrink-0"
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={catalogThumb(url)}
        alt="Reference photo of the catalog card"
        loading="lazy"
        decoding="async"
        className={`${small ? "h-12" : "h-16"} aspect-[63/88] object-contain rounded border border-dashed border-border bg-white`}
      />
      <span className="text-[9px] font-bold uppercase tracking-wide text-muted-foreground leading-none">Reference photo</span>
    </a>
  );
}
