// The card catalog (supabase/migrations/20261118_card_catalog.sql): every
// English and Japanese Pokémon card with a link to its picture, so staff can
// pick the exact card when they enter one in the admin (components/admin/
// card-picker.tsx). Admin only: nothing customer-facing reads it.
//
// Shared by the server and the card picker, so nothing here may import
// server code. The sync lives in lib/card-catalog-sync.ts.

/** One card as the search returns it (search_card_catalog() in the migration). */
export type CatalogCard = {
  id: string;
  lang: "en" | "ja";
  set_id: string;
  set_name: string;
  series: string | null;
  release_date: string | null;
  number: string;
  printed_total: string | null;
  name: string;
  name_en: string | null;
  rarity: string | null;
  image_small: string | null;
  image_large: string | null;
};

/**
 * The only places catalog pictures come from. We link to them and never copy
 * them (they are © Nintendo / The Pokémon Company), and staff see them only as
 * a reference. The cards.catalog_image_url check in the migration lists the
 * same hosts: change both together.
 */
export const CATALOG_IMAGE_HOSTS = ["assets.tcgdex.net", "images.pokemontcg.io"] as const;

/** A catalog picture link we accept: https on one of CATALOG_IMAGE_HOSTS. */
export function isCatalogImageUrl(url: unknown): url is string {
  if (typeof url !== "string" || url.length > 300) return false;
  try {
    const u = new URL(url);
    return u.protocol === "https:" && !u.username && !u.password && !u.port
      && (CATALOG_IMAGE_HOSTS as readonly string[]).includes(u.hostname);
  } catch {
    return false;
  }
}

/** Catalog ids look like "tcgdex:en:swsh3-136" (source, language, the source's card id). */
export function isCatalogCardId(id: unknown): id is string {
  return typeof id === "string" && id.length <= 120 && /^tcgdex:(en|ja):\S+$/.test(id);
}

/** The search box accepts 2 to 80 characters. */
export const SEARCH_MIN = 2;
export const SEARCH_MAX = 80;

/**
 * Text as the catalog stores it for searching: full-width letters and digits
 * made plain, accents dropped (Pokémon → pokemon), apostrophes dropped
 * (Farfetch'd → farfetchd), lower case, single spaces. Japanese kana keep
 * their voicing marks. The sync builds card_catalog.search with this and the
 * search route cleans the query with it, so both sides match.
 */
export function normalizeCatalogText(s: string): string {
  return s
    .normalize("NFKC")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .normalize("NFC")
    .toLowerCase()
    .replace(/[‘’'`]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/** The number as printed on the card: "4/102", or "SWSH001" for a promo. */
export function catalogNumber(card: Pick<CatalogCard, "number" | "printed_total">): string {
  return card.printed_total ? `${card.number}/${card.printed_total}` : card.number;
}

export function catalogYear(card: Pick<CatalogCard, "release_date">): string | null {
  return card.release_date ? card.release_date.slice(0, 4) : null;
}

/** "リザードンex (Charizard)" for a Japanese card with a known English name. */
export function catalogDisplayName(card: Pick<CatalogCard, "name" | "name_en" | "lang">): string {
  return card.lang === "ja" && card.name_en && card.name_en !== card.name ? `${card.name} (${card.name_en})` : card.name;
}

/** A small version of a catalog picture, for thumbnails (the large one stays the link). */
export function catalogThumb(url: string): string {
  if (url.startsWith("https://assets.tcgdex.net/")) return url.replace(/\/high\.(webp|png|jpg)$/, "/low.$1");
  if (url.startsWith("https://images.pokemontcg.io/")) return url.replace(/_hires\.png$/, ".png");
  return url;
}

/** What picking a card fills in on the admin card forms. */
export function catalogFormFields(card: CatalogCard) {
  const year = catalogYear(card);
  return {
    card_name: catalogDisplayName(card),
    card_set: card.lang === "ja" ? `${card.set_name} (Japanese)` : card.set_name,
    card_year: year ?? "",
    card_number: catalogNumber(card),
    catalog_card_id: card.id,
    catalog_image_url: card.image_large ?? card.image_small ?? null,
  };
}
