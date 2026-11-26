import { z } from "zod";
import { createAdminClient } from "@/lib/supabase/admin";
import { adminOrWorkshopActor } from "@/lib/admin-auth";
import { isOurCardPhoto, MAX_RECEIVING_PHOTOS } from "@/lib/intake/photos";
import { UUID, smallJson } from "../../../orders/guard";
import { logPhotoEvents, photoChanges } from "@/lib/intake/photo-log";

/**
 * A card's receiving photos (cards.receiving_photo_urls): add, replace or
 * remove one. The customer's own photos (cards.photo_urls) are never touched.
 * Only photos /api/upload stored in our card-photos bucket are accepted.
 * Full admins and workshop logins; who took or removed each photo is kept in
 * card_photo_events (lib/intake/photo-log.ts).
 *
 * POST { action: "add", urls: string[] }
 *    | { action: "replace", old: string, url: string }
 *    | { action: "remove", url: string }
 * → 200 { receiving_photo_urls: string[] } | 4xx/5xx { error }
 */
const Url = z.string().max(500).refine(isOurCardPhoto, "Only photos uploaded here can be added.");
const Body = z.discriminatedUnion("action", [
  z.object({ action: z.literal("add"), urls: z.array(Url).min(1).max(MAX_RECEIVING_PHOTOS) }),
  z.object({ action: z.literal("replace"), old: z.string().max(500), url: Url }),
  z.object({ action: z.literal("remove"), url: z.string().max(500) }),
]);
type Body = z.infer<typeof Body>;

// Postgres text[] literal, every element quoted, for the "unchanged since we read it" check
function pgArray(values: string[]) {
  return `{${values.map((v) => `"${v.replace(/["\\]/g, (c) => `\\${c}`)}"`).join(",")}}`;
}

function apply(current: string[], body: Body): { next: string[] } | { error: string; status: number } {
  if (body.action === "add") {
    const fresh = [...new Set(body.urls)].filter((u) => !current.includes(u));
    const next = [...current, ...fresh];
    if (next.length > MAX_RECEIVING_PHOTOS) {
      return { error: `A card can have ${MAX_RECEIVING_PHOTOS} receiving photos. Remove one first.`, status: 400 };
    }
    return { next };
  }
  if (body.action === "replace") {
    const i = current.indexOf(body.old);
    if (i < 0) return { error: "That photo is no longer on the card. Reload the page.", status: 409 };
    const next = [...current];
    next[i] = body.url;
    return { next: [...new Set(next)] };
  }
  if (!current.includes(body.url)) return { next: current };
  return { next: current.filter((u) => u !== body.url) };
}

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const actor = await adminOrWorkshopActor();
  if (!actor) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;
  if (!UUID.test(id)) return Response.json({ error: "Card not found" }, { status: 404 });

  const parsed = Body.safeParse(await smallJson(req));
  if (!parsed.success) {
    return Response.json({ error: parsed.error.issues[0]?.message ?? "Invalid request" }, { status: 400 });
  }

  const admin = createAdminClient();
  // Read, change and write back only if nobody changed the list meanwhile (a few tries)
  for (let attempt = 0; attempt < 3; attempt++) {
    const { data: card, error: readError } = await admin
      .from("cards")
      .select("id, order_id, receiving_photo_urls")
      .eq("id", id)
      .maybeSingle();
    if (readError) {
      if (/receiving_photo_urls/.test(readError.message)) {
        return Response.json({ error: "Receiving photos need the intake database update first (20261123_intake_tracking.sql)." }, { status: 503 });
      }
      return Response.json({ error: readError.message }, { status: 500 });
    }
    if (!card) return Response.json({ error: "Card not found" }, { status: 404 });

    const current = ((card.receiving_photo_urls as string[] | null) ?? []).filter(Boolean);
    const result = apply(current, parsed.data);
    if ("error" in result) return Response.json({ error: result.error }, { status: result.status });
    if (JSON.stringify(result.next) === JSON.stringify(current)) {
      return Response.json({ receiving_photo_urls: current });
    }

    const { data: updated, error } = await admin
      .from("cards")
      .update({ receiving_photo_urls: result.next })
      .eq("id", id)
      .filter("receiving_photo_urls", "eq", pgArray(current))
      .select("receiving_photo_urls");
    if (error) return Response.json({ error: error.message }, { status: 500 });
    if (updated && updated.length > 0) {
      const saved = (updated[0].receiving_photo_urls as string[] | null) ?? result.next;
      await logPhotoEvents(admin, photoChanges(current, saved).map((c) => ({
        ...c, cardId: id, orderId: (card.order_id as string | null) ?? null, by: actor.by,
      })));
      return Response.json({ receiving_photo_urls: saved });
    }
    // Someone else saved a photo for this card at the same moment: read again
  }
  return Response.json({ error: "The card's photos changed while saving. Try again." }, { status: 409 });
}
