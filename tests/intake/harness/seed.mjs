// Fake data for the intake harness (no real customers: names are "Test
// Customer X", emails are @example.com). Everything has a fixed id so tests
// can name it. buildSeed() returns { tables, storage } for mock-supabase.mjs.
import crypto from "node:crypto";
import { placeholderPng } from "./mock-supabase.mjs";

/** The admin_session cookie value (64 hex). The database keeps only its SHA-256. */
export const ADMIN_TOKEN = "a1b2c3d4".repeat(8);
export const ADMIN_USERNAME = "harness-admin";

const id = (prefix, n) => `${prefix}-0000-4000-8000-${String(n).padStart(12, "0")}`;

export const IDS = {
  admin: id("ad000000", 1),
  // (a) mail-in order awaiting cards: 4 Gold + 2 Silver + 3 Platinum + 1 card with no tier
  mailOrder: id("0a000000", 1),
  mailCards: Array.from({ length: 10 }, (_, i) => id("0a00000c", i + 1)),
  // (b) show drop-off, already received, 2 Gold cards
  dropoffOrder: id("0b000000", 1),
  dropoffCards: [id("0b00000c", 1), id("0b00000c", 2)],
  dropoffForm: id("0b0000df", 1),
  newDropoffForm: id("0b0000df", 2),
  // (c) delivered historical order (Platinum), both cards done
  deliveredOrder: id("0c000000", 1),
  deliveredCards: [id("0c00000c", 1), id("0c00000c", 2)],
  // (d) in-progress historical order (Gold), cards at different stages
  inProgressOrder: id("0d000000", 1),
  inProgressCards: [id("0d00000c", 1), id("0d00000c", 2), id("0d00000c", 3)],
  // (e) received order with no received event and no drop-off: missing receiving date
  noDateOrder: id("0e000000", 1),
  noDateCards: [id("0e00000c", 1), id("0e00000c", 2)],
  // (f) big mail-in order awaiting cards: 40 cards in two tiers (32 Gold + 8 Platinum), for the
  // one-label-per-bag tests (a bag's label must stay ONE page at 4, 16, 32 and 40 cards)
  bigOrder: id("0f000000", 1),
  bigCards: Array.from({ length: 40 }, (_, i) => id("0f00000c", i + 1)),
  // the two places 20261124_card_tracking.sql seeds (random ids there; fixed here)
  places: [id("10c00000", 1), id("10c00000", 2)],
};

/**
 * The places 20261124_card_tracking.sql seeds (on conflict do nothing): LOC-DONE and LOC-SHIP
 * only. Slots (CLAMP 01..N, HEAT PRESS 01..N, ...) are made by staff in Places (the bulk API),
 * and due-date shelf slots (LOC-SHELF-YYYYMMDD) when a bag first needs one, so none are seeded.
 */
export const DEFAULT_PLACES = [
  { code: "LOC-DONE", name: "Done", kind: "done", sort: 900 },
  { code: "LOC-SHIP", name: "Shipping", kind: "shipping", sort: 1000 },
];

export const ORDER_NUMBERS = {
  mailOrder: "CD-2549",
  dropoffOrder: "CD-2550",
  deliveredOrder: "CD-2400",
  inProgressOrder: "CD-2450",
  noDateOrder: "CD-2460",
  bigOrder: "CD-2600",
};

/** Which mail-in cards have which tier (index into IDS.mailCards). */
export const MAIL_CARD_TIERS = ["premium", "premium", "premium", "premium", "expedited", "expedited", "ultra_premium", "ultra_premium", "ultra_premium", null];

/** The big order's tiers (index into IDS.bigCards): 32 Gold and 8 Platinum, every 5th card Platinum. */
export const BIG_CARD_TIERS = Array.from({ length: 40 }, (_, i) => (i % 5 === 4 ? "ultra_premium" : "premium"));
/** The big order's card names; every 9th (05, 14, 23, 32) is long, to check the label shortens it. */
export const BIG_CARD_NAMES = Array.from({ length: 40 }, (_, i) => {
  const n = String(i + 1).padStart(2, "0");
  return i % 9 === 4 ? `Test Big Order Card ${n} Holo First Edition Long Name` : `Test Big Order Card ${n}`;
});
export const BIG_CUSTOMER_NAME = "Test Customer G";

// Live tier settings (restoration_settings, read Nov 23 2026)
export const TIER_SETTINGS = [
  { tier: "regular", display_name: "Bronze", price_cents: 7499, pricing_rate: null, min_card_value_cents: null, turnaround_min_days: 45, turnaround_max_days: 60, max_slots: 146, badge: null },
  { tier: "expedited", display_name: "Silver", price_cents: 9999, pricing_rate: null, min_card_value_cents: null, turnaround_min_days: 30, turnaround_max_days: 45, max_slots: 125, badge: null },
  { tier: "premium", display_name: "Gold", price_cents: 11999, pricing_rate: null, min_card_value_cents: null, turnaround_min_days: 15, turnaround_max_days: 20, max_slots: 224, badge: "Most Popular" },
  { tier: "ultra_premium", display_name: "Platinum", price_cents: 14999, pricing_rate: null, min_card_value_cents: null, turnaround_min_days: 10, turnaround_max_days: 15, max_slots: 170, badge: "Front of Queue" },
  { tier: "elite", display_name: "Diamond", price_cents: null, pricing_rate: "0.07", min_card_value_cents: 500000, turnaround_min_days: 5, turnaround_max_days: 10, max_slots: 30, badge: "White Glove" },
  { tier: "fast_pass", display_name: "Fast Pass", price_cents: 25000, pricing_rate: null, min_card_value_cents: null, turnaround_min_days: 1, turnaround_max_days: 7, max_slots: 56, badge: "Fastest" },
];

// Same list as supabase/migrations/20261123_intake_tracking.sql
export const HOLIDAYS = [
  ["2026-01-01", "New Year's Day"], ["2026-05-25", "Memorial Day"], ["2026-07-03", "Independence Day (observed)"],
  ["2026-09-07", "Labor Day"], ["2026-11-26", "Thanksgiving"], ["2026-12-25", "Christmas Day"],
  ["2027-01-01", "New Year's Day"], ["2027-05-31", "Memorial Day"], ["2027-07-05", "Independence Day (observed)"],
  ["2027-09-06", "Labor Day"], ["2027-11-25", "Thanksgiving"], ["2027-12-24", "Christmas Day (observed)"],
  ["2027-12-31", "New Year's Day (observed)"], ["2028-05-29", "Memorial Day"], ["2028-07-04", "Independence Day"],
  ["2028-09-04", "Labor Day"], ["2028-11-23", "Thanksgiving"], ["2028-12-25", "Christmas Day"],
];

const sha256 = (s) => crypto.createHash("sha256").update(s).digest("hex");
const address = (name) => ({ name, street1: "100 Test Street", city: "Philadelphia", state: "PA", zip: "19103", country: "US" });

function order(over) {
  const name = over.customer_name;
  return {
    customer_phone: "555-0100",
    ship_from_address: address(name),
    ship_to_address: address(name),
    inbound_method: "buy_label",
    inbound_cost_cents: 0,
    shipping_cents: 0,
    payment_status: "paid",
    payment_method: "stripe",
    restoration_photos: [],
    discount_cents: 0,
    discount_percent: 0,
    refunded_cents: 0,
    slab_crack_count: 0,
    instagram_feature: false,
    gift_card_discount_cents: 0,
    add_signature_confirmation: false,
    insurance_election: "declined",
    customer_notes: null,
    admin_notes: null,
    internal_notes: null,
    due_date: null,
    updated_at: over.created_at,
    ...over,
  };
}

function card(over) {
  return {
    card_set: "Base Set",
    card_year: "1999",
    estimated_value_cents: 15000,
    notes: null,
    photo_urls: [],
    service_ids: [],
    completed: false,
    completed_at: null,
    original_data: null,
    variation: null,
    grading_company: null,
    grade: null,
    cert_number: null,
    known_defects: null,
    slab_removal_selected: false,
    pregrade_selected: false,
    status: "active",
    service_price_cents: 11999,
    discount_cents: 0,
    tax_cents: 0,
    refunded_cents: 0,
    current_round: 1,
    catalog_card_id: null,
    catalog_image_url: null,
    // intake columns (20261123_intake_tracking.sql), as the migration leaves existing rows
    card_seq: null,
    card_code: null,
    bag_id: null,
    received_at: null,
    received_by: null,
    awaiting_arrival: false,
    receiving_photo_urls: [],
    // tracking columns (20261124_card_tracking.sql): nowhere yet
    location_id: null,
    located_at: null,
    ...over,
  };
}

const ev = (order_id, created_at, event_type, description, metadata = null, is_customer_visible = true) =>
  ({ id: crypto.randomUUID(), order_id, created_at, event_type, description, metadata, is_customer_visible });

const STAGES = ["Ready for Slab Crack", "Humidor", "Humidity Press", "Book", "Heat Press", "Clamp Work", "Book with Weights", "Final Dry"];

/** stage_update events for one card from the first step up to `upTo` (inclusive), a day apart. */
function stageEvents(orderId, cardId, upTo, startIso, round = 1) {
  const out = [];
  const start = Date.parse(startIso);
  for (let i = 0; i <= STAGES.indexOf(upTo); i++) {
    const stage = STAGES[i];
    out.push(ev(orderId, new Date(start + i * 86400e3).toISOString(), "stage_update", `Stage: ${stage} [card:${cardId}]`, { card_id: cardId, stage, round }));
  }
  return out;
}

export function buildSeed({ baseUrl }) {
  const photo = (name) => `${baseUrl}/storage/v1/object/public/card-photos/${name}`;
  const storage = {};
  const addPhoto = (name, rgb) => { storage[`card-photos/${name}`] = { bytes: placeholderPng(rgb), contentType: "image/png" }; return photo(name); };

  const orders = [];
  const cards = [];
  const events = [];

  // (a) Mail-in, awaiting cards, mixed tiers (order tier null), customer notes
  const mailCreated = "2026-11-10T15:30:00.000Z";
  orders.push(order({
    id: IDS.mailOrder, order_number: ORDER_NUMBERS.mailOrder, created_at: mailCreated,
    customer_name: "Test Customer A", customer_email: "test.customer.a@example.com",
    status: "awaiting_cards", restoration_tier: null, inbound_method: "buy_label",
    inbound_tracking_number: "9400100000000000000001", inbound_carrier: "usps",
    customer_notes: "Test note: the Gold cards have soft corners, please handle gently.",
    subtotal_cents: 4 * 11999 + 2 * 9999 + 3 * 14999 + 7499, total_cents: 4 * 11999 + 2 * 9999 + 3 * 14999 + 7499,
  }));
  const mailNames = [
    ["Test Card Gold One", "4/102"], ["Test Card Gold Two", "10/102"], ["Test Card Gold Three", "15/102"], ["Test Card Gold Four", "58/102"],
    ["Test Card Silver One", "2/64"], ["Test Card Silver Two", "17/64"],
    ["Test Card Platinum One", "1/130"], ["Test Card Platinum Two", "6/130"], ["Test Card Platinum Three", "11/130"],
    ["Test Card No Tier", "99/102"],
  ];
  IDS.mailCards.forEach((cid, i) => {
    cards.push(card({
      id: cid, order_id: IDS.mailOrder, created_at: mailCreated,
      card_name: mailNames[i][0], card_number: mailNames[i][1], tier: MAIL_CARD_TIERS[i],
      // two cards carry customer photos (one Gold, one Platinum)
      photo_urls: i === 0 ? [addPhoto("seed-a-card01-front.png", [200, 150, 30]), addPhoto("seed-a-card01-back.png", [120, 90, 20])]
        : i === 6 ? [addPhoto("seed-a-card07-front.png", [90, 90, 110])] : [],
      service_price_cents: { premium: 11999, expedited: 9999, ultra_premium: 14999 }[MAIL_CARD_TIERS[i]] ?? 7499,
      notes: i === 3 ? "Test instruction: crease near the bottom edge." : null,
    }));
  });
  events.push(ev(IDS.mailOrder, "2026-11-10T15:31:00.000Z", "payment_received", "Payment received", null, true));

  // (b) Show drop-off: inserted already received (POST /api/admin/orders), Gold
  const dropCreated = "2026-11-21T19:00:00.000Z";
  orders.push(order({
    id: IDS.dropoffOrder, order_number: ORDER_NUMBERS.dropoffOrder, created_at: dropCreated,
    customer_name: "Test Customer B", customer_email: "test.customer.b@example.com",
    status: "received", restoration_tier: "premium", inbound_method: "dropoff", payment_method: "cash",
    subtotal_cents: 2 * 11999, total_cents: 2 * 11999,
  }));
  IDS.dropoffCards.forEach((cid, i) => cards.push(card({
    id: cid, order_id: IDS.dropoffOrder, created_at: dropCreated, tier: "premium",
    card_name: `Test Drop-off Card ${i + 1}`, card_number: `${20 + i}/102`,
  })));

  // (c) Delivered historical order: received Oct 1, both cards finished
  const delCreated = "2026-09-20T14:00:00.000Z";
  orders.push(order({
    id: IDS.deliveredOrder, order_number: ORDER_NUMBERS.deliveredOrder, created_at: delCreated,
    customer_name: "Test Customer C", customer_email: "test.customer.c@example.com",
    status: "delivered", restoration_tier: "ultra_premium", inbound_method: "self_ship",
    subtotal_cents: 2 * 14999, total_cents: 2 * 14999, admin_notes: "Test restorer notes.",
  }));
  IDS.deliveredCards.forEach((cid, i) => cards.push(card({
    id: cid, order_id: IDS.deliveredOrder, created_at: delCreated, tier: null,
    card_name: `Test Delivered Card ${i + 1}`, card_number: `${30 + i}/130`, service_price_cents: 14999,
    completed: true, completed_at: `2026-10-1${4 + i}T18:00:00.000Z`,
    photo_urls: i === 0 ? [addPhoto("seed-c-card01-front.png", [60, 140, 90])] : [],
  })));
  events.push(ev(IDS.deliveredOrder, "2026-10-01T15:00:00.000Z", "status_updated", "Status updated to: Cards Received"));
  events.push(ev(IDS.deliveredOrder, "2026-10-02T15:00:00.000Z", "status_updated", "Status updated to: In Progress"));
  IDS.deliveredCards.forEach((cid) => events.push(...stageEvents(IDS.deliveredOrder, cid, "Final Dry", "2026-10-03T15:00:00.000Z")));
  events.push(ev(IDS.deliveredOrder, "2026-10-16T15:00:00.000Z", "status_updated", "Status updated to: Shipped Back — Tracking: 9400100000000000000999"));
  events.push(ev(IDS.deliveredOrder, "2026-10-19T15:00:00.000Z", "status_updated", "Status updated to: Delivered"));

  // (d) In progress, received Nov 2, cards at different stages (one not started)
  const ipCreated = "2026-10-25T16:00:00.000Z";
  orders.push(order({
    id: IDS.inProgressOrder, order_number: ORDER_NUMBERS.inProgressOrder, created_at: ipCreated,
    customer_name: "Test Customer D", customer_email: "test.customer.d@example.com",
    status: "in_progress", restoration_tier: "premium", inbound_method: "buy_label",
    subtotal_cents: 3 * 11999, total_cents: 3 * 11999,
  }));
  IDS.inProgressCards.forEach((cid, i) => cards.push(card({
    id: cid, order_id: IDS.inProgressOrder, created_at: ipCreated, tier: null,
    card_name: `Test In-Progress Card ${i + 1}`, card_number: `${40 + i}/102`,
    photo_urls: i === 1 ? [addPhoto("seed-d-card02-front.png", [150, 60, 60])] : [],
  })));
  events.push(ev(IDS.inProgressOrder, "2026-11-02T14:00:00.000Z", "status_updated", "Status updated to: Cards Received"));
  events.push(ev(IDS.inProgressOrder, "2026-11-03T14:00:00.000Z", "status_updated", "Status updated to: In Progress"));
  events.push(...stageEvents(IDS.inProgressOrder, IDS.inProgressCards[0], "Heat Press", "2026-11-04T14:00:00.000Z"));
  events.push(...stageEvents(IDS.inProgressOrder, IDS.inProgressCards[1], "Humidor", "2026-11-04T15:00:00.000Z"));
  // card 3: not started

  // (e) Received, but no 'Cards Received' event and not a drop-off: missing receiving date
  const ndCreated = "2026-10-30T13:00:00.000Z";
  orders.push(order({
    id: IDS.noDateOrder, order_number: ORDER_NUMBERS.noDateOrder, created_at: ndCreated,
    customer_name: "Test Customer E", customer_email: "test.customer.e@example.com",
    status: "received", restoration_tier: "expedited", inbound_method: "self_ship",
    subtotal_cents: 2 * 9999, total_cents: 2 * 9999,
  }));
  IDS.noDateCards.forEach((cid, i) => cards.push(card({
    id: cid, order_id: IDS.noDateOrder, created_at: ndCreated, tier: null,
    card_name: `Test No-Date Card ${i + 1}`, card_number: `${50 + i}/64`, service_price_cents: 9999,
  })));

  // (f) Big mail-in order, awaiting cards: 40 cards, 32 Gold + 8 Platinum (order tier null).
  // admin_notes is set on purpose: selftest.mjs lists orders with admin_notes null and expects
  // the five orders above only.
  const bigCreated = "2026-11-20T15:00:00.000Z";
  const bigTotal = BIG_CARD_TIERS.reduce((sum, t) => sum + (t === "premium" ? 11999 : 14999), 0);
  orders.push(order({
    id: IDS.bigOrder, order_number: ORDER_NUMBERS.bigOrder, created_at: bigCreated,
    customer_name: BIG_CUSTOMER_NAME, customer_email: "test.customer.g@example.com",
    status: "awaiting_cards", restoration_tier: null, inbound_method: "buy_label",
    inbound_tracking_number: "9400100000000000000002", inbound_carrier: "usps",
    admin_notes: "Test: a big order for the label tests.",
    subtotal_cents: bigTotal, total_cents: bigTotal,
  }));
  IDS.bigCards.forEach((cid, i) => cards.push(card({
    id: cid, order_id: IDS.bigOrder, created_at: bigCreated, tier: BIG_CARD_TIERS[i],
    card_name: BIG_CARD_NAMES[i], card_number: `${i + 1}/165`, card_set: i % 2 ? "Test Set Two" : "Base Set",
    service_price_cents: BIG_CARD_TIERS[i] === "premium" ? 11999 : 14999,
  })));
  events.push(ev(IDS.bigOrder, "2026-11-20T15:01:00.000Z", "payment_received", "Payment received", null, true));

  const showDropoff = (over) => ({
    created_at: dropCreated, updated_at: dropCreated, show_name: "Test Card Show",
    customer_phone: "555-0101", return_address: address(over.customer_name), five_plus: false,
    customer_notes: null, terms_version_id: null, terms_version: "1.1", signed_name: over.customer_name,
    signed_text: "Test signed text.", signed_sha256: sha256(over.customer_name), esign_consent: true,
    media_permission: false, tag_permission: false, signed_at: dropCreated, ip_address: "127.0.0.1",
    user_agent: "harness", admin_notes: null, processed_at: null,
    ...over,
  });

  const created = "2026-11-01T12:00:00.000Z";
  return {
    tables: {
      admin_users: [{ id: IDS.admin, username: ADMIN_USERNAME, password_hash: "pbkdf2$harness$not-a-real-hash", active: true, created_at: created, last_login_at: null, email: "harness-admin@example.com" }],
      admin_sessions: [{
        token_hash: sha256(ADMIN_TOKEN), role: "admin", admin_user_id: IDS.admin, accountant_id: null, support_id: null,
        created_at: created, expires_at: "2099-01-01T00:00:00.000Z", user_agent: "harness",
      }],
      accountant_access: [],
      support_access: [],
      restoration_settings: TIER_SETTINGS.map((t) => ({ is_open: true, description: `${t.display_name} test tier`, includes_notes: true, includes_video: false, display_slots_remaining: null, ...t })),
      store_config: [
        { key: "subscription_price_cents", value: "8999", updated_at: created },
        { key: "restorations_open", value: "true", updated_at: created },
        { key: "slots_opened_at", value: "2026-08-10T19:07:04.613Z", updated_at: created },
      ],
      business_holidays: HOLIDAYS.map(([day, name]) => ({ day, name, created_at: created })),
      orders,
      cards,
      order_events: events,
      tier_bags: [],
      tier_bag_due_changes: [],
      // card tracking (20261124_card_tracking.sql): LOC-DONE and LOC-SHIP, no slots, no moves yet
      locations: DEFAULT_PLACES.map((p, i) => ({
        id: IDS.places[i], code: p.code, name: p.name, kind: p.kind, station: null, serial: null, capacity: null,
        stage: null, due_date: null, sort: p.sort, active: true, created_at: created, created_by: "setup",
      })),
      card_moves: [],
      show_dropoffs: [
        showDropoff({ id: IDS.dropoffForm, dropoff_number: 1001, customer_name: "Test Customer B", customer_email: "test.customer.b@example.com", tiers: ["premium"], card_count: 2, cards: [{ name: "Test Drop-off Card 1" }, { name: "Test Drop-off Card 2" }], status: "entered", order_id: IDS.dropoffOrder, processed_at: dropCreated }),
        showDropoff({ id: IDS.newDropoffForm, dropoff_number: 1002, customer_name: "Test Customer F", customer_email: "test.customer.f@example.com", tiers: ["ultra_premium"], card_count: 1, cards: [{ name: "Test New Drop-off Card" }], status: "new", order_id: null }),
      ],
      cases: [],
      refunds: [],
      refund_requests: [],
      email_problems: [],
      order_services: [],
      order_agreements: [],
      signatures: [],
      consents: [],
      terms_versions: [],
      gift_cards: [],
      shop_orders: [],
      backlog_events: [],
      metrics_settings: [{ key: "backlog_tracking_start", value_ts: "2026-10-23T04:00:00.000Z", updated_at: created }],
    },
    storage,
  };
}
