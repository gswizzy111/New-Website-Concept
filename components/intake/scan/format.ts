import type { TrackCardSummary, TrackLocation } from "@/lib/intake/tracking/types";
import { dayText } from "@/lib/intake/tracking-format";
import { isDeskCode } from "@/lib/intake/tracking/desk-codes";
import { isOpenBagsPlace } from "@/lib/intake/tracking/bag-home";

/**
 * Short wording for the Scan page. Pure (safe in client components and tests).
 */

/** How long ago, short: "just now", "12 min", "2 h", "3 d". */
export function sinceText(iso: string | null | undefined, now: number): string | null {
  if (!iso) return null;
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return null;
  const min = Math.max(0, Math.floor((now - t) / 60_000));
  if (min < 1) return "just now";
  if (min < 60) return `${min} min`;
  const h = Math.floor(min / 60);
  if (h < 48) return `${h} h`;
  return `${Math.floor(h / 24)} d`;
}

/** Where a card is: "CLAMP 07 · Clamp Work · 2 h", or "Not in a slot". */
export function whereLine(card: Pick<TrackCardSummary, "location" | "locatedAt" | "stageLabel">, now: number): string {
  if (!card.location) return "Not in a slot";
  return [card.location.name, card.stageLabel, sinceText(card.locatedAt, now)].filter(Boolean).join(" · ");
}

/**
 * Under a slot's big name: "Clamp · step: Clamp Work", "Shelf for cards due Mon, Dec 7, 2026", "Finished cards",
 * "Desk · cards keep their step" (a desk: an 'other' place coded LOC-DESK or LOC-DESK-<NAME>, isDeskCode in
 * lib/intake/tracking/desk-codes.ts), "Bags with a card out, A-Z by last name" (the Open bags box).
 */
export function placeSubtitle(place: Pick<TrackLocation, "kind" | "stationName" | "stageLabel" | "dueDate"> & { code?: string | null }): string {
  if (place.kind === "other" && isDeskCode(place.code)) return "Desk · cards keep their step";
  if (place.code && isOpenBagsPlace({ code: place.code })) return "Bags with a card out, A-Z by last name";
  if (place.kind === "station") {
    return [place.stationName, place.stageLabel ? `step: ${place.stageLabel}` : null].filter(Boolean).join(" · ") || "Work station";
  }
  if (place.kind === "shelf") return place.dueDate ? `Shelf for cards due ${dayText(place.dueDate)}` : "Shelf";
  if (place.kind === "done") return "Finished cards";
  if (place.kind === "shipping") return "Shipping";
  return "Place";
}

/** How many more cards fit (Infinity when there's no limit). */
export function roomLeft(capacity: number | null | undefined, cardCount: number): number {
  return capacity == null ? Infinity : Math.max(0, capacity - cardCount);
}

/** "Empty", "1 card", "Full (1 of 1)", "2 of 3 cards". */
export function fillText(capacity: number | null | undefined, cardCount: number): string {
  if (cardCount === 0) return "Empty";
  const cards = `${cardCount} card${cardCount === 1 ? "" : "s"}`;
  if (capacity == null) return cards;
  if (cardCount >= capacity) return cardCount > capacity ? `Over full (${cardCount} of ${capacity})` : `Full (${cardCount} of ${capacity})`;
  return `${cardCount} of ${capacity} cards`;
}

/** "Card ID · name" for one card, or "3 cards" for several (messages and prompts). */
export function cardsLabel(cards: readonly Pick<TrackCardSummary, "code" | "name">[]): string {
  if (cards.length === 1) return cards[0].code ?? cards[0].name ?? "the card";
  return `${cards.length} cards`;
}
