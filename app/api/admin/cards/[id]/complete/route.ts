import { createAdminClient } from "@/lib/supabase/admin";
import { getAdminSession, isAdmin } from "@/lib/admin-auth";
import { toggleCardCompletion } from "@/lib/intake/card-completion";

/**
 * POST (no body) → { completed, orderCompletion?, bagPlaces? }
 * Toggles the card's Done and refreshes its tier bag. A card just marked done
 * goes back in its bag, out of any holder or desk (lib/intake/card-completion.ts);
 * `bagPlaces` (TrackBagPlace[]) says where its bag is ("Put it back in
 * REYES's bag: Open bags box, under R."). When this marked the order's last
 * non-refunded card done, the order becomes Completed with the customer's
 * usual email (lib/intake/order-autocomplete.ts); `orderCompletion` is that
 * check's result (`completed`, `emailed`, `message`). Both are present only
 * when the card was just marked done.
 */
export async function POST(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  if (!(await isAdmin())) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  const by = (await getAdminSession())?.username ?? null;
  const result = await toggleCardCompletion(createAdminClient(), { cardId: id, by });
  if (!result.ok) return Response.json({ error: result.error }, { status: result.status });

  return Response.json({
    completed: result.completed,
    ...(result.orderCompletion ? { orderCompletion: result.orderCompletion } : {}),
    ...(result.bagPlaces ? { bagPlaces: result.bagPlaces } : {}),
  });
}
