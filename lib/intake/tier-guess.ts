import { TIER_NAMES, TIER_ORDER, normalizeTier, tierDisplayName } from "@/lib/intake/codes";
import { RESTORATION_TIERS, type RestorationTierId } from "@/lib/restoration-tiers";

/**
 * The best guess of a card's tier for "Print labels" (pure; safe in client
 * components and tests). In order:
 *
 *   1. cards.tier                                         sure
 *   2. orders.restoration_tier                            sure
 *   3. the signed record: the master signature's card
 *      list (lib/checkout-signing.ts authorizedOrderText:
 *      "Gold - Full Restoration & PSA Prep", "Grading
 *      prep") or the signed show drop-off form            sure
 *   4. what was paid for the card itself
 *      (cards.service_price_cents) against the tier prices  likely, when it is exactly one tier's price
 *   5. what was paid: order_services lines and the old
 *      site's "Checkout session created — mixed tiers:"
 *      event, worked out against the tier prices and each
 *      card's declared value (the tier caps)               likely, when only one tier fits the card
 *   6. the card's name says "Prep"                        likely
 *   7. otherwise                                          unknown (a best guess may still be offered)
 *
 * Only 1-3 are "sure": staff confirm every other guess with one tap.
 *
 * Production, Nov 24 2026: none of the 38 open orders without any tier has a
 * signed record (they predate it or were entered by hand), so 3 resolves
 * nothing there today; 4 resolves the old site's mixed-tier checkouts.
 */

/** "sure": recorded (card, order, signed); "likely": what was paid fits one tier (or the name says Prep); "unknown": nothing decides it. */
export type TierConfidence = "sure" | "likely" | "unknown";

/** Where a guess came from. Tier questions only ever show signed, price or name (or null when unknown). */
export type TierGuessSource = "card" | "order" | "signed" | "price" | "name";

export type TierGuess = {
  /** The tier to preselect (stored key), or null when nothing points anywhere. */
  tier: string | null;
  confidence: TierConfidence;
  source: TierGuessSource | null;
  /** One plain sentence for staff. */
  why: string;
};

export type GuessCard = {
  id: string;
  card_name: string | null;
  card_set?: string | null;
  card_number?: string | null;
  card_year?: string | null;
  estimated_value_cents?: number | null;
  /** What was paid for this card's service (cards.service_price_cents), when recorded. */
  service_price_cents?: number | null;
  tier: string | null;
};

/** One card of a signed record (a master signature's card list, or a show drop-off form). */
export type SignedCard = {
  via: "checkout" | "dropoff";
  name: string;
  set?: string | null;
  number?: string | null;
  year?: string | null;
  valueCents?: number | null;
  tier: string | null;
};

export type ServiceLine = { service_id: string | null; service_name: string | null; price_cents: number | null; quantity: number | null };

/** A tier's prices: the admin's current one and the built-in one (so older orders still match), or a rate (Diamond). */
export type TierPricing = { tier: string; prices: number[]; rate: number | null; minValueCents: number | null; maxValueCents: number | null };

export type GuessInput = {
  orderTier: string | null;
  /** Every card of the order (refunded ones too: they were paid for). */
  cards: GuessCard[];
  signed: SignedCard[];
  services: ServiceLine[];
  /** order_events descriptions of type checkout_initiated and manual_order_created. */
  checkoutEvents: string[];
  /** orders.subtotal_cents: what the cards cost, read only when the order has no service lines (the old site's mixed checkouts). */
  subtotalCents?: number | null;
  pricing: TierPricing[];
  tierNames?: Readonly<Record<string, string>>;
};

const RESTORATION_KEYS = Object.keys(RESTORATION_TIERS) as RestorationTierId[];

// ── Building the inputs ─────────────────────────────────────────────────────

/**
 * The price table: each restoration tier's admin price (restoration_settings)
 * and its built-in price (lib/restoration-tiers.ts; Bronze was $75.00 and
 * Platinum $150.00 before the $74.99 / $149.99 prices), Diamond's rate and
 * minimum, and the value caps (Terms 9.2).
 */
export function tierPricing(settings: readonly { tier: string; price_cents?: number | null; pricing_rate?: number | string | null; min_card_value_cents?: number | null }[]): TierPricing[] {
  const byTier = new Map(settings.map((s) => [s.tier, s]));
  return RESTORATION_KEYS.map((id) => {
    const t = RESTORATION_TIERS[id];
    const s = byTier.get(id);
    const percentage = t.pricing_type === "percentage";
    const prices = percentage ? [] : [...new Set([s?.price_cents, t.price_cents].filter((p): p is number => typeof p === "number" && p > 0))];
    const rate = percentage ? Number(s?.pricing_rate ?? t.pricing_rate ?? 0) || null : null;
    return { tier: id, prices, rate, minValueCents: s?.min_card_value_cents ?? t.min_card_value_cents ?? null, maxValueCents: t.max_card_value_cents };
  });
}

const norm = (s: string | null | undefined) => (s ?? "").toLowerCase().replace(/\s+/g, " ").trim();

/** "Gold" / "fast pass" / "premium" -> the stored tier key (built-in or display names), else null. */
export function tierFromName(name: string, names?: Readonly<Record<string, string>>): string | null {
  const n = norm(name);
  if (!n) return null;
  if (n === "prep" || n === "psa prep" || n === "grading prep") return "prep";
  const key = normalizeTier(n.replace(/ /g, "_"));
  if (key && (TIER_NAMES[key] || key === "prep")) return key;
  for (const [k, v] of [...Object.entries(names ?? {}), ...Object.entries(TIER_NAMES)]) {
    if (norm(v) === n) return normalizeTier(k);
  }
  return null;
}

/**
 * The tiers a service line names: "Gold - Full Restoration & PSA Prep",
 * "Gold + Silver - Full Restoration & PSA Prep" (a mixed checkout's one line),
 * "Gold Restoration", "Gold - Full Restoration & PSA Prep (added card)",
 * "Grading prep" / "PSA Prep" (prep). `null`: a restoration with no tier
 * ("Full Restoration & PSA Prep" before tiers, "Manual Restoration Order").
 * `undefined`: not a restoration or prep line (pregrade, slab, Instagram...).
 */
export function tiersOfService(name: string | null | undefined, serviceId?: string | null, names?: Readonly<Record<string, string>>): string[] | null | undefined {
  const id = normalizeTier(serviceId);
  if (id && (TIER_NAMES[id] || id === "prep")) return [id];
  const n = (name ?? "").trim();
  const full = /^(.+?)\s+-\s+full restoration\b/i.exec(n);
  if (full) {
    const tiers = full[1].split(/\s*\+\s*/).map((p) => tierFromName(p, names));
    return tiers.every((t): t is string => !!t) ? [...new Set(tiers)] : null;
  }
  const short = /^(.+?)\s+restoration\b/i.exec(n);
  if (short) {
    const t = tierFromName(short[1], names);
    if (t) return [t];
  }
  if (/restoration/i.test(n)) return null;
  if (/^(psa |grading )?prep\b/i.test(n)) return ["prep"];
  return undefined;
}

/** The signed cards of a master signature: its card_snapshot (AuthorizedOrder), else its document text. */
export function signedCardsFromSignature(cardSnapshot: unknown, documentText: string | null | undefined, names?: Readonly<Record<string, string>>): SignedCard[] {
  const snap = cardSnapshot as { cards?: unknown } | null | undefined;
  if (snap && Array.isArray(snap.cards)) {
    return snap.cards.flatMap((raw): SignedCard[] => {
      const c = raw as { card_name?: unknown; card_set?: unknown; card_number?: unknown; card_year?: unknown; declared_value_cents?: unknown; services?: unknown };
      if (typeof c.card_name !== "string") return [];
      const services = Array.isArray(c.services) ? (c.services as { name?: unknown }[]) : [];
      const tiers = [...new Set(services.flatMap((s) => tiersOfService(typeof s.name === "string" ? s.name : "", null, names) ?? []))];
      return [{
        via: "checkout",
        name: c.card_name,
        set: typeof c.card_set === "string" ? c.card_set : null,
        number: typeof c.card_number === "string" ? c.card_number : null,
        year: typeof c.card_year === "string" ? c.card_year : null,
        valueCents: typeof c.declared_value_cents === "number" ? c.declared_value_cents : null,
        tier: tiers.length === 1 ? tiers[0] : null,
      }];
    });
  }
  // Fallback: the "## Services authorized on order" text, card by card
  const text = documentText ?? "";
  const start = text.indexOf("## Services authorized on order");
  if (start < 0) return [];
  const out: SignedCard[] = [];
  const blocks = text.slice(start).split(/\n\n+/);
  for (let i = 0; i < blocks.length; i++) {
    const head = /^Card \d+: (.+?)\.(?: Holder: .*?\.)? Declared value: (not given|-?\$[\d,]+\.\d{2})\./.exec(blocks[i]);
    if (!head) continue;
    const lines = blocks[i + 1]?.startsWith("- ") ? blocks[i + 1].split("\n") : [];
    const tiers = [...new Set(lines.flatMap((l) => tiersOfService(l.replace(/^- /, "").replace(/: -?\$[\d,]+\.\d{2}$/, ""), null, names) ?? []))];
    const value = head[2] === "not given" ? null : Math.round(Number(head[2].replace(/[$,]/g, "")) * 100);
    out.push({ via: "checkout", name: head[1], valueCents: value, tier: tiers.length === 1 ? tiers[0] : null });
  }
  return out;
}

/** The cards of a signed show drop-off form (show_dropoffs.cards / .tiers). */
export function signedCardsFromDropoff(row: { tiers: string[] | null; cards: unknown }): SignedCard[] {
  const only = row.tiers?.length === 1 ? normalizeTier(row.tiers[0]) : null;
  const cards = Array.isArray(row.cards) ? (row.cards as { name?: unknown; service?: unknown }[]) : [];
  return cards.flatMap((c): SignedCard[] => typeof c.name === "string"
    ? [{ via: "dropoff", name: c.name, tier: normalizeTier(typeof c.service === "string" ? c.service : null) ?? only }]
    : []);
}

// ── Guessing ────────────────────────────────────────────────────────────────

const usd = (cents: number) => `$${(cents / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const byRank = (a: string, b: string) => TIER_ORDER.indexOf(a) - TIER_ORDER.indexOf(b);

function joinNames(parts: string[]): string {
  if (parts.length <= 1) return parts.join("");
  return `${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1]}`;
}

/**
 * Signed cards matched ONE-TO-ONE to the order's cards by name (then declared
 * value, set and number). Cards that already have a tier (their own or the
 * order's) claim their signed entries first (the one with their tier, else
 * the closest), so a card added later under the same name never inherits
 * another card's signature. An untiered card is matched only when the signed
 * entries left under its name are at least as many as the order's untiered
 * cards with that name, and its closest entries all name one tier.
 */
function signedTiers(cards: GuessCard[], tierOf: (c: GuessCard) => string | null, signed: SignedCard[]): Map<string, SignedCard> {
  const out = new Map<string, SignedCard>();
  const pool = signed.filter((s) => s.tier).map((s) => ({ s, used: false }));
  type Entry = (typeof pool)[number];
  // Free entries under the card's name (text records hold the full title: "1999 Base Set Charizard #4")
  const named = (c: GuessCard): Entry[] => {
    const name = norm(c.card_name);
    if (!name) return [];
    const free = pool.filter((p) => !p.used);
    const exact = free.filter((p) => norm(p.s.name) === name);
    return exact.length ? exact : free.filter((p) => p.s.via === "checkout" && p.s.set === undefined && norm(p.s.name).includes(name));
  };
  // The closest of them: same declared value, then same set and number
  const closest = (c: GuessCard, m: Entry[]): Entry[] => {
    if (m.length > 1 && c.estimated_value_cents != null) {
      const sameValue = m.filter((p) => p.s.valueCents === c.estimated_value_cents);
      if (sameValue.length) m = sameValue;
    }
    if (m.length > 1) {
      const same = m.filter((p) => (p.s.set == null || norm(p.s.set) === norm(c.card_set)) && (p.s.number == null || norm(p.s.number) === norm(c.card_number)));
      if (same.length) m = same;
    }
    return m;
  };
  for (const c of cards) {
    const t = tierOf(c);
    if (!t) continue;
    const m = closest(c, named(c));
    const pick = m.find((p) => normalizeTier(p.s.tier) === t) ?? m[0];
    if (pick) pick.used = true;
  }
  const groups = new Map<string, GuessCard[]>();
  for (const c of cards) {
    const name = norm(c.card_name);
    if (!name || tierOf(c)) continue;
    groups.set(name, [...(groups.get(name) ?? []), c]);
  }
  for (const group of groups.values()) {
    if (named(group[0]).length < group.length) continue;
    for (const c of group) {
      const m = closest(c, named(c));
      if (!m.length || new Set(m.map((p) => p.s.tier)).size !== 1) continue;
      m[0].used = true;
      out.set(c.id, m[0].s);
    }
  }
  return out;
}

type Row = { tiers: string[] | null; price: number; qty: number };

/** Restoration / prep lines of the order (add-ons dropped). */
function serviceRows(services: ServiceLine[], events: string[], subtotal: number | null | undefined, names?: Readonly<Record<string, string>>): Row[] {
  const rows: Row[] = [];
  for (const s of services) {
    const tiers = tiersOfService(s.service_name, s.service_id, names);
    if (tiers === undefined) continue;
    rows.push({ tiers, price: s.price_cents ?? 0, qty: Math.max(1, s.quantity ?? 1) });
  }
  if (!rows.length) {
    // A hand-made order's own record: "Manual order created — 3 cards @ $75.00/card"
    for (const e of events) {
      const m = /(\d+) cards? @ \$([\d,]+(?:\.\d{2})?)\/card/.exec(e);
      if (m) rows.push({ tiers: null, price: Math.round(Number(m[2].replace(/,/g, "")) * 100), qty: Number(m[1]) });
    }
  }
  // No line at all: the order's subtotal, over the tiers its checkout event lists
  if (!rows.length && subtotal && subtotal > 0) rows.push({ tiers: eventTiers(events), price: subtotal, qty: 1 });
  return rows;
}

/** The tiers the old site's checkout event lists ("— tier: premium", "— mixed tiers: regular, premium"). */
function eventTiers(events: string[]): string[] | null {
  const out = new Set<string>();
  for (const e of events) {
    const m = /(?:mixed tiers|tier): ([a-z_, ]+)$/i.exec(e.trim());
    if (!m) continue;
    for (const t of m[1].split(",")) {
      const k = normalizeTier(t.trim());
      if (k && (TIER_NAMES[k] || k === "prep")) out.add(k);
    }
  }
  return out.size ? [...out] : null;
}

function fits(p: TierPricing | undefined, value: number | null | undefined): boolean {
  if (!p) return true;
  if (value == null) return p.rate == null;
  if (p.minValueCents != null && value < p.minValueCents) return false;
  if (p.maxValueCents != null && value > p.maxValueCents) return false;
  return true;
}

/** Every way to split `total` cards into `parts` groups of at least one (null past `cap`). */
function compositions(total: number, parts: number, cap = 5000): number[][] | null {
  const out: number[][] = [];
  const walk = (left: number, k: number, acc: number[]): boolean => {
    if (k === 1) {
      out.push([...acc, left]);
      return out.length <= cap;
    }
    for (let first = 1; first <= left - (k - 1); first++) if (!walk(left - first, k - 1, [...acc, first])) return false;
    return true;
  };
  if (parts < 1 || total < parts) return [];
  return walk(total, parts, []) ? out : null;
}

function* priceCombos(tiers: string[], pricing: Map<string, TierPricing>): Generator<Record<string, number>> {
  const fixed = tiers.filter((t) => pricing.get(t)?.rate == null);
  const lists = fixed.map((t) => pricing.get(t)?.prices ?? []);
  if (lists.some((l) => !l.length)) return;
  const idx = fixed.map(() => 0);
  for (;;) {
    yield Object.fromEntries(fixed.map((t, i) => [t, lists[i][idx[i]]]));
    let i = 0;
    while (i < idx.length && ++idx[i] >= lists[i].length) idx[i++] = 0;
    if (i === idx.length) return;
  }
}

/**
 * A way the paid lines can be split over tiers: cards per tier, and the amount
 * left for Diamond cards (priced by value). `label` ("4 Gold and 2 Silver") is
 * built on first read: a mixed checkout can have thousands of splits.
 */
type Split = { counts: Record<string, number>; rateAmount: number | null; readonly label: string };

function split(counts: Record<string, number>, rateAmount: number | null, describe: (counts: Record<string, number>) => string): Split {
  let label: string | undefined;
  return {
    counts,
    rateAmount,
    get label() {
      return (label ??= describe(counts));
    },
  };
}

/**
 * The tier splits the paid lines allow, for `n` cards. Lines naming one tier
 * give that tier's count (quantity); the one line naming several tiers (the
 * old site's mixed checkout) or none ("Full Restoration & PSA Prep") is split
 * every way whose prices add up to what was paid. Null: the lines can't be
 * read as counts (e.g. they cover more or fewer cards than the order has).
 */
function splits(rows: Row[], n: number, setTiers: string[] | null, pricing: Map<string, TierPricing>, names?: Readonly<Record<string, string>>): Split[] | null {
  if (!rows.length) return null;
  const fixed: Record<string, number> = {};
  const lumps = rows.filter((r) => !(r.tiers && r.tiers.length === 1));
  for (const r of rows) if (r.tiers && r.tiers.length === 1) fixed[r.tiers[0]] = (fixed[r.tiers[0]] ?? 0) + r.qty;
  const fixedCount = Object.values(fixed).reduce((a, b) => a + b, 0);
  const describe = (counts: Record<string, number>) =>
    joinNames(Object.entries(counts).filter(([, c]) => c > 0).sort(([a], [b]) => byRank(a, b)).map(([t, c]) => `${c} ${tierDisplayName(t, names)}`));
  if (!lumps.length) return fixedCount === n ? [split(fixed, null, describe)] : null;
  if (lumps.length > 1) return null;
  const lump = lumps[0];
  const m = n - fixedCount;
  if (m < 1 || (lump.qty > 1 && lump.qty !== m)) return null;
  const amounts = [...new Set([lump.price * lump.qty, lump.price])];
  const out: Split[] = [];
  const tiers = lump.tiers ?? null;
  if (!tiers) {
    // No tier named: one tier for all of its cards, at that tier's price
    for (const t of setTiers ?? RESTORATION_KEYS) {
      const p = pricing.get(t);
      if (!p || p.rate != null) continue;
      for (const a of amounts) {
        if (p.prices.some((price) => price * m === a)) {
          const counts = { ...fixed, [t]: (fixed[t] ?? 0) + m };
          out.push(split(counts, null, () => `${usd(a / m)} per card`));
          break;
        }
      }
    }
    return out;
  }
  const comps = compositions(m, tiers.length);
  if (!comps) return null;
  const rated = tiers.some((t) => pricing.get(t)?.rate != null);
  const combos = [...priceCombos(tiers, pricing)];
  // The same split reached through two prices (Bronze $74.99 / $75.00) once
  const seen = new Set<string>();
  for (const comp of comps) {
    for (const prices of combos) {
      let fixedAmount = 0;
      for (let i = 0; i < tiers.length; i++) fixedAmount += (prices[tiers[i]] ?? 0) * comp[i];
      for (const a of amounts) {
        const rest = a - fixedAmount;
        if (rated ? rest <= 0 : rest !== 0) continue;
        const key = `${comp.join(",")}|${rated ? rest : ""}`;
        if (seen.has(key)) continue;
        seen.add(key);
        const counts = { ...fixed };
        tiers.forEach((t, i) => { counts[t] = (counts[t] ?? 0) + comp[i]; });
        out.push(split(counts, rated ? rest : null, describe));
      }
    }
  }
  return out;
}

/**
 * How much searching one order's guess may do (solver steps, all passes
 * together). Past it the guess falls back to the cards' declared values only
 * (staff confirm every card), so a large mixed order can never hang a request
 * or run the server out of memory. A real 12-card order over 5 tiers with
 * Diamond (CD-2021) takes about 9,300 steps; 25,000 is well under 100 ms.
 */
export const GUESS_WORK_BUDGET = 25_000;

class OutOfWork extends Error {}

type Assigned = { possible: Map<string, Set<string>>; best: Map<string, string>; feasible: number[] };

/**
 * For each open card, the tiers it can have in some assignment that matches
 * one of `options` (cards per tier, Diamond's priced amount) and the tier
 * caps, plus one such assignment that puts the most valuable cards in the
 * fastest tiers (the best guess). Null when nothing matches; "too_big" when
 * the search ran past `budget` (nothing it found is used then).
 * `useCaps: false` relaxes the fixed tiers' value caps only: Diamond's minimum
 * value always holds (a card under it can't have been priced as Diamond).
 */
function assign(
  open: GuessCard[],
  options: { counts: Record<string, number>; rateAmount: number | null }[],
  pricing: Map<string, TierPricing>,
  useCaps: boolean,
  budget: { left: number },
): Assigned | null | "too_big" {
  try {
    return assignWithin(open, options, pricing, useCaps, budget);
  } catch (e) {
    if (e instanceof OutOfWork) return "too_big";
    throw e;
  }
}

function assignWithin(
  open: GuessCard[],
  options: { counts: Record<string, number>; rateAmount: number | null }[],
  pricing: Map<string, TierPricing>,
  useCaps: boolean,
  budget: { left: number },
): Assigned | null {
  const possible = new Map<string, Set<string>>(open.map((c) => [c.id, new Set<string>()]));
  let best: Map<string, string> | null = null;
  const feasible: number[] = [];
  // Most valuable first, so the first assignment found is the best guess
  const cards = [...open].sort((a, b) => (b.estimated_value_cents ?? -1) - (a.estimated_value_cents ?? -1));
  const spend = () => {
    if (--budget.left < 0) throw new OutOfWork();
  };
  for (const [optIndex, opt] of options.entries()) {
    const tiers = Object.keys(opt.counts).filter((t) => opt.counts[t] > 0).sort(byRank);
    const priceOf = (c: GuessCard, t: string) => {
      const p = pricing.get(t);
      return p?.rate != null ? Math.round((c.estimated_value_cents ?? 0) * p.rate) : 0;
    };
    const ok = (c: GuessCard, t: string) => {
      const p = pricing.get(t);
      // Diamond is priced by value and has a minimum: always enforced
      if (p?.rate != null) return c.estimated_value_cents != null && fits(p, c.estimated_value_cents);
      return !useCaps || fits(p, c.estimated_value_cents);
    };
    // Rounding: each Diamond card's price is rounded to the cent
    const tolerance = Math.max(1, cards.length);
    /** Card i in tier k from state (left, rateLeft): the next state, or null when it can't go there. */
    const step = (i: number, k: number, left: number[], rateLeft: number): { left: number[]; rate: number } | null => {
      const c = cards[i];
      const t = tiers[k];
      if (left[k] === 0 || !ok(c, t)) return null;
      const rate = rateLeft - priceOf(c, t);
      // Diamond's amount already overspent: no card can bring it back
      if (opt.rateAmount != null && rate < -tolerance) return null;
      const next = [...left];
      next[k]--;
      return { left: next, rate };
    };
    const memo = new Map<string, boolean>();
    // Can cards[i..] fill `left` (and Diamond's amount)?
    const canFinish = (i: number, left: number[], rateLeft: number): boolean => {
      spend();
      if (i === cards.length) return left.every((x) => x === 0) && (opt.rateAmount == null || Math.abs(rateLeft) <= tolerance);
      const key = `${i}|${left.join(",")}|${rateLeft}`;
      const seen = memo.get(key);
      if (seen !== undefined) return seen;
      let found = false;
      for (let k = 0; k < tiers.length && !found; k++) {
        const n = step(i, k, left, rateLeft);
        if (n) found = canFinish(i + 1, n.left, n.rate);
      }
      memo.set(key, found);
      return found;
    };
    const start = tiers.map((t) => opt.counts[t]);
    const rateStart = opt.rateAmount ?? 0;
    if (!canFinish(0, start, rateStart)) continue;
    feasible.push(optIndex);
    if (!best) {
      // The fastest tier that still lets the rest finish, card by card (most valuable first)
      const pick = new Map<string, string>();
      let state = { left: start, rate: rateStart };
      for (let i = 0; i < cards.length; i++) {
        for (let k = 0; k < tiers.length; k++) {
          const n = step(i, k, state.left, state.rate);
          if (n && canFinish(i + 1, n.left, n.rate)) {
            pick.set(cards[i].id, tiers[k]);
            state = n;
            break;
          }
        }
      }
      best = pick;
    }
    // Every tier each card takes on some assignment that works: forward over the states on such assignments
    let frontier = new Map<string, { left: number[]; rate: number }>([[`${start.join(",")}|${rateStart}`, { left: start, rate: rateStart }]]);
    for (let i = 0; i < cards.length; i++) {
      const next = new Map<string, { left: number[]; rate: number }>();
      for (const st of frontier.values()) {
        for (let k = 0; k < tiers.length; k++) {
          spend();
          const n = step(i, k, st.left, st.rate);
          if (!n || !canFinish(i + 1, n.left, n.rate)) continue;
          possible.get(cards[i].id)!.add(tiers[k]);
          next.set(`${n.left.join(",")}|${n.rate}`, n);
        }
      }
      frontier = next;
    }
  }
  return best ? { possible, best, feasible } : null;
}

const PREP_NAME = /(^|[^a-z])prep([^a-z]|$)/i;

/** The best guess for every card of the order (cards with a tier of their own or the order's come back "sure"). */
export function guessTiers(input: GuessInput): Record<string, TierGuess> {
  const names = input.tierNames;
  const nameOf = (t: string) => tierDisplayName(t, names);
  const out: Record<string, TierGuess> = {};
  const orderTier = normalizeTier(input.orderTier);
  const pricing = new Map(input.pricing.map((p) => [p.tier, p]));

  // 1-2. Recorded on the card or the order
  for (const c of input.cards) {
    const own = normalizeTier(c.tier);
    if (own) out[c.id] = { tier: own, confidence: "sure", source: "card", why: `The card's tier: ${nameOf(own)}.` };
    else if (orderTier) out[c.id] = { tier: orderTier, confidence: "sure", source: "order", why: `The order's tier: ${nameOf(orderTier)}.` };
  }

  // 3. The signed record (one signed entry per card; tiered cards claim theirs first)
  const signed = signedTiers(input.cards, (c) => out[c.id]?.tier ?? null, input.signed);
  for (const [id, s] of signed) {
    const t = normalizeTier(s.tier)!;
    out[id] = { tier: t, confidence: "sure", source: "signed", why: `${s.via === "dropoff" ? "Signed drop-off form" : "Signed at checkout"}: ${nameOf(t)}.` };
  }

  // 4. What was paid for the card itself: exactly one tier's price (Diamond: its rate on the declared value)
  for (const c of input.cards) {
    const paid = c.service_price_cents;
    if (out[c.id] || paid == null || paid <= 0) continue;
    const match = input.pricing.filter((p) => p.rate == null
      ? p.prices.includes(paid)
      : c.estimated_value_cents != null && fits(p, c.estimated_value_cents) && Math.round(c.estimated_value_cents * p.rate) === paid);
    if (match.length !== 1) continue;
    const t = match[0].tier;
    out[c.id] = { tier: t, confidence: "likely", source: "price", why: `Paid ${usd(paid)}, the ${nameOf(t)} price.` };
  }

  const open = input.cards.filter((c) => !out[c.id]);
  if (!open.length) return out;

  // 5. What was paid for the order, against the tier prices and the cards' declared values
  const rows = serviceRows(input.services, input.checkoutEvents, input.subtotalCents, names);
  const rowTiers = [...new Set(rows.flatMap((r) => r.tiers ?? []))];
  // A paid line naming no tier ("Full Card Restoration"): the named lines alone don't say what was bought
  const untieredLine = rows.some((r) => r.tiers === null);
  const fromEvent = eventTiers(input.checkoutEvents);
  const setTiers = (rowTiers.length ? rowTiers : fromEvent)?.sort(byRank) ?? null;
  // The tiers a line naming none can be: the checkout event's, else any restoration tier (never the other lines' Prep)
  const lumpTiers = fromEvent?.filter((t) => t !== "prep").sort(byRank) ?? null;
  const known = input.cards.filter((c) => out[c.id]);
  const options = (splits(rows, input.cards.length, lumpTiers?.length ? lumpTiers : null, pricing, names) ?? []).flatMap((s) => {
    // Cards that already have a tier take their places first
    const counts = { ...s.counts };
    let rateAmount = s.rateAmount;
    for (const c of known) {
      const t = out[c.id].tier!;
      if (!counts[t]) return [];
      counts[t]--;
      const p = pricing.get(t);
      if (p?.rate != null && rateAmount != null) rateAmount -= Math.round((c.estimated_value_cents ?? 0) * p.rate);
    }
    return [{ counts, rateAmount, split: s }];
  });

  // (a few hundred cards at most per order; past that, staff pick). The search is bounded
  // (GUESS_WORK_BUDGET); the pass without value caps is skipped when Diamond (priced by value) is in play.
  const solvable = options.length > 0 && open.length <= 60;
  const budget = { left: GUESS_WORK_BUDGET };
  const diamondInPlay = options.some((o) => o.rateAmount != null);
  let attempt = solvable ? assign(open, options, pricing, true, budget) : null;
  if (attempt === null && solvable && !diamondInPlay) attempt = assign(open, options, pricing, false, budget);
  let solved: Assigned | null = attempt === "too_big" ? null : attempt;
  // What was paid for, as the splits that fit the cards say it
  const fitting = solved ? solved.feasible.map((i) => options[i]) : options;
  // What the fitting splits say was paid for: one label, or "several" (stops at the second)
  const labels: string[] = [];
  for (const o of fitting) {
    const l = o.split.label;
    if (!labels.includes(l)) labels.push(l);
    if (labels.length > 1) break;
  }
  let paidFor = labels.length === 1 ? labels[0] : setTiers ? joinNames(setTiers.map(nameOf)) : "";
  let viaSet = false;
  if (!solved && setTiers?.length && !untieredLine) {
    // The paid lines don't add up (cards added or removed since), or the search ran too long: the tiers chosen, by declared value
    const possible = new Map(open.map((c) => {
      const fit = setTiers.filter((t) => fits(pricing.get(t), c.estimated_value_cents) && !(pricing.get(t)?.rate != null && c.estimated_value_cents == null));
      return [c.id, new Set(fit.length ? fit : setTiers)];
    }));
    solved = { possible, best: new Map(open.map((c) => [c.id, [...possible.get(c.id)!].sort(byRank)[0]])), feasible: [] };
    paidFor = joinNames(setTiers.map(nameOf));
    viaSet = true;
  }

  for (const c of open) {
    const possible = solved ? [...(solved.possible.get(c.id) ?? [])].sort(byRank) : [];
    if (possible.length === 1) {
      const t = possible[0];
      const oneTier = labels.length === 1 && fitting.length > 0 && Object.values(fitting[0].counts).filter((x) => x > 0).length === 1;
      const why = viaSet
        ? setTiers!.length === 1 ? `Checkout chose ${nameOf(t)}.` : `Checkout chose ${paidFor}; only ${nameOf(t)} fits this card's declared value.`
        : labels.length === 1 && labels[0].endsWith("per card")
          ? `Paid ${labels[0]}, the ${nameOf(t)} price.`
          : oneTier ? `Paid for ${paidFor}.` : `Paid for ${paidFor}; matched by each card's declared value.`;
      out[c.id] = { tier: t, confidence: "likely", source: "price", why };
      continue;
    }
    // 6. The card's name says Prep ("Charmander (Prep)")
    if (PREP_NAME.test(c.card_name ?? "") && (!possible.length || possible.includes("prep")) && (!setTiers || setTiers.includes("prep"))) {
      out[c.id] = { tier: "prep", confidence: "likely", source: "name", why: "The card's name says Prep." };
      continue;
    }
    if (possible.length > 1) {
      // Several tiers fit: the most valuable cards in the faster tier (an earlier due date is the safe side)
      const guess = solved!.best.get(c.id) ?? possible[0];
      const why = viaSet
        ? `Checkout chose ${paidFor}, but not which card is which.`
        : `Paid for ${paidFor}, but not which card is which.`;
      out[c.id] = { tier: guess, confidence: "unknown", source: "price", why };
      continue;
    }
    out[c.id] = { tier: null, confidence: "unknown", source: null, why: "No tier on record: no signed checkout and no price paid per tier." };
  }
  return out;
}
