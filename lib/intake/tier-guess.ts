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
 *   4. what was paid: order_services lines and the old
 *      site's "Checkout session created — mixed tiers:"
 *      event, worked out against the tier prices and each
 *      card's declared value (the tier caps)               likely, when only one tier fits the card
 *   5. the card's name says "Prep"                        likely
 *   6. otherwise                                          unknown (a best guess may still be offered)
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

/** Signed cards matched to the order's cards by name (and value, set, number). Identical cards signed with different tiers decide nothing. */
function signedTiers(cards: GuessCard[], signed: SignedCard[]): Map<string, SignedCard> {
  const out = new Map<string, SignedCard>();
  const usable = signed.filter((s) => s.tier);
  for (const c of cards) {
    const name = norm(c.card_name);
    if (!name) continue;
    let matches = usable.filter((s) => norm(s.name) === name);
    // Text records hold the card's full title ("1999 Base Set Charizard #4")
    if (!matches.length) matches = usable.filter((s) => s.via === "checkout" && s.set === undefined && norm(s.name).includes(name));
    if (matches.length > 1 && c.estimated_value_cents != null) {
      const sameValue = matches.filter((s) => s.valueCents === c.estimated_value_cents);
      if (sameValue.length) matches = sameValue;
    }
    if (matches.length > 1) {
      const same = matches.filter((s) => (s.set == null || norm(s.set) === norm(c.card_set)) && (s.number == null || norm(s.number) === norm(c.card_number)));
      if (same.length) matches = same;
    }
    const tiers = new Set(matches.map((s) => s.tier));
    if (matches.length && tiers.size === 1) out.set(c.id, matches[0]);
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

/** A way the paid lines can be split over tiers: cards per tier, and the amount left for Diamond cards (priced by value). */
type Split = { counts: Record<string, number>; rateAmount: number | null; label: string };

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
  if (!lumps.length) return fixedCount === n ? [{ counts: fixed, rateAmount: null, label: describe(fixed) }] : null;
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
          out.push({ counts, rateAmount: null, label: `${usd(a / m)} per card` });
          break;
        }
      }
    }
    return out;
  }
  const comps = compositions(m, tiers.length);
  if (!comps) return null;
  for (const comp of comps) {
    for (const prices of priceCombos(tiers, pricing)) {
      const fixedAmount = tiers.reduce((sum, t, i) => sum + (prices[t] ?? 0) * comp[i], 0);
      const rated = tiers.some((t) => pricing.get(t)?.rate != null);
      for (const a of amounts) {
        const rest = a - fixedAmount;
        if (rated ? rest <= 0 : rest !== 0) continue;
        const counts = { ...fixed };
        tiers.forEach((t, i) => { counts[t] = (counts[t] ?? 0) + comp[i]; });
        out.push({ counts, rateAmount: rated ? rest : null, label: describe(counts) });
      }
    }
  }
  // The same split reached through two prices (Bronze $74.99 / $75.00) once
  const seen = new Set<string>();
  return out.filter((s) => {
    const key = JSON.stringify([Object.entries(s.counts).sort(), s.rateAmount]);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/**
 * For each open card, the tiers it can have in some assignment that matches
 * one of `options` (cards per tier, Diamond's priced amount) and the tier
 * caps, plus one such assignment that puts the most valuable cards in the
 * fastest tiers (the best guess). Null when nothing matches.
 */
function assign(
  open: GuessCard[],
  options: { counts: Record<string, number>; rateAmount: number | null }[],
  pricing: Map<string, TierPricing>,
  useCaps: boolean,
): { possible: Map<string, Set<string>>; best: Map<string, string>; feasible: number[] } | null {
  const possible = new Map<string, Set<string>>(open.map((c) => [c.id, new Set<string>()]));
  let best: Map<string, string> | null = null;
  const feasible: number[] = [];
  // Most valuable first, so the first assignment found is the best guess
  const cards = [...open].sort((a, b) => (b.estimated_value_cents ?? -1) - (a.estimated_value_cents ?? -1));
  for (const [optIndex, opt] of options.entries()) {
    const tiers = Object.keys(opt.counts).filter((t) => opt.counts[t] > 0).sort(byRank);
    const priceOf = (c: GuessCard, t: string) => {
      const p = pricing.get(t);
      return p?.rate != null ? Math.round((c.estimated_value_cents ?? 0) * p.rate) : 0;
    };
    const ok = (c: GuessCard, t: string) => {
      const p = pricing.get(t);
      if (p?.rate != null && c.estimated_value_cents == null) return false;
      return !useCaps || fits(p, c.estimated_value_cents);
    };
    const memo = new Map<string, boolean>();
    // Can cards[i..] fill `left` (and Diamond's amount)? `forced` pins one card.
    const solve = (i: number, left: number[], rateLeft: number, forced: [string, string] | null, pick: string[] | null): boolean => {
      if (i === cards.length) {
        const done = left.every((x) => x === 0) && (opt.rateAmount == null || Math.abs(rateLeft) <= Math.max(1, cards.length));
        return done;
      }
      const key = `${i}|${left.join(",")}|${rateLeft}|${forced?.join(":") ?? ""}`;
      if (!pick && memo.has(key)) return memo.get(key)!;
      const c = cards[i];
      let found = false;
      for (let k = 0; k < tiers.length && !found; k++) {
        const t = tiers[k];
        if (left[k] === 0 || !ok(c, t)) continue;
        if (forced && forced[0] === c.id && forced[1] !== t) continue;
        const next = [...left];
        next[k]--;
        if (pick) pick.push(t);
        found = solve(i + 1, next, rateLeft - priceOf(c, t), forced, pick);
        if (!found && pick) pick.pop();
      }
      if (!pick) memo.set(key, found);
      return found;
    };
    const start = tiers.map((t) => opt.counts[t]);
    const rateStart = opt.rateAmount ?? 0;
    if (!solve(0, start, rateStart, null, null)) continue;
    feasible.push(optIndex);
    if (!best) {
      const pick: string[] = [];
      solve(0, start, rateStart, null, pick);
      best = new Map(cards.map((c, i) => [c.id, pick[i]]));
    }
    for (const c of cards) {
      for (const t of tiers) {
        if (possible.get(c.id)!.has(t) || !ok(c, t)) continue;
        memo.clear();
        if (solve(0, start, rateStart, [c.id, t], null)) possible.get(c.id)!.add(t);
      }
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

  // 3. The signed record
  const signed = signedTiers(input.cards.filter((c) => !out[c.id]), input.signed);
  for (const [id, s] of signed) {
    const t = normalizeTier(s.tier)!;
    out[id] = { tier: t, confidence: "sure", source: "signed", why: `${s.via === "dropoff" ? "Signed drop-off form" : "Signed at checkout"}: ${nameOf(t)}.` };
  }

  const open = input.cards.filter((c) => !out[c.id]);
  if (!open.length) return out;

  // 4. What was paid, against the tier prices and the cards' declared values
  const rows = serviceRows(input.services, input.checkoutEvents, input.subtotalCents, names);
  const rowTiers = [...new Set(rows.flatMap((r) => r.tiers ?? []))];
  const setTiers = (rowTiers.length ? rowTiers : eventTiers(input.checkoutEvents))?.sort(byRank) ?? null;
  const known = input.cards.filter((c) => out[c.id]);
  const options = (splits(rows, input.cards.length, setTiers, pricing, names) ?? []).flatMap((s) => {
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
    return [{ counts, rateAmount, label: s.label }];
  });

  // (a few hundred cards at most per order; past that, staff pick)
  const solvable = options.length > 0 && open.length <= 60;
  let solved = solvable ? assign(open, options, pricing, true) ?? assign(open, options, pricing, false) : null;
  // What was paid for, as the splits that fit the cards say it
  const fitting = solved ? solved.feasible.map((i) => options[i]) : options;
  const labels = [...new Set(fitting.map((o) => o.label))];
  let paidFor = labels.length === 1 ? labels[0] : setTiers ? joinNames(setTiers.map(nameOf)) : "";
  let viaSet = false;
  if (!solved && setTiers?.length) {
    // The paid lines don't add up (cards added or removed since): the tiers chosen, by declared value
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
    // 5. The card's name says Prep ("Charmander (Prep)")
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
