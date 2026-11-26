import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Who took which receiving photo (card_photo_events, insert-only, from
 * 20261126_workshop_users.sql): one row per photo added, replaced or
 * removed on a card, with the username of whoever did it. Written after the
 * photo itself is saved and never in its way: a failure (say, before the
 * migration is applied) is logged, and the photo stays.
 */
export type PhotoEvent = {
  cardId: string;
  orderId: string | null;
  action: "add" | "replace" | "remove";
  url: string;
  /** replace: the photo it took the place of */
  oldUrl?: string | null;
  by: string | null;
};

/** The events for a change from `before` to `after` (adds and removes; a replace when one swapped in place). */
export function photoChanges(before: readonly string[], after: readonly string[]): { action: PhotoEvent["action"]; url: string; oldUrl?: string }[] {
  const added = after.filter((u) => !before.includes(u));
  const removed = before.filter((u) => !after.includes(u));
  if (added.length === 1 && removed.length === 1 && before.length === after.length) {
    return [{ action: "replace", url: added[0], oldUrl: removed[0] }];
  }
  return [...added.map((url) => ({ action: "add" as const, url })), ...removed.map((url) => ({ action: "remove" as const, url }))];
}

export async function logPhotoEvents(admin: SupabaseClient, events: readonly PhotoEvent[]): Promise<void> {
  if (!events.length) return;
  try {
    const { error } = await admin.from("card_photo_events").insert(events.map((e) => ({
      card_id: e.cardId,
      order_id: e.orderId,
      action: e.action,
      photo_url: e.url,
      old_photo_url: e.oldUrl ?? null,
      by: e.by,
    })));
    if (error) console.error("[receiving photos] who took the photo wasn't logged:", error.message);
  } catch (e) {
    console.error("[receiving photos] who took the photo wasn't logged:", e instanceof Error ? e.message : e);
  }
}
