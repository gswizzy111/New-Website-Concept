import { cardStickersUrl } from "../_lib/places";
import { StickerPrintButton } from "./print-buttons";

/**
 * "Card stickers" on the receiving workspace: one 50 x 80 mm sticker per
 * received card (its QR, Card ID, customer, card, tier, due date and Bag ID),
 * for the whole order or one bag, any time (a reprint too). Server component.
 */
export function CardStickers({ orderId, orderNumber, bags }: {
  orderId: string;
  orderNumber: string;
  /** Bags with cards in them (not refunded), in bag order. */
  bags: { id: string; code: string; cardCount: number }[];
}) {
  const total = bags.reduce((n, b) => n + b.cardCount, 0);
  if (!total) return null;
  return (
    <section aria-labelledby="stickers-h" className="mt-4 rounded-xl border border-border bg-white p-4 sm:p-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <h3 id="stickers-h" className="font-heading font-black text-base text-foreground">Card stickers</h3>
          <p className="mt-0.5 text-sm text-muted-foreground">
            One 50 × 80 mm sticker per card, with its QR code: scan it anywhere to move or find the card.
          </p>
        </div>
        <StickerPrintButton pdfUrl={cardStickersUrl({ order: orderId })} fileName={`${orderNumber || "order"}-card-stickers.pdf`}>
          Print all {total}
        </StickerPrintButton>
      </div>
      {bags.length > 1 && (
        <div className="mt-3 flex flex-wrap gap-2" aria-label="One bag's stickers">
          {bags.map((b) => (
            <StickerPrintButton key={b.id} pdfUrl={cardStickersUrl({ bag: b.id })} fileName={`${b.code}-card-stickers.pdf`}>
              {b.code} ({b.cardCount})
            </StickerPrintButton>
          ))}
        </div>
      )}
    </section>
  );
}
