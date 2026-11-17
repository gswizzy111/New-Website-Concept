"use client";

import { useEffect } from "react";
import type { CardEntry, CustomerInfo, InsuranceSelection, ShippingRate } from "@/lib/types";
import type { InsuranceElection } from "@/components/checkout/insurance-election";
import { getAllTiers, type RestorationTierId } from "@/lib/restoration-tiers";

/**
 * The restoration order builder's answers, kept in this tab (sessionStorage)
 * so "Return to Order Builder" on /checkout/cancel brings them back. Never the
 * signatures, consents or signing checkboxes: those are given again each time.
 * Cleared once an order is placed (/checkout/success).
 *
 * The cards step can also travel in a link (#resume=, below), so a customer
 * who leaves an in-app browser (Instagram, Facebook...) for Safari or Chrome
 * keeps the cards they entered.
 */
export interface SavedOrder {
  v: 1;
  /** The builder's ?tier= when this was saved; restored only on the same one */
  selectedTier: RestorationTierId | null;
  step: number;
  cards: CardEntry[];
  customer: CustomerInfo;
  shippingMethod: "buy_label" | "self_ship" | null;
  selectedRate: ShippingRate | null;
  customerNotes: string;
  affiliateCode: string;
  discountPercent: number;
  giftCardCode: string;
  giftCardAmountCents: number;
  tipCents: number;
  insuranceElection: InsuranceElection;
  insurance: InsuranceSelection;
  addSignatureConfirmation: boolean;
}

const KEY = "carddoc:order-builder:v1";

/** The answers kept in this tab, without looking at the address. */
function readStored(): SavedOrder | null {
  try {
    const raw = window.sessionStorage.getItem(KEY);
    if (!raw) return null;
    const saved = JSON.parse(raw) as SavedOrder;
    if (saved?.v !== 1 || !Array.isArray(saved.cards) || saved.cards.length === 0 || !saved.customer) return null;
    return saved;
  } catch {
    return null;
  }
}

/**
 * The saved builder answers, or null (none, unreadable, or storage blocked).
 * A #resume= link in the address comes first: its cards are restored (and
 * kept in this tab from then on) and it is taken out of the address.
 */
export function loadSavedOrder(): SavedOrder | null {
  return takeResumeLink() ?? readStored();
}

export function saveOrder(saved: SavedOrder): void {
  try {
    window.sessionStorage.setItem(KEY, JSON.stringify(saved));
  } catch {
    // Storage full or blocked: the builder still works, it just isn't kept
  }
}

export function clearSavedOrder(): void {
  try {
    window.sessionStorage.removeItem(KEY);
  } catch {
    // Nothing to clear
  }
}

/** Where "Return to Order Builder" goes: the builder on the saved tier. */
export function savedOrderHref(): string {
  const tier = readStored()?.selectedTier;
  return tier ? `/order?tier=${encodeURIComponent(tier)}` : "/order";
}

/** Rendered on the checkout success page: the order is placed, forget the answers. */
export function ClearSavedOrder(): null {
  useEffect(() => clearSavedOrder(), []);
  return null;
}

/* ------------------------------------------------------------------------ */
/* The resume link: #resume=<base64url JSON>                                 */
/* ------------------------------------------------------------------------ */

/**
 * Version 1 of the link data, with short keys so the link stays short. Only
 * the cards step: the tier, each card's name, identity fields, declared value,
 * tier and add-ons. Never contact details, addresses, emails, phone numbers,
 * notes, photos, signatures or consents.
 */
type ResumeCard = Partial<Record<(typeof TEXT_FIELDS)[number][0], string>> & {
  /** The card's own tier */
  t?: string;
  /** Slab cracking */
  x?: 1;
  /** Pregrade */
  p?: 1;
};
type Resume = { v: 1; t: string | null; c: ResumeCard[] };

/** Link key and CardEntry field for each text field carried. */
const TEXT_FIELDS = [
  ["n", "card_name"],
  ["e", "estimated_value"],
  ["s", "card_set"],
  ["y", "card_year"],
  ["u", "card_number"],
  ["r", "variation"],
  ["g", "grading_company"],
  ["d", "grade"],
  ["c", "cert_number"],
  ["k", "known_defects"],
] as const;
/** Kept when the full link would be too long. */
const LITE_FIELDS = new Set(["n", "e"]);

const RESUME_VERSION = 1;
/**
 * The longest #resume= value made or read (characters of base64url). The hash
 * never reaches the server; this keeps copied and intent links a sane length.
 */
const MAX_RESUME_CHARS = 8000;
const MAX_RESUME_CARDS = 50;
/** The longest text kept for any one field. */
const MAX_FIELD_CHARS = 300;
/** The last link applied in this tab, so a reload never puts older cards back. */
const RESUME_SEEN_KEY = "carddoc:order-builder:resume-seen";
/** Where lib/tracking-guard.ts parks a #resume= value it took out of the address (same key there). */
export const RESUME_PENDING_KEY = "carddoc:order-builder:resume-pending";

function toBase64Url(text: string): string {
  let bin = "";
  for (const b of new TextEncoder().encode(text)) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fromBase64Url(value: string): string {
  const b64 = value.replace(/-/g, "+").replace(/_/g, "/");
  const bin = atob(b64 + "===".slice((b64.length + 3) % 4));
  return new TextDecoder("utf-8", { fatal: true }).decode(Uint8Array.from(bin, (ch) => ch.charCodeAt(0)));
}

function encodeResume(saved: SavedOrder, lite: boolean): string {
  const cards = saved.cards.slice(0, MAX_RESUME_CARDS).map((card) => {
    const out: ResumeCard = {};
    for (const [key, field] of TEXT_FIELDS) {
      if (lite && !LITE_FIELDS.has(key)) continue;
      const value = (card[field] ?? "").trim().slice(0, MAX_FIELD_CHARS);
      if (value) out[key] = value;
    }
    if (card.tier) out.t = card.tier;
    if (card.needs_slab_crack) out.x = 1;
    if (card.needs_pregrade) out.p = 1;
    return out;
  });
  const resume: Resume = { v: RESUME_VERSION, t: saved.selectedTier, c: cards };
  return toBase64Url(JSON.stringify(resume));
}

/**
 * "#resume=..." for the cards kept in this tab, for a link that opens the
 * builder in another browser; null when there's nothing worth carrying or it
 * won't fit (then the link goes without it).
 */
export function resumeLinkHash(): string | null {
  const saved = readStored();
  if (!saved) return null;
  const entered = saved.cards.some(
    (c) => TEXT_FIELDS.some(([, field]) => (c[field] ?? "").trim() !== "") || c.needs_slab_crack || c.needs_pregrade,
  );
  if (!entered) return null;
  try {
    for (const lite of [false, true]) {
      const value = encodeResume(saved, lite);
      if (value.length <= MAX_RESUME_CHARS) return `#resume=${value}`;
    }
  } catch {
    // Can't encode here: the link goes without the cards
  }
  return null;
}

const TIER_IDS = new Set<string>(getAllTiers().map((t) => t.id));
const isText = (v: unknown): v is string => typeof v === "string";

/** The link data, or null when it is malformed in any way. */
function decodeResume(value: string): Resume | null {
  if (!value || value.length > MAX_RESUME_CHARS || !/^[A-Za-z0-9_-]+$/.test(value)) return null;
  let data: unknown;
  try {
    data = JSON.parse(fromBase64Url(value));
  } catch {
    return null;
  }
  if (!data || typeof data !== "object") return null;
  const { v, t, c } = data as Record<string, unknown>;
  if (v !== RESUME_VERSION) return null;
  if (t !== null && !(isText(t) && /^[a-z_]{1,40}$/.test(t))) return null;
  if (!Array.isArray(c) || c.length === 0 || c.length > MAX_RESUME_CARDS) return null;
  if (!c.every((card) => card && typeof card === "object" && !Array.isArray(card))) return null;
  return { v: RESUME_VERSION, t: t as string | null, c: c as ResumeCard[] };
}

function cardFromResume(r: ResumeCard): CardEntry {
  const text = (key: (typeof TEXT_FIELDS)[number][0]) => {
    const value = r[key];
    return isText(value) ? value.slice(0, MAX_FIELD_CHARS) : "";
  };
  return {
    id: crypto.randomUUID(),
    card_name: text("n"),
    card_set: text("s"),
    card_year: text("y"),
    card_number: text("u"),
    variation: text("r"),
    grading_company: text("g"),
    grade: text("d"),
    cert_number: text("c"),
    known_defects: text("k"),
    estimated_value: text("e"),
    notes: "",
    photo_urls: [],
    // The builder sends its own service with every card (order-builder-client.tsx)
    service_ids: [],
    tier: isText(r.t) && TIER_IDS.has(r.t) ? (r.t as RestorationTierId) : undefined,
    needs_slab_crack: r.x === 1 || undefined,
    needs_pregrade: r.p === 1 || undefined,
  };
}

/** Takes "resume=..." out of the address bar, keeping the rest of it. */
function stripResumeFromAddress(): void {
  try {
    const { pathname, search, hash } = window.location;
    const rest = hash.replace(/^#/, "").split("&").filter((part) => part && !part.startsWith("resume=")).join("&");
    // The current state is passed on as it is, so Next.js keeps its own
    window.history.replaceState(window.history.state, "", `${pathname}${search}${rest ? `#${rest}` : ""}`);
  } catch {
    // The address keeps it; the cards were still read
  }
}

/** The cards from a #resume= link in the address, as a fresh saved order on the cards step. */
function takeResumeLink(): SavedOrder | null {
  let value: string;
  try {
    const match = /^#(?:[^&]*&)*resume=([^&]*)/.exec(window.location.hash);
    if (match) {
      value = match[1];
      stripResumeFromAddress();
    } else {
      // The first script on the page (lib/tracking-guard.ts) usually moves the
      // link's cards here before analytics load, so they never reach them
      const w = window as unknown as { __resumePending?: string };
      let pending: string | null = w.__resumePending ?? null;
      delete w.__resumePending;
      try {
        pending = pending || window.sessionStorage.getItem(RESUME_PENDING_KEY);
        window.sessionStorage.removeItem(RESUME_PENDING_KEY);
      } catch {
        // Storage blocked: the page variable is all there is
      }
      if (!pending) return null;
      value = pending;
    }
  } catch {
    return null;
  }
  try {
    // Already applied in this tab: what's kept here is newer
    if (window.sessionStorage.getItem(RESUME_SEEN_KEY) === value) return null;
  } catch {
    // Storage blocked: apply it
  }
  const resume = decodeResume(value);
  if (!resume) return null;
  try {
    window.sessionStorage.setItem(RESUME_SEEN_KEY, value);
  } catch {
    // Storage blocked
  }
  const saved: SavedOrder = {
    v: 1,
    selectedTier: resume.t as RestorationTierId | null,
    step: 1,
    cards: resume.c.map(cardFromResume),
    customer: { name: "", email: "", phone: "", street1: "", street2: "", city: "", state: "", zip: "", country: "US" },
    shippingMethod: null,
    selectedRate: null,
    customerNotes: "",
    affiliateCode: "",
    discountPercent: 0,
    giftCardCode: "",
    giftCardAmountCents: 0,
    tipCents: 0,
    insuranceElection: null,
    insurance: { declaredValueCents: 0, type: "none", chargeCents: 0 },
    addSignatureConfirmation: false,
  };
  saveOrder(saved);
  return saved;
}
