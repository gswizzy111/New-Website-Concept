import { PartyPopper } from "lucide-react";
import Link from "next/link";
import { PurchasePixel } from "@/components/purchase-pixel";
import { readCheckoutReturn } from "@/lib/checkout-return";

export default async function GiftCardSuccessPage({
  searchParams,
}: {
  searchParams: Promise<{ session_id?: string }>;
}) {
  // Stripe's ?session_id=, for the Meta Purchase event (lib/checkout-return.ts)
  const { sessionId, amountCents, currency } = await readCheckoutReturn(
    (await searchParams).session_id,
    "Gift card success page",
  );
  return (
    <div className="min-h-screen bg-paper flex items-center justify-center px-6">
      <PurchasePixel sessionId={sessionId} amountCents={amountCents} currency={currency} />
      <div className="max-w-md w-full text-center">
        <div className="mx-auto mb-6 flex h-16 w-16 items-center justify-center rounded-lg bg-rx-soft text-rx"><PartyPopper className="h-8 w-8" strokeWidth={1.75} /></div>
        <h1 className="font-heading text-3xl font-bold text-foreground mb-3">Gift Card Purchased!</h1>
        <p className="text-muted-foreground mb-8">
          The gift card code has been emailed. It can be applied at checkout on any restoration order.
        </p>
        <div className="flex flex-col sm:flex-row gap-3 justify-center">
          <Link
            href="/gift-cards"
            className="px-6 py-3 bg-primary text-white font-semibold rounded-lg hover:bg-primary/90 transition-colors"
          >
            Buy Another
          </Link>
          <Link
            href="/"
            className="px-6 py-3 bg-secondary text-foreground font-semibold rounded-lg hover:bg-border transition-colors"
          >
            Back to Home
          </Link>
        </div>
      </div>
    </div>
  );
}
