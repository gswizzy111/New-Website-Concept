// Checks the catalog card staff picked on an admin card form before it is
// saved on the card (cards.catalog_card_id and cards.catalog_image_url, see
// supabase/migrations/20261118_card_catalog.sql). Server only.

import type { SupabaseClient } from "@supabase/supabase-js";
import { isCatalogCardId, isCatalogImageUrl } from "@/lib/card-catalog";

export type CatalogPickInput = { catalog_card_id?: unknown; catalog_image_url?: unknown };
export type CatalogPickFields = { catalog_card_id: string | null; catalog_image_url: string | null };

/** True when the body says something about the catalog link (a pick, or clearing it). */
export function mentionsCatalog(body: CatalogPickInput | null | undefined): boolean {
  return !!body && (body.catalog_card_id !== undefined || body.catalog_image_url !== undefined);
}

/**
 * The catalog fields to save for each pick, in order: null for a pick that
 * says nothing (leave the card as it is), both null to clear the link.
 * A picked card must be in the catalog, and its picture on one of the
 * catalog's picture hosts. If the catalog can't be read, the picks are left
 * out (the card itself still saves).
 */
export async function checkCatalogPicks(
  admin: SupabaseClient,
  picks: CatalogPickInput[],
): Promise<{ ok: true; fields: (CatalogPickFields | null)[] } | { ok: false; error: string }> {
  const ids = new Set<string>();
  for (const p of picks) {
    if (!mentionsCatalog(p)) continue;
    const id = p.catalog_card_id ?? null;
    const url = p.catalog_image_url ?? null;
    if (id === null) {
      if (url !== null) return { ok: false, error: "A reference photo needs its catalog card." };
      continue;
    }
    if (!isCatalogCardId(id)) return { ok: false, error: "That catalog card isn't valid." };
    if (url !== null && !isCatalogImageUrl(url)) return { ok: false, error: "That reference photo isn't from the card catalog." };
    ids.add(id);
  }

  let known = new Set<string>();
  let readable = true;
  if (ids.size > 0) {
    const { data, error } = await admin.from("card_catalog").select("id").in("id", [...ids]);
    if (error) {
      console.error("[card catalog] couldn't check picked cards:", error.message);
      readable = false;
    } else {
      known = new Set((data ?? []).map((r: { id: string }) => r.id));
      const missing = [...ids].find((id) => !known.has(id));
      if (missing) return { ok: false, error: "That card isn't in the card catalog any more. Search for it again." };
    }
  }

  return {
    ok: true,
    fields: picks.map((p) => {
      if (!mentionsCatalog(p)) return null;
      const id = (p.catalog_card_id ?? null) as string | null;
      if (id === null) return { catalog_card_id: null, catalog_image_url: null };
      if (!readable) return null;
      return { catalog_card_id: id, catalog_image_url: (p.catalog_image_url ?? null) as string | null };
    }),
  };
}

/** A database without the catalog columns yet (the migration not applied). */
export function missingCatalogColumns(error: { code?: string; message?: string } | null | undefined): boolean {
  if (!error) return false;
  return error.code === "42703" || error.code === "PGRST204" || /catalog_(card_id|image_url)/.test(error.message ?? "");
}
