// A local, in-memory stand-in for the parts of Supabase this app talks to:
// PostgREST (/rest/v1), Storage (/storage/v1), Auth (/auth/v1) and, for
// emails, Resend's API (/__resend, used through RESEND_BASE_URL). Test data
// only; nothing here ever reaches a real database or sends a real email.
//
//   node tests/intake/harness/mock-supabase.mjs [--port 54400] [--https]
//
// Test endpoints:
//   GET  /__health          {"ok":true}
//   GET  /__dump            every table, captured emails, stored files, unknown
//                           tables/RPCs seen, write log
//   GET  /__dump/<table>    one table's rows
//   POST /__reset           reseed (body {"seed":false} empties everything)
//   POST /__rows/<table>    insert raw rows (no defaults/constraints), for test setup
//   GET  /__emails          emails captured from the app
//   GET  /__requests        the last 500 requests (method, path, status)
//   *    /__shippo/...      a fake Shippo (mock-shippo.mjs; off until POST /__shippo/__config {"enabled":true})
//
// PostgREST coverage: select with columns, aliases, casts, json paths and
// embedded relations (many-to-one / one-to-many, !inner, !hint), filters
// eq neq gt gte lt lte like ilike match imatch in is isdistinct cs cd ov fts
// (and not.<op>), or=(...) / and=(...) (nested, also on embedded tables),
// filters on embedded columns (orders.status=eq.x), order (asc/desc,
// nullsfirst/nullslast, also <rel>.order), limit/offset (also <rel>.limit) and
// Range headers, Prefer count=exact (content-range), HEAD, Accept
// vnd.pgrst.object+json (406 unless exactly one row), POST insert (one or
// many, columns=, return=representation|minimal, on_conflict +
// resolution=ignore-duplicates|merge-duplicates, missing=default), PATCH and
// DELETE with filters, unique / not-null / check / foreign-key constraints
// (409 23505, 400 23502, 400 23514, 409 23503), ON DELETE cascade / set null /
// no action (checked at the end of the statement, as in PostgreSQL),
// and the triggers the app relies on (order numbers, updated_at, card
// completed_at, cards done when an order ships, immutable due-change log,
// a bag shipment's bag belongs to its order). Partial unique indexes: a
// unique set with `where`. store.missingTables (a Set) answers those tables
// as PostgREST does before their migration (404 PGRST205).
import http from "node:http";
import https from "node:https";
import crypto from "node:crypto";
import zlib from "node:zlib";
import { pathToFileURL } from "node:url";
import { handleShippo, shippoDump } from "./mock-shippo.mjs";

// ─── Schema: only what the constraints, defaults and relations need ─────────
const now = () => new Date().toISOString();
const uuid = () => crypto.randomUUID();

/** The 8 steps (lib/restoration-stages.ts STAGES), for the locations.stage check. */
const TRACK_STAGES = ["Ready for Slab Crack", "Humidor", "Humidity Press", "Book", "Heat Press", "Clamp Work", "Book with Weights", "Final Dry"];

/** Per table: primary key, unique sets, NOT NULL columns, CHECKs, FKs, defaults. */
export const SCHEMA = {
  orders: {
    pk: ["id"],
    unique: [{ name: "orders_order_number_key", cols: ["order_number"] }],
    notNull: ["customer_email", "customer_name", "customer_phone", "ship_from_address", "ship_to_address", "subtotal_cents", "total_cents", "refunded_cents", "slab_crack_count", "instagram_feature", "gift_card_discount_cents"],
    checks: {
      orders_status_check: (r) => r.status == null || ["awaiting_payment", "awaiting_cards", "received", "in_progress", "completed", "shipped_back", "delivered", "cancelled"].includes(r.status),
      orders_payment_status_check: (r) => r.payment_status == null || ["pending", "paid", "refunded", "failed"].includes(r.payment_status),
      orders_inbound_method_check: (r) => r.inbound_method == null || ["buy_label", "self_ship", "dropoff"].includes(r.inbound_method),
      orders_insurance_election_check: (r) => r.insurance_election == null || ["purchased", "declined"].includes(r.insurance_election),
    },
    defaults: () => ({
      status: "awaiting_payment", payment_status: "pending", inbound_cost_cents: 0, shipping_cents: 0,
      restoration_photos: [], discount_cents: 0, discount_percent: 0, add_signature_confirmation: false,
      refunded_cents: 0, slab_crack_count: 0, instagram_feature: false, gift_card_discount_cents: 0,
      updated_at: now(),
    }),
  },
  cards: {
    pk: ["id"],
    unique: [
      { name: "cards_card_code_key", cols: ["card_code"] },
      { name: "cards_order_seq_key", cols: ["order_id", "card_seq"] },
    ],
    notNull: ["slab_removal_selected", "pregrade_selected", "status", "refunded_cents", "current_round", "awaiting_arrival", "receiving_photo_urls"],
    checks: {
      cards_status_check: (r) => ["active", "on_hold_high_value", "in_progress", "refunded"].includes(r.status),
      cards_card_seq_check: (r) => r.card_seq == null || r.card_seq >= 1,
      cards_catalog_image_url_check: (r) => r.catalog_image_url == null || /^https:\/\/(assets\.tcgdex\.net|images\.pokemontcg\.io)\//.test(r.catalog_image_url),
    },
    fks: {
      order_id: { table: "orders", onDelete: "cascade" },
      // NO ACTION: a bag still holding cards can't be deleted (an order's delete takes both)
      bag_id: { table: "tier_bags", onDelete: "no action" },
      // 20261124_card_tracking.sql: where the card is now (located_at: since when)
      location_id: { table: "locations", onDelete: "set null" },
    },
    defaults: () => ({
      photo_urls: [], service_ids: [], completed: false, slab_removal_selected: false, pregrade_selected: false,
      status: "active", refunded_cents: 0, current_round: 1, awaiting_arrival: false, receiving_photo_urls: [],
    }),
  },
  order_events: {
    pk: ["id"],
    notNull: ["event_type"],
    fks: { order_id: { table: "orders", onDelete: "cascade" } },
    defaults: () => ({ is_customer_visible: true }),
  },
  tier_bags: {
    pk: ["id"],
    unique: [
      { name: "tier_bags_bag_code_key", cols: ["bag_code"] },
      { name: "tier_bags_order_id_tier_batch_key", cols: ["order_id", "tier", "batch"] },
    ],
    notNull: ["order_id", "tier", "batch", "bag_code", "due_status", "source", "created_at"],
    checks: {
      tier_bags_batch_check: (r) => r.batch >= 1,
      tier_bags_due_status_check: (r) => ["calculated", "manual", "needs_review", "missing_received_date", "pending"].includes(r.due_status),
      tier_bags_source_check: (r) => ["receiving", "migration"].includes(r.source),
    },
    fks: {
      order_id: { table: "orders", onDelete: "cascade" },
      // 20261124_card_tracking.sql: where the bag is now (located_at: since when)
      location_id: { table: "locations", onDelete: "set null" },
    },
    defaults: () => ({ batch: 1, due_status: "pending", source: "receiving" }),
  },
  // ─── Card tracking (20261124_card_tracking.sql): serial-numbered slots ───
  // Slots and places: numbered slots of a station type (kind 'station': station + serial + stage +
  // capacity, CLAMP 07 = LOC-CLAMP-07), due-date shelf slots, LOC-DONE, LOC-SHIP, other places.
  locations: {
    pk: ["id"],
    unique: [
      { name: "locations_code_key", cols: ["code"] },
      // partial unique index (station is not null): NULLs never clash here either
      { name: "locations_station_serial_key", cols: ["station", "serial"] },
    ],
    notNull: ["code", "name", "kind", "sort", "active"],
    checks: {
      locations_code_check: (r) => typeof r.code === "string" && /^LOC-[A-Z0-9]+(-[A-Z0-9]+)*$/.test(r.code) && r.code.length <= 40,
      locations_name_check: (r) => typeof r.name === "string" && r.name.trim() !== "" && r.name.length <= 60,
      locations_kind_check: (r) => ["station", "shelf", "done", "shipping", "other"].includes(r.kind),
      locations_station_check: (r) => r.station == null || /^[a-z0-9]+(-[a-z0-9]+)*$/.test(r.station),
      locations_serial_check: (r) => r.serial == null || (Number.isInteger(r.serial) && r.serial >= 1 && r.serial <= 9999),
      locations_capacity_check: (r) => r.capacity == null || (Number.isInteger(r.capacity) && r.capacity >= 1),
      locations_stage_check: (r) => r.stage == null || TRACK_STAGES.includes(r.stage),
      // a slot (kind 'station') has its type, number and step; nothing else has a step
      locations_slot_shape: (r) => (r.kind === "station") === (r.stage != null) && (r.kind !== "station" || (r.station != null && r.serial != null)),
    },
    defaults: () => ({ sort: 0, active: true }),
  },
  // Every card move (insert-only: a trigger refuses updates; deleting a card deletes its moves).
  // A place with history can't be deleted (NO ACTION); bag_id and order_id are plain uuids.
  card_moves: {
    pk: ["id"],
    notNull: ["card_id", "action"],
    checks: {
      card_moves_action_check: (r) => ["assign", "move", "release", "done", "receive", "ship_check"].includes(r.action),
    },
    fks: {
      card_id: { table: "cards", onDelete: "cascade" },
      from_location_id: { table: "locations", onDelete: "no action" },
      to_location_id: { table: "locations", onDelete: "no action" },
    },
    immutable: true,
  },
  // Per-bag return labels (20261125_bag_shipments.sql): claimed before Shippo is called,
  // one live row per bag (partial unique index), one order label per order; a row
  // with no bag is the order page's claim on the whole-order label (one live per order)
  bag_shipments: {
    pk: ["id"],
    unique: [
      { name: "bag_shipments_one_live_per_bag", cols: ["bag_id"], where: (r) => ["claimed", "purchased", "shipped", "delivered"].includes(r.status) },
      { name: "bag_shipments_one_order_claim", cols: ["order_id"], where: (r) => r.bag_id == null && ["claimed", "purchased", "shipped", "delivered"].includes(r.status) },
      { name: "bag_shipments_one_order_label", cols: ["order_id"], where: (r) => r.order_label === true },
    ],
    notNull: ["order_id", "status", "order_label", "claimed_at"],
    checks: {
      bag_shipments_status_check: (r) => ["claimed", "purchased", "shipped", "delivered", "failed", "voided"].includes(r.status),
      bag_shipments_label_shape: (r) => ["claimed", "failed", "voided"].includes(r.status) || r.label_url != null,
      bag_shipments_order_claim_shape: (r) => r.bag_id != null || (["claimed", "failed"].includes(r.status) && !r.order_label),
      bag_shipments_cost_cents_check: (r) => r.cost_cents == null || r.cost_cents >= 0,
    },
    fks: {
      bag_id: { table: "tier_bags", onDelete: "cascade" },
      order_id: { table: "orders", onDelete: "cascade" },
    },
    defaults: () => ({ status: "claimed", order_label: false, claimed_at: now(), updated_at: now() }),
  },
  tier_bag_due_changes: {
    pk: ["id"],
    notNull: ["bag_id", "reason", "created_at"],
    checks: { tier_bag_due_changes_reason_check: (r) => typeof r.reason === "string" && r.reason.trim() !== "" },
    fks: { bag_id: { table: "tier_bags", onDelete: "cascade" } },
    immutable: true,
  },
  business_holidays: { pk: ["day"], notNull: ["name"] },
  restoration_settings: { pk: ["tier"], defaults: () => ({ is_open: true }), noCreatedAt: true },
  store_config: { pk: ["key"], notNull: ["value"], defaults: () => ({ updated_at: now() }), noCreatedAt: true },
  admin_users: {
    pk: ["id"],
    unique: [{ name: "admin_users_username_key", cols: ["username"] }],
    notNull: ["username", "password_hash", "active"],
    defaults: () => ({ active: true }),
  },
  admin_sessions: {
    pk: ["token_hash"],
    notNull: ["role", "expires_at"],
    checks: { admin_sessions_role_check: (r) => ["admin", "accountant", "support"].includes(r.role) },
    fks: {
      admin_user_id: { table: "admin_users", onDelete: "cascade" },
      accountant_id: { table: "accountant_access", onDelete: "cascade" },
      support_id: { table: "support_access", onDelete: "cascade" },
    },
  },
  show_dropoffs: {
    pk: ["id"],
    unique: [{ name: "show_dropoffs_dropoff_number_key", cols: ["dropoff_number"] }],
    checks: { show_dropoffs_status_check: (r) => ["new", "entered", "cancelled"].includes(r.status) },
    fks: { order_id: { table: "orders", onDelete: "set null" } },
    defaults: () => ({ status: "new", tiers: [], five_plus: false, cards: [], media_permission: false, tag_permission: false, signed_at: now(), updated_at: now() }),
    noDelete: "show_dropoffs rows are signed records and cannot be deleted",
  },
  refunds: { pk: ["id"], fks: { order_id: { table: "orders" }, card_id: { table: "cards" } } },
  refund_requests: { pk: ["id"], fks: { order_id: { table: "orders", onDelete: "cascade" } }, defaults: () => ({ status: "pending", card_ids: [], stripe_refund_ids: [] }) },
  cases: { pk: ["id"], defaults: () => ({ type: "internal", status: "open", priority: "normal", photo_urls: [], updated_at: now() }) },
  order_services: { pk: ["id"], fks: { order_id: { table: "orders", onDelete: "cascade" } } },
  order_agreements: { pk: ["id"], fks: { order_id: { table: "orders", onDelete: "cascade" } } },
  signatures: { pk: ["id"], fks: { order_id: { table: "orders" } } },
  consents: { pk: ["id"], fks: { order_id: { table: "orders" } } },
  email_problems: { pk: ["id"], defaults: () => ({ received_at: now() }) },
  metrics_settings: { pk: ["key"], noCreatedAt: true },
  affiliate_sessions: { pk: ["token_hash"], fks: { affiliate_id: { table: "affiliates" } } },
  partner_sessions: { pk: ["token_hash"], fks: { partner_id: { table: "partners" } } },
};

// FK columns used only to embed (many-to-one): table -> column -> target
const EXTRA_RELATIONS = {};

function fksOf(table) {
  return { ...(SCHEMA[table]?.fks ?? {}), ...(EXTRA_RELATIONS[table] ?? {}) };
}

// ─── Small helpers ──────────────────────────────────────────────────────────
const clone = (v) => (v === undefined ? undefined : structuredClone(v));
const isDateLike = (s) => typeof s === "string" && /^\d{4}-\d{2}-\d{2}([T ][\d:.]+)?(Z|[+-]\d{2}(:?\d{2})?)?$/.test(s);
const isNumLike = (s) => typeof s === "string" && /^-?\d+(\.\d+)?$/.test(s.trim());

/** Split on a separator at depth 0, respecting parentheses, braces and double quotes. */
function splitTop(str, sep = ",") {
  const out = [];
  let depth = 0, quoted = false, cur = "";
  for (let i = 0; i < str.length; i++) {
    const c = str[i];
    if (c === '"' && str[i - 1] !== "\\") quoted = !quoted;
    if (!quoted) {
      if (c === "(" || c === "{" || c === "[") depth++;
      else if (c === ")" || c === "}" || c === "]") depth--;
      else if (c === sep && depth === 0) { out.push(cur); cur = ""; continue; }
    }
    cur += c;
  }
  if (cur !== "" || out.length) out.push(cur);
  return out;
}

const unquote = (s) => {
  const t = s.trim();
  return t.length >= 2 && t.startsWith('"') && t.endsWith('"') ? t.slice(1, -1).replace(/\\"/g, '"').replace(/\\\\/g, "\\") : t;
};

/** Read a column or JSON path (metadata->>card_id, data->a->b) from a row. */
function getPath(row, path) {
  if (row == null) return undefined;
  const parts = path.split(/(->>|->)/);
  let v = row[parts[0].trim()];
  for (let i = 1; i < parts.length; i += 2) {
    const op = parts[i];
    let key = parts[i + 1].trim().replace(/^'|'$/g, "");
    if (v == null) return null;
    if (typeof v === "string") { try { v = JSON.parse(v); } catch { return null; } }
    v = Array.isArray(v) && /^\d+$/.test(key) ? v[Number(key)] : v[key];
    if (op === "->>" && v != null && typeof v === "object") v = JSON.stringify(v);
    if (op === "->>" && v != null && typeof v !== "object") v = String(v);
  }
  return v;
}

function compare(a, b) {
  if (a == null && b == null) return 0;
  if (typeof a === "number" && typeof b === "number") return a - b;
  if (typeof a === "boolean" || typeof b === "boolean") return Number(a) - Number(b);
  if (typeof a === "number" && isNumLike(String(b))) return a - Number(b);
  if (typeof b === "number" && isNumLike(String(a))) return Number(a) - b;
  if (isDateLike(a) && isDateLike(b)) {
    const da = Date.parse(a.length === 10 ? `${a}T00:00:00Z` : a), db = Date.parse(b.length === 10 ? `${b}T00:00:00Z` : b);
    if (!Number.isNaN(da) && !Number.isNaN(db)) return da - db;
  }
  const sa = typeof a === "object" ? JSON.stringify(a) : String(a);
  const sb = typeof b === "object" ? JSON.stringify(b) : String(b);
  return sa < sb ? -1 : sa > sb ? 1 : 0;
}

/** A PostgreSQL array literal ({a,"b c",NULL}) to a JS array of strings/nulls. */
function parsePgArray(v) {
  const t = String(v).trim();
  if (t.startsWith("[")) { try { const a = JSON.parse(t); if (Array.isArray(a)) return a.map((x) => (x == null ? null : String(x))); } catch { /* not JSON */ } }
  if (!t.startsWith("{") || !t.endsWith("}")) return null;
  return splitTop(t.slice(1, -1)).filter((x) => x !== "").map((x) => (x.trim() === "NULL" ? null : unquote(x)));
}

function eqValue(col, val) {
  if (col == null) return false;
  // array column vs an array literal: same elements in the same order
  if (Array.isArray(col)) {
    const want = parsePgArray(val);
    return !!want && want.length === col.length && want.every((w, i) => (w == null ? col[i] == null : String(col[i]) === w));
  }
  if (typeof col === "boolean") return String(col) === String(val).toLowerCase();
  if (typeof col === "number") return isNumLike(String(val)) && col === Number(val);
  if (isDateLike(col) && isDateLike(val)) return compare(col, val) === 0;
  if (typeof col === "object") return JSON.stringify(col) === val;
  return String(col) === String(val);
}

function likeToRegex(pattern, flags) {
  let re = "";
  for (const ch of pattern) {
    if (ch === "%" || ch === "*") re += ".*";
    else if (ch === "_") re += ".";
    else re += ch.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&");
  }
  return new RegExp(`^${re}$`, flags + "s");
}

/** PostgreSQL array/JSON literal ({a,b} or ["a"]) to a JS array/object. */
function parseLiteral(v) {
  const t = v.trim();
  if (t.startsWith("{") && t.endsWith("}") && !t.includes(":")) return splitTop(t.slice(1, -1)).filter((x) => x !== "").map(unquote);
  try { return JSON.parse(t); } catch { return t; }
}

function contains(col, want) {
  const same = (c, w) => JSON.stringify(c) === JSON.stringify(w) || (typeof w !== "object" && String(c) === String(w));
  if (Array.isArray(col)) return (Array.isArray(want) ? want : [want]).every((w) => col.some((c) => same(c, w)));
  if (col && typeof col === "object" && want && typeof want === "object") return Object.entries(want).every(([k, v]) => (typeof v === "object" ? contains(col[k], v) : eqValue(col[k], v)));
  return false;
}

/** Evaluate one operator. Returns true/false (null counts as false). */
function applyOp(op, colVal, raw) {
  switch (op) {
    case "eq": return eqValue(colVal, raw);
    case "neq": return colVal != null && !eqValue(colVal, raw);
    case "gt": return colVal != null && compare(colVal, raw) > 0;
    case "gte": return colVal != null && compare(colVal, raw) >= 0;
    case "lt": return colVal != null && compare(colVal, raw) < 0;
    case "lte": return colVal != null && compare(colVal, raw) <= 0;
    case "like": return colVal != null && likeToRegex(raw, "").test(String(colVal));
    case "ilike": return colVal != null && likeToRegex(raw, "i").test(String(colVal));
    case "match": return colVal != null && new RegExp(raw).test(String(colVal));
    case "imatch": return colVal != null && new RegExp(raw, "i").test(String(colVal));
    case "in": {
      const list = splitTop(raw.replace(/^\(|\)$/g, "")).map(unquote);
      return colVal != null && list.some((v) => eqValue(colVal, v));
    }
    case "is": {
      const v = raw.toLowerCase();
      if (v === "null") return colVal == null;
      if (v === "not_null") return colVal != null;
      if (v === "true") return colVal === true;
      if (v === "false") return colVal === false;
      if (v === "unknown") return colVal == null;
      return false;
    }
    case "isdistinct": return raw === "null" ? colVal != null : !(colVal != null && eqValue(colVal, raw));
    case "cs": return colVal != null && contains(colVal, parseLiteral(raw));
    case "cd": { const want = parseLiteral(raw); return Array.isArray(colVal) && Array.isArray(want) && colVal.every((c) => want.some((w) => eqValue(c, w))); }
    case "ov": { const want = parseLiteral(raw); return Array.isArray(colVal) && Array.isArray(want) && colVal.some((c) => want.some((w) => eqValue(c, w))); }
    case "fts": case "plfts": case "phfts": case "wfts": {
      const words = raw.replace(/^\([^)]*\)/, "").split(/[\s&|]+/).filter(Boolean);
      return colVal != null && words.every((w) => String(colVal).toLowerCase().includes(w.toLowerCase()));
    }
    default: throw new MockError(400, { code: "PGRST100", message: `mock: unsupported operator "${op}"`, details: null, hint: null });
  }
}

class MockError extends Error {
  constructor(status, body) { super(body.message); this.status = status; this.body = body; }
}

// ─── Filters ────────────────────────────────────────────────────────────────
// A filter node: { kind: "cond", path, op, value, not } | { kind: "and"|"or", items, not }
function parseCondValue(expr) {
  // "op.value", "not.op.value"
  let not = false;
  let rest = expr;
  if (rest.startsWith("not.")) { not = true; rest = rest.slice(4); }
  const dot = rest.indexOf(".");
  if (dot < 0) throw new MockError(400, { code: "PGRST100", message: `mock: cannot parse filter "${expr}"`, details: null, hint: null });
  let op = rest.slice(0, dot);
  let value = rest.slice(dot + 1);
  // quantified forms like eq(any).{a,b}
  const q = op.match(/^(\w+)\((any|all)\)$/);
  if (q) {
    const list = parseLiteral(value);
    return { op: q[1], value, not, quant: q[2], list: Array.isArray(list) ? list : [list] };
  }
  return { op, value, not };
}

function parseLogic(kind, inner, not = false) {
  // inner: "a.eq.1,b.is.null,and(c.gt.2,d.lt.3)"
  const items = splitTop(inner).map((part) => {
    const p = part.trim();
    const m = p.match(/^(not\.)?(and|or)\((.*)\)$/s);
    if (m) return parseLogic(m[2], m[3], !!m[1]);
    // column path may contain -> ; split column from operator at the first "." after the path
    const firstDot = findPathEnd(p);
    const path = p.slice(0, firstDot);
    const cond = parseCondValue(p.slice(firstDot + 1));
    return { kind: "cond", path, ...cond, value: unquote(cond.value) };
  });
  return { kind, items, not };
}

/** Index of the "." that ends a column path (a JSON path's keys may not contain dots). */
function findPathEnd(s) {
  let i = 0;
  while (i < s.length) {
    if (s.startsWith("->>", i)) { i += 3; continue; }
    if (s.startsWith("->", i)) { i += 2; continue; }
    if (s[i] === ".") return i;
    i++;
  }
  return s.length;
}

function evalNode(node, row, ctx) {
  let r;
  if (node.kind === "cond") {
    const v = ctx.get(row, node.path);
    if (node.quant) {
      const tests = node.list.map((x) => applyOp(node.op, v, String(x)));
      r = node.quant === "any" ? tests.some(Boolean) : tests.every(Boolean);
    } else {
      r = applyOp(node.op, v, node.value);
    }
    // NULL semantics: a negated test on a NULL column is still not true (except is)
    if (node.not) r = node.op === "is" || node.op === "isdistinct" ? !r : v == null ? false : !r;
    return r;
  }
  r = node.kind === "and" ? node.items.every((n) => evalNode(n, row, ctx)) : node.items.some((n) => evalNode(n, row, ctx));
  return node.not ? !r : r;
}

// ─── Select parsing ─────────────────────────────────────────────────────────
// Item: { type: "star" } | { type: "col", path, alias } | { type: "embed", alias, rel, hint, inner, items, spread }
function parseSelect(sel) {
  const s = (sel ?? "*").replace(/\s+(?=(?:[^"]*"[^"]*")*[^"]*$)/g, "");
  if (s === "") return [{ type: "star" }];
  return splitTop(s).filter(Boolean).map((part) => {
    const paren = part.indexOf("(");
    if (paren > 0 && part.endsWith(")")) {
      let head = part.slice(0, paren);
      const inner = part.slice(paren + 1, -1);
      let spread = false;
      if (head.startsWith("...")) { spread = true; head = head.slice(3); }
      let alias = null;
      const colon = head.indexOf(":");
      if (colon > 0) { alias = head.slice(0, colon); head = head.slice(colon + 1); }
      const [rel, ...hints] = head.split("!");
      if (["count", "sum", "avg", "min", "max"].includes(rel) && inner === "") return { type: "agg", fn: rel, alias: alias ?? rel };
      const inner2 = hints.includes("inner");
      const hint = hints.find((h) => h !== "inner" && h !== "left") ?? null;
      return { type: "embed", alias: alias ?? rel, rel, hint, inner: inner2, items: parseSelect(inner), spread };
    }
    if (part === "*") return { type: "star" };
    let alias = null;
    let rest = part;
    const colon = rest.search(/:(?!:)/);
    if (colon > 0 && rest[colon - 1] !== ":") { alias = rest.slice(0, colon); rest = rest.slice(colon + 1); }
    rest = rest.replace(/::\w+(\[\])?$/, "");
    if (rest.endsWith(".count()") || rest === "count()") return { type: "agg", fn: "count", alias: alias ?? "count" };
    const name = alias ?? rest.split(/->>|->/).pop().replace(/^'|'$/g, "");
    return { type: "col", path: rest, alias: name };
  });
}

// ─── The store ──────────────────────────────────────────────────────────────
export class MockStore {
  constructor() {
    this.tables = {};
    this.storage = new Map(); // "bucket/path" -> { bytes: Buffer, contentType }
    this.emails = [];
    this.unknown = { tables: new Set(), rpcs: new Set() };
    this.rpcCalls = [];
    this.requests = [];
    /** Tables answered as missing (PGRST205), e.g. new Set(["bag_shipments"]). */
    this.missingTables = new Set();
    this.orderSeq = 2600;
    this.rpcHandlers = defaultRpcs(this);
  }

  table(name) {
    if (!this.tables[name]) this.tables[name] = [];
    return this.tables[name];
  }

  load(seed) {
    this.tables = {};
    this.storage = new Map();
    this.emails = [];
    this.shippo = null; // the fake Shippo (mock-shippo.mjs): off again, no calls
    this.rpcCalls = [];
    this.unknown = { tables: new Set(), rpcs: new Set() };
    for (const [t, rows] of Object.entries(seed?.tables ?? {})) this.tables[t] = clone(rows);
    for (const [k, v] of Object.entries(seed?.storage ?? {})) this.storage.set(k, v);
    const nums = (this.tables.orders ?? []).map((o) => Number(String(o.order_number ?? "").replace(/^CD-/, ""))).filter(Number.isFinite);
    this.orderSeq = Math.max(2600, ...nums);
  }

  // Relationship from a parent table to an embedded name
  relation(parent, rel, hint) {
    const pf = fksOf(parent);
    // Two FKs between the same tables with no hint: PostgREST refuses (PGRST201), so do we
    // (card_moves.from_location_id / to_location_id -> locations)
    if (!hint) {
      const m2o = Object.values(pf).filter((fk) => fk.table === rel).length;
      const o2m = Object.values(fksOf(rel)).filter((fk) => fk.table === parent).length;
      if (m2o > 1 || (!m2o && o2m > 1)) {
        throw new MockError(300, { code: "PGRST201", message: `Could not embed because more than one relationship was found for '${parent}' and '${rel}'`, details: null, hint: `Try changing '${rel}' to one of the FK columns, e.g. '${rel}!<column>'` });
      }
    }
    // many-to-one: parent column points at rel table
    for (const [col, fk] of Object.entries(pf)) {
      if (fk.table === rel && (!hint || hint === col || hint.includes(col))) return { type: "m2o", col, target: rel };
    }
    // the embed is named after the FK column itself (e.g. bag_id(...)) or a hint names it
    if (pf[rel]) return { type: "m2o", col: rel, target: pf[rel].table };
    // one-to-many: rel table has a column pointing back at parent
    for (const [col, fk] of Object.entries(fksOf(rel))) {
      if (fk.table === parent && (!hint || hint === col || hint.includes(col))) return { type: "o2m", col, target: rel };
    }
    // heuristics from naming: <singular>_id
    const singular = (t) => t.replace(/ies$/, "y").replace(/s$/, "");
    const m2oCol = `${singular(rel)}_id`;
    if (this.table(parent).some((r) => m2oCol in r)) return { type: "m2o", col: m2oCol, target: rel };
    const o2mCol = `${singular(parent)}_id`;
    if (this.table(rel).some((r) => o2mCol in r)) return { type: "o2m", col: o2mCol, target: rel };
    this.unknown.tables.add(`${parent}->${rel}`);
    return { type: "o2m", col: o2mCol, target: rel };
  }

  pkOf(table) { return SCHEMA[table]?.pk ?? ["id"]; }
}

function defaultRpcs(store) {
  const nyToday = () => new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
  return {
    // Same rule as the live function (and the intake migration): unfinished,
    // non-refunded cards still awaiting arrival don't count
    backlog_now: () => {
      const orders = store.table("orders").filter((o) => ["received", "in_progress", "awaiting_restoration"].includes(o.status) && ["paid", "refunded"].includes(o.payment_status));
      let total = 0, prep = 0, count = 0;
      for (const o of orders) {
        const n = store.table("cards").filter((c) => c.order_id === o.id && !c.completed && (c.status ?? "") !== "refunded" && !c.awaiting_arrival).length;
        total += n;
        if (["prep", "prep_standard"].includes(o.restoration_tier)) prep += n;
        if (n > 0) count++;
      }
      return { total, prep, orders: count, unknown_orders: 0, as_of: now(), tracking_start: "2026-10-23T00:00:00Z" };
    },
    backlog_report: () => [],
    service_report: () => [],
    revenue_series: () => {
      const today = nyToday();
      return { today, now_hour: `${today}T12:00:00`, daily: [], hourly: [], refunds_this_month: { count: 0, cents: 0, pending_cents: 0 } };
    },
    checkout_funnel_report: () => ({ days: [], totals: {} }),
    checkout_unpaid_orders: () => ({ rows: [], total: 0 }),
    tier_slot_orders: () => [],
    account_signup_state: () => null,
    search_card_catalog: () => [],
  };
}

// ─── Query execution ────────────────────────────────────────────────────────
function parseOrder(spec) {
  return splitTop(spec).filter(Boolean).map((term) => {
    const parts = term.split(".");
    let path = parts[0];
    let dir = "asc", nulls = null;
    for (const p of parts.slice(1)) {
      if (p === "asc" || p === "desc") dir = p;
      else if (p === "nullsfirst") nulls = "first";
      else if (p === "nullslast") nulls = "last";
      else path += "." + p;
    }
    return { path, dir, nulls: nulls ?? (dir === "asc" ? "last" : "first") };
  });
}

function sortRows(rows, orders, get) {
  if (!orders.length) return rows;
  return [...rows].sort((a, b) => {
    for (const o of orders) {
      const va = get(a, o.path), vb = get(b, o.path);
      if (va == null || vb == null) {
        if (va == null && vb == null) continue;
        return (va == null) === (o.nulls === "first") ? -1 : 1;
      }
      const c = compare(va, vb);
      if (c !== 0) return o.dir === "asc" ? c : -c;
    }
    return 0;
  });
}

/**
 * Parse the query string into: filters per table path ("" = root, "cards" =
 * an embed alias path), order/limit/offset per path.
 */
function parseQuery(sp) {
  const q = { filters: {}, order: {}, limit: {}, offset: {}, select: null, onConflict: null, columns: null };
  const add = (path, node) => { (q.filters[path] ??= []).push(node); };
  for (const [key, value] of sp.entries()) {
    if (key === "select") { q.select = value; continue; }
    if (key === "on_conflict") { q.onConflict = value.split(",").map((c) => unquote(c)); continue; }
    if (key === "columns") { q.columns = value.split(",").map((c) => unquote(c)); continue; }
    const m = key.match(/^(?:(.+)\.)?(order|limit|offset|or|and|not\.or|not\.and)$/);
    if (m && !key.includes("->")) {
      const path = m[1] ?? "";
      if (m[2] === "order") q.order[path] = parseOrder(value);
      else if (m[2] === "limit") q.limit[path] = Number(value);
      else if (m[2] === "offset") q.offset[path] = Number(value);
      else {
        const not = m[2].startsWith("not.");
        const kind = m[2].replace("not.", "");
        add(path, parseLogic(kind, value.replace(/^\(|\)$/g, ""), not));
      }
      continue;
    }
    // column filter, possibly on an embed: cards.status / orders.payment_status
    const end = key.indexOf("->") >= 0 ? key.indexOf("->") : key.length;
    const head = key.slice(0, end);
    const lastDot = head.lastIndexOf(".");
    const path = lastDot >= 0 ? head.slice(0, lastDot) : "";
    const col = lastDot >= 0 ? key.slice(lastDot + 1) : key;
    const cond = parseCondValue(value);
    add(path, { kind: "cond", path: col, ...cond });
  }
  return q;
}

class Query {
  constructor(store, table, q) {
    this.store = store; this.table = table; this.q = q;
  }

  // Build the rows for an embed path ("" root), applying filters at that level.
  // Returns shaped output rows plus whether each passes inner-join requirements.
  shape(table, rows, items, path) {
    const store = this.store;
    const get = (row, p) => getPath(row, p);
    const filters = this.q.filters[path] ?? [];
    const embeds = items.filter((i) => i.type === "embed");
    const out = [];
    for (const row of rows) {
      // embedded rows first (filters on embeds and inner joins depend on them)
      const embedded = {};
      let keep = true;
      for (const e of embeds) {
        const rel = store.relation(table, e.rel, e.hint);
        const subPath = path ? `${path}.${e.alias}` : e.alias;
        let children;
        if (rel.type === "m2o") {
          const fkVal = row[rel.col];
          children = fkVal == null ? [] : store.table(rel.target).filter((r) => eqValue(r[store.pkOf(rel.target)[0]], fkVal) || r[store.pkOf(rel.target)[0]] === fkVal);
        } else {
          const pk = store.pkOf(table)[0];
          children = store.table(rel.target).filter((r) => r[rel.col] != null && r[rel.col] === row[pk]);
        }
        let shaped = this.shape(rel.target, children, e.items, subPath);
        shaped = sortRows(shaped.map((s) => s), this.q.order[subPath] ?? [], (r, p) => getPath(r.__raw, p));
        const off = this.q.offset[subPath] ?? 0;
        if (this.q.limit[subPath] != null || off) shaped = shaped.slice(off, this.q.limit[subPath] != null ? off + this.q.limit[subPath] : undefined);
        // a filter on the embed (or its own embeds) that removes everything: inner joins drop the parent
        if (e.inner && shaped.length === 0) keep = false;
        // Filters on embedded columns that hold no match make a non-inner embed null/empty
        const value = rel.type === "m2o" ? (shaped[0]?.out ?? null) : shaped.map((s) => s.out);
        embedded[e.alias] = { value, spread: e.spread, raw: rel.type === "m2o" ? shaped[0]?.__raw ?? null : shaped.map((s) => s.__raw) };
      }
      if (!keep) continue;
      const ctx = {
        get: (r, p) => {
          // "alias.col" inside or=() on root refers to an embed; plain cols to the row
          const dot = findPathEnd(p);
          if (dot < p.length && embedded[p.slice(0, dot)] !== undefined) {
            const emb = embedded[p.slice(0, dot)].raw;
            const sub = p.slice(dot + 1);
            return Array.isArray(emb) ? emb.map((x) => getPath(x, sub)).find((v) => v != null) : getPath(emb, sub);
          }
          return get(r, p);
        },
      };
      if (!filters.every((f) => evalNode(f, row, ctx))) continue;
      // Shape output
      const o = {};
      for (const it of items) {
        if (it.type === "star") Object.assign(o, clone(row));
        else if (it.type === "col") { const v = getPath(row, it.path); o[it.alias] = v === undefined ? null : clone(v); }
        else if (it.type === "embed") {
          const emb = embedded[it.alias];
          if (it.spread && emb.value && !Array.isArray(emb.value)) Object.assign(o, emb.value);
          else o[it.alias] = emb.value;
        }
      }
      out.push({ out: o, __raw: row });
    }
    return out;
  }

  run() {
    const rows = this.store.table(this.table);
    const items = parseSelect(this.q.select);
    let shaped = this.shape(this.table, rows, items, "");
    shaped = sortRows(shaped, this.q.order[""] ?? [], (r, p) => getPath(r.__raw, p));
    return { shaped, items };
  }

  /** Root rows matching the filters (raw rows, for PATCH/DELETE). */
  matchRaw() {
    const items = [{ type: "star" }, ...embedsNeededByFilters(this.q)];
    const shaped = this.shape(this.table, this.store.table(this.table), items, "");
    let raw = shaped.map((s) => s.__raw);
    raw = sortRows(raw, this.q.order[""] ?? [], getPath);
    const off = this.q.offset[""] ?? 0;
    if (this.q.limit[""] != null) raw = raw.slice(off, off + this.q.limit[""]);
    return raw;
  }
}

function embedsNeededByFilters(q) {
  // For PATCH/DELETE with filters on embedded tables (rare): embed with !inner
  return Object.keys(q.filters).filter((p) => p && !p.includes(".")).map((p) => ({ type: "embed", alias: p, rel: p, hint: null, inner: true, items: [{ type: "star" }] }));
}

// ─── Writes ─────────────────────────────────────────────────────────────────
function pgError(status, code, message, details = null, hint = null) {
  return new MockError(status, { code, message, details, hint });
}

function applyDefaults(store, table, row, explicitNulls) {
  const def = SCHEMA[table]?.defaults?.() ?? {};
  const pk = store.pkOf(table);
  const out = { ...row };
  if (pk.length === 1 && pk[0] === "id" && out.id == null && !explicitNulls.has("id")) out.id = uuid();
  if (!SCHEMA[table]?.noCreatedAt && out.created_at == null && !explicitNulls.has("created_at")) out.created_at = now();
  for (const [k, v] of Object.entries(def)) if (!(k in out) && !explicitNulls.has(k)) out[k] = v;
  return out;
}

function beforeInsert(store, table, row) {
  if (table === "orders" && row.order_number == null) row.order_number = `CD-${++store.orderSeq}`;
  if (table === "cards" && row.completed && row.completed_at == null) row.completed_at = now();
  if (table === "show_dropoffs") { row.created_at = now(); row.updated_at = now(); row.signed_at = now(); }
  if (table === "store_config") row.updated_at = now();
  if (table === "bag_shipments") bagShipmentGuard(store, row);
}

function bagShipmentGuard(store, row) {
  // bag_shipments_guard(): the bag (when there is one) must belong to the order
  if (row.bag_id == null) return;
  if (!store.table("tier_bags").some((b) => b.id === row.bag_id && b.order_id === row.order_id)) {
    throw pgError(400, "23514", `bag ${row.bag_id} is not a bag of order ${row.order_id}`);
  }
}

function beforeUpdate(store, table, oldRow, row) {
  if (table === "orders") row.updated_at = now();
  if (table === "bag_shipments") {
    if (row.bag_id !== oldRow.bag_id || row.order_id !== oldRow.order_id) bagShipmentGuard(store, row);
    row.updated_at = now();
  }
  if (table === "cards" && row.completed !== oldRow.completed) row.completed_at = row.completed ? now() : null;
  if (table === "tier_bag_due_changes") throw pgError(400, "P0001", "tier_bag_due_changes rows cannot be changed");
}

function afterUpdate(store, table, oldRow, row) {
  // orders_complete_cards_on_ship
  if (table === "orders" && row.status !== oldRow.status && ["shipped_back", "delivered"].includes(row.status)) {
    for (const c of store.table("cards")) {
      if (c.order_id === row.id && !c.completed && (c.status ?? "") !== "refunded") {
        c.completed = true;
        c.completed_at = now();
      }
    }
  }
}

function checkRow(store, table, row, allRows, selfIndex) {
  const sch = SCHEMA[table];
  if (!sch) return;
  for (const col of sch.notNull ?? []) {
    if (row[col] == null) throw pgError(400, "23502", `null value in column "${col}" of relation "${table}" violates not-null constraint`, `Failing row contains (${row.id ?? ""}).`);
  }
  for (const [name, fn] of Object.entries(sch.checks ?? {})) {
    if (!fn(row)) throw pgError(400, "23514", `new row for relation "${table}" violates check constraint "${name}"`, `Failing row contains (${row.id ?? ""}).`);
  }
  for (const [col, fk] of Object.entries(sch.fks ?? {})) {
    if (row[col] == null) continue;
    const target = store.table(fk.table);
    // FKs to tables the seed doesn't model are not enforced
    if (!store.tables[fk.table] && !SCHEMA[fk.table]) continue;
    if (!target.some((r) => r[store.pkOf(fk.table)[0]] === row[col])) {
      throw pgError(409, "23503", `insert or update on table "${table}" violates foreign key constraint "${table}_${col}_fkey"`, `Key (${col})=(${row[col]}) is not present in table "${fk.table}".`);
    }
  }
  const uniques = [{ name: `${table}_pkey`, cols: store.pkOf(table) }, ...(sch.unique ?? [])];
  for (const u of uniques) {
    if (u.cols.some((c) => row[c] == null)) continue;
    // A partial unique index (create unique index ... where <predicate>) covers only matching rows
    if (u.where && !u.where(row)) continue;
    const clash = allRows.findIndex((r, i) => i !== selfIndex && (!u.where || u.where(r)) && u.cols.every((c) => r[c] != null && r[c] === row[c]));
    if (clash >= 0) {
      throw pgError(409, "23505", `duplicate key value violates unique constraint "${u.name}"`, `Key (${u.cols.join(", ")})=(${u.cols.map((c) => row[c]).join(", ")}) already exists.`);
    }
  }
}

function insertRows(store, table, body, q, prefer) {
  const list = Array.isArray(body) ? body : [body];
  const missingDefault = prefer.missing === "default";
  const resolution = prefer.resolution; // merge-duplicates | ignore-duplicates
  const rows = clone(store.table(table));
  const inserted = [];
  const conflictCols = q.onConflict ?? store.pkOf(table);
  for (const input of list) {
    if (input == null || typeof input !== "object") throw pgError(400, "PGRST102", "mock: invalid insert body");
    const explicitNulls = new Set();
    const given = { ...input };
    // Bulk insert with columns=: missing keys are NULL (not the default) unless Prefer missing=default
    if (q.columns && !missingDefault) {
      for (const c of q.columns) if (!(c in given)) { given[c] = null; explicitNulls.add(c); }
    }
    for (const [k, v] of Object.entries(given)) if (v === null) explicitNulls.add(k);
    // NULL given explicitly for a column with a default stays NULL (as in Postgres)
    let row = applyDefaults(store, table, Object.fromEntries(Object.entries(given).filter(([, v]) => v !== undefined)), explicitNulls);
    beforeInsert(store, table, row);
    if (resolution) {
      const idx = rows.findIndex((r) => conflictCols.every((c) => r[c] != null && r[c] === row[c]));
      if (idx >= 0) {
        if (resolution === "ignore-duplicates") continue;
        const old = rows[idx];
        const merged = { ...old };
        for (const k of Object.keys(given)) merged[k] = row[k];
        beforeUpdate(store, table, old, merged);
        checkRow(store, table, merged, rows, idx);
        rows[idx] = merged;
        inserted.push(merged);
        continue;
      }
    }
    checkRow(store, table, row, rows, -1);
    rows.push(row);
    inserted.push(row);
  }
  store.tables[table] = rows;
  return inserted;
}

function updateRows(store, table, q, patch) {
  if (!patch || typeof patch !== "object" || Array.isArray(patch)) throw pgError(400, "PGRST102", "mock: invalid update body");
  const targets = new Query(store, table, q).matchRaw();
  if (SCHEMA[table]?.immutable && targets.length) throw pgError(400, "P0001", `${table} rows cannot be changed`);
  const rows = clone(store.table(table));
  const ids = new Set(targets.map((t) => store.table(table).indexOf(t)));
  const updated = [];
  const pairs = [];
  for (const idx of ids) {
    const old = rows[idx];
    const row = { ...old, ...clone(patch) };
    beforeUpdate(store, table, old, row);
    rows[idx] = row;
    pairs.push([old, row]);
    updated.push(row);
  }
  for (const idx of ids) checkRow(store, table, rows[idx], rows, idx);
  store.tables[table] = rows;
  for (const [old, row] of pairs) afterUpdate(store, table, old, row);
  return updated;
}

function deleteRows(store, table, q) {
  if (SCHEMA[table]?.noDelete) {
    const n = new Query(store, table, q).matchRaw().length;
    if (n) throw pgError(400, "23514", SCHEMA[table].noDelete);
  }
  const snapshot = clone(store.tables);
  try {
    const targets = new Query(store, table, q).matchRaw();
    const deleted = targets.map((t) => clone(t));
    const deferred = [];
    cascadeDelete(store, table, new Set(targets), deferred);
    // NO ACTION foreign keys: checked once the whole delete (cascades included) is done
    for (const { childTable, col, table: parent, pk, keys } of deferred) {
      const left = store.table(childTable).find((r) => keys.has(r[col]));
      if (left) {
        throw pgError(409, "23503", `update or delete on table "${parent}" violates foreign key constraint "${childTable}_${col}_fkey" on table "${childTable}"`, `Key (${pk})=(${left[col]}) is still referenced from table "${childTable}".`);
      }
    }
    return deleted;
  } catch (e) {
    store.tables = snapshot;
    throw e;
  }
}

function cascadeDelete(store, table, targetSet, deferred = []) {
  if (!targetSet.size) return;
  const pk = store.pkOf(table)[0];
  const keys = new Set([...targetSet].map((r) => r[pk]));
  store.tables[table] = store.table(table).filter((r) => !targetSet.has(r));
  for (const [childTable, sch] of Object.entries(SCHEMA)) {
    for (const [col, fk] of Object.entries(sch.fks ?? {})) {
      if (fk.table !== table) continue;
      const children = store.table(childTable).filter((r) => keys.has(r[col]));
      if (!children.length) continue;
      if (fk.onDelete === "cascade") {
        if (SCHEMA[childTable]?.noDelete) throw pgError(400, "23514", SCHEMA[childTable].noDelete);
        cascadeDelete(store, childTable, new Set(children), deferred);
      } else if (fk.onDelete === "set null") children.forEach((c) => { c[col] = null; });
      else if (fk.onDelete === "no action") deferred.push({ childTable, col, table, pk, keys });
      else throw pgError(409, "23503", `update or delete on table "${table}" violates foreign key constraint "${childTable}_${col}_fkey" on table "${childTable}"`, `Key (${pk})=(${[...keys][0]}) is still referenced from table "${childTable}".`);
    }
  }
}

// ─── Storage ────────────────────────────────────────────────────────────────
function crc32(buf) {
  let c, crc = 0xffffffff;
  for (let n = 0; n < buf.length; n++) {
    c = (crc ^ buf[n]) & 0xff;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    crc = (crc >>> 8) ^ c;
  }
  return (crc ^ 0xffffffff) >>> 0;
}

/** A small solid-colour PNG with a white border (a stand-in "card photo"). */
export function placeholderPng(rgb = [40, 80, 200], w = 120, h = 168) {
  const raw = Buffer.alloc((w * 3 + 1) * h);
  for (let y = 0; y < h; y++) {
    raw[y * (w * 3 + 1)] = 0;
    for (let x = 0; x < w; x++) {
      const border = x < 6 || y < 6 || x >= w - 6 || y >= h - 6;
      const stripe = !border && Math.floor((x + y) / 14) % 2 === 0;
      const px = border ? [255, 255, 255] : stripe ? rgb : rgb.map((v) => Math.min(255, v + 40));
      raw.set(px, y * (w * 3 + 1) + 1 + x * 3);
    }
  }
  const chunk = (type, data) => {
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type), data]);
    const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
    return Buffer.concat([len, td, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk("IHDR", ihdr), chunk("IDAT", zlib.deflateSync(raw)), chunk("IEND", Buffer.alloc(0))]);
}

function parseMultipartFile(body, contentType) {
  const m = contentType.match(/boundary=(?:"([^"]+)"|([^;]+))/);
  if (!m) return { bytes: body, contentType: "application/octet-stream" };
  const boundary = Buffer.from(`--${m[1] ?? m[2]}`);
  let start = body.indexOf(boundary);
  while (start >= 0) {
    const next = body.indexOf(boundary, start + boundary.length);
    if (next < 0) break;
    const part = body.subarray(start + boundary.length + 2, next - 2);
    const sep = part.indexOf("\r\n\r\n");
    const headers = part.subarray(0, sep).toString();
    if (/filename=/.test(headers) || /name="file"|name=""/.test(headers)) {
      const ct = headers.match(/content-type:\s*([^\r\n]+)/i)?.[1] ?? "application/octet-stream";
      return { bytes: Buffer.from(part.subarray(sep + 4)), contentType: ct };
    }
    start = next;
  }
  return { bytes: body, contentType: "application/octet-stream" };
}

function handleStorage(store, req, res, url, body) {
  const p = decodeURIComponent(url.pathname.replace(/^\/storage\/v1/, ""));
  const send = (status, obj, headers = {}) => { res.writeHead(status, { "content-type": "application/json", ...headers }); res.end(JSON.stringify(obj)); };
  const serve = (key) => {
    const f = store.storage.get(key);
    if (!f) return send(404, { statusCode: "404", error: "not_found", message: "Object not found" });
    res.writeHead(200, { "content-type": f.contentType, "content-length": f.bytes.length, "cache-control": "no-store", "access-control-allow-origin": "*" });
    return res.end(req.method === "HEAD" ? undefined : f.bytes);
  };
  let m;
  if (req.method === "GET" || req.method === "HEAD") {
    if ((m = p.match(/^\/object\/(?:public|authenticated)\/(.+)$/))) return serve(m[1]);
    if ((m = p.match(/^\/object\/sign\/(.+)$/))) return serve(m[1]);
    if ((m = p.match(/^\/render\/image\/(?:public|authenticated|sign)\/(.+)$/))) return serve(m[1]);
    if ((m = p.match(/^\/object\/info\/(?:public\/|authenticated\/)?(.+)$/))) {
      const f = store.storage.get(m[1]);
      return f ? send(200, { name: m[1], size: f.bytes.length, content_type: f.contentType }) : send(404, { message: "Object not found" });
    }
    if ((m = p.match(/^\/object\/(.+)$/))) return serve(m[1]);
    if (p === "/bucket") return send(200, [{ id: "card-photos", name: "card-photos", public: true }]);
    if ((m = p.match(/^\/bucket\/(.+)$/))) return send(200, { id: m[1], name: m[1], public: true });
  }
  if (req.method === "POST" || req.method === "PUT") {
    if ((m = p.match(/^\/object\/upload\/sign\/(.+)$/))) {
      if (req.method === "POST") {
        const token = crypto.randomBytes(8).toString("hex");
        return send(200, { url: `/object/upload/sign/${m[1]}?token=${token}`, token });
      }
      const ct = req.headers["content-type"] ?? "application/octet-stream";
      const file = ct.startsWith("multipart/form-data") ? parseMultipartFile(body, ct) : { bytes: body, contentType: ct };
      store.storage.set(m[1], file);
      return send(200, { Key: m[1], Id: uuid() });
    }
    if ((m = p.match(/^\/object\/sign\/([^/]+)$/)) && req.method === "POST") {
      const { paths = [] } = JSON.parse(body.toString() || "{}");
      return send(200, paths.map((path) => ({ path, signedURL: `/object/sign/${m[1]}/${path}?token=mock`, error: store.storage.has(`${m[1]}/${path}`) ? null : "Either the object does not exist or you do not have access to it" })));
    }
    if ((m = p.match(/^\/object\/sign\/(.+)$/))) return send(200, { signedURL: `/object/sign/${m[1]}?token=mock` });
    if ((m = p.match(/^\/object\/list\/(.+)$/))) {
      const { prefix = "" } = JSON.parse(body.toString() || "{}");
      const keys = [...store.storage.keys()].filter((k) => k.startsWith(`${m[1]}/${prefix}`));
      return send(200, keys.map((k) => ({ name: k.slice(m[1].length + 1 + prefix.length).replace(/^\//, ""), id: k, metadata: { size: store.storage.get(k).bytes.length } })));
    }
    if ((m = p.match(/^\/object\/(copy|move)$/))) {
      const { bucketId, sourceKey, destinationKey } = JSON.parse(body.toString() || "{}");
      const f = store.storage.get(`${bucketId}/${sourceKey}`);
      if (!f) return send(404, { message: "Object not found" });
      store.storage.set(`${bucketId}/${destinationKey}`, f);
      if (m[1] === "move") store.storage.delete(`${bucketId}/${sourceKey}`);
      return send(200, { message: "Successfully", Key: `${bucketId}/${destinationKey}` });
    }
    if ((m = p.match(/^\/object\/(.+)$/))) {
      const key = m[1];
      const upsert = String(req.headers["x-upsert"] ?? "false") === "true" || req.method === "PUT";
      if (store.storage.has(key) && !upsert) return send(400, { statusCode: "409", error: "Duplicate", message: "The resource already exists" });
      const ct = req.headers["content-type"] ?? "application/octet-stream";
      const file = ct.startsWith("multipart/form-data") ? parseMultipartFile(body, ct) : { bytes: body, contentType: ct };
      store.storage.set(key, file);
      return send(200, { Key: key, Id: uuid() });
    }
  }
  if (req.method === "DELETE") {
    if ((m = p.match(/^\/object\/([^/]+)$/))) {
      const { prefixes = [] } = JSON.parse(body.toString() || "{}");
      const removed = prefixes.filter((x) => store.storage.delete(`${m[1]}/${x}`));
      return send(200, removed.map((name) => ({ name })));
    }
    if ((m = p.match(/^\/object\/(.+)$/))) { store.storage.delete(m[1]); return send(200, { message: "Successfully deleted" }); }
  }
  return send(400, { message: `mock storage: unsupported ${req.method} ${p}` });
}

// ─── Auth (nobody is ever signed in as a customer) ──────────────────────────
function handleAuth(req, res, url, body) {
  const p = url.pathname.replace(/^\/auth\/v1/, "");
  const send = (status, obj) => { res.writeHead(status, { "content-type": "application/json" }); res.end(JSON.stringify(obj)); };
  if (p === "/user") return send(401, { code: 401, error_code: "no_authorization", msg: "mock: nobody is signed in" });
  if (p === "/token") return send(400, { error: "invalid_grant", error_description: "mock: no auth server", code: 400, error_code: "invalid_credentials", msg: "Invalid login credentials" });
  if (p === "/settings") return send(200, { external: {}, disable_signup: false });
  if (p === "/logout") { res.writeHead(204); return res.end(); }
  if (p.startsWith("/admin/users")) {
    if (req.method === "GET") return send(200, { users: [], aud: "authenticated", total: 0 });
    const data = body.length ? JSON.parse(body.toString()) : {};
    return send(200, { id: uuid(), aud: "authenticated", email: data.email ?? null, created_at: now(), user_metadata: data.user_metadata ?? {} });
  }
  if (p === "/admin/generate_link") {
    const data = body.length ? JSON.parse(body.toString()) : {};
    return send(200, { id: uuid(), email: data.email, action_link: "https://example.com/mock-link", properties: { action_link: "https://example.com/mock-link", hashed_token: "mock", verification_type: data.type ?? "signup" }, user: { id: uuid(), email: data.email } });
  }
  return send(200, {});
}

// ─── Resend (RESEND_BASE_URL=<mock>/__resend) ───────────────────────────────
function handleResend(store, req, res, url, body) {
  const p = url.pathname.replace(/^\/__resend/, "");
  const send = (status, obj) => { res.writeHead(status, { "content-type": "application/json" }); res.end(JSON.stringify(obj)); };
  const data = body.length ? JSON.parse(body.toString()) : {};
  if (req.method === "POST" && p === "/emails") {
    const id = uuid();
    store.emails.push({ id, at: now(), ...data });
    return send(200, { id });
  }
  if (req.method === "POST" && p === "/emails/batch") {
    const ids = (Array.isArray(data) ? data : []).map((e) => { const id = uuid(); store.emails.push({ id, at: now(), ...e }); return { id }; });
    return send(200, { data: ids });
  }
  if (req.method === "GET" && p.startsWith("/emails/")) {
    const e = store.emails.find((x) => x.id === p.slice(8));
    return e ? send(200, { object: "email", ...e }) : send(404, { name: "not_found", message: "Email not found" });
  }
  return send(200, { data: [] });
}

// ─── HTTP server ────────────────────────────────────────────────────────────
function parsePrefer(h) {
  const out = {};
  for (const part of String(h ?? "").split(",")) {
    const [k, v] = part.trim().split("=");
    if (k) out[k] = v ?? true;
  }
  return out;
}

function stripNulls(v) {
  if (Array.isArray(v)) return v.map(stripNulls);
  if (v && typeof v === "object") return Object.fromEntries(Object.entries(v).filter(([, x]) => x !== null).map(([k, x]) => [k, stripNulls(x)]));
  return v;
}

function handleRest(store, req, res, url, body) {
  const accept = String(req.headers.accept ?? "");
  const wantsObject = accept.includes("vnd.pgrst.object");
  const nullsStripped = accept.includes("nulls=stripped");
  const prefer = parsePrefer(req.headers.prefer);
  const send = (status, payload, headers = {}) => {
    res.writeHead(status, { "content-type": "application/json; charset=utf-8", ...headers });
    if (req.method === "HEAD" || payload === undefined) return res.end();
    res.end(JSON.stringify(nullsStripped ? stripNulls(payload) : payload));
  };
  const asResult = (rows, status, total, start = 0) => {
    const range = rows.length ? `${start}-${start + rows.length - 1}` : "*";
    const headers = { "content-range": `${range}/${total ?? "*"}` };
    if (wantsObject) {
      if (rows.length !== 1) {
        return send(406, { code: "PGRST116", details: `The result contains ${rows.length} rows`, hint: null, message: "Cannot coerce the result to a single JSON object" });
      }
      return send(status, rows[0], headers);
    }
    return send(status, rows, headers);
  };

  let path = url.pathname.replace(/^\/rest\/v1\/?/, "");
  if (path.startsWith("rpc/")) {
    const fn = path.slice(4);
    let args = {};
    try { args = req.method === "GET" ? Object.fromEntries(url.searchParams) : body.length ? JSON.parse(body.toString()) : {}; } catch { args = {}; }
    store.rpcCalls.push({ fn, args, at: now() });
    const handler = store.rpcHandlers[fn];
    if (!handler) {
      store.unknown.rpcs.add(fn);
      console.warn(`[mock-supabase] unknown rpc ${fn}(${JSON.stringify(args)}) -> null`);
      return send(200, null);
    }
    const out = handler(args, store);
    return send(200, out === undefined ? null : out);
  }
  const table = decodeURIComponent(path);
  // Tests can take a table away (a migration not applied yet): PostgREST's answer
  if (store.missingTables?.has(table)) {
    return send(404, { code: "PGRST205", message: `Could not find the table 'public.${table}' in the schema cache`, details: null, hint: null });
  }
  if (!SCHEMA[table] && !store.tables[table]) {
    store.unknown.tables.add(table);
  }
  let q;
  try { q = parseQuery(url.searchParams); }
  catch (e) { if (e instanceof MockError) return send(e.status, e.body); throw e; }
  const countExact = /count=(exact|planned|estimated)/.test(String(req.headers.prefer ?? ""));

  if (req.method === "GET" || req.method === "HEAD") {
    let shaped;
    try { ({ shaped } = new Query(store, table, q).run()); }
    catch (e) { if (e instanceof MockError) return send(e.status, e.body); throw e; }
    let rows = shaped.map((s) => s.out);
    const total = rows.length;
    let start = q.offset[""] ?? 0;
    let limit = q.limit[""];
    const rangeH = req.headers.range ?? req.headers["range"];
    if (rangeH && limit == null) {
      const rm = String(rangeH).match(/(\d+)-(\d*)/);
      if (rm) { start = Number(rm[1]); if (rm[2]) limit = Number(rm[2]) - start + 1; }
    }
    rows = rows.slice(start, limit != null ? start + limit : undefined);
    return asResult(rows, 200, countExact ? total : null, start);
  }

  let parsed = null;
  if (req.method === "POST" || req.method === "PATCH") {
    try { parsed = body.length ? JSON.parse(body.toString()) : null; }
    catch { return send(400, { code: "PGRST102", message: "Empty or invalid json", details: null, hint: null }); }
  }
  const representation = prefer.return === "representation";
  const shapeOut = (rows) => {
    if (!representation) return null;
    const items = parseSelect(q.select);
    // shape returned rows through the select (embeds allowed)
    const qq = new Query(store, table, { ...q, filters: Object.fromEntries(Object.entries(q.filters).filter(([k]) => k !== "")) });
    return qq.shape(table, rows, items, "").map((s) => s.out);
  };
  try {
    if (req.method === "POST") {
      const rows = insertRows(store, table, parsed, q, prefer);
      const out = shapeOut(rows);
      if (!representation) return send(201, undefined, { "content-range": `*/${countExact ? rows.length : "*"}` });
      return asResult(out, 201, countExact ? out.length : null);
    }
    if (req.method === "PATCH") {
      const rows = updateRows(store, table, q, parsed);
      const out = shapeOut(rows);
      if (!representation) return send(204, undefined, { "content-range": `0-${rows.length - 1}/${countExact ? rows.length : "*"}` });
      return asResult(out, 200, countExact ? out.length : null);
    }
    if (req.method === "DELETE") {
      const rows = deleteRows(store, table, q);
      if (!representation) return send(204, undefined, { "content-range": `*/${countExact ? rows.length : "*"}` });
      return asResult(rows, 200, countExact ? rows.length : null);
    }
  } catch (e) {
    if (e instanceof MockError) return send(e.status, e.body);
    throw e;
  }
  return send(405, { message: `mock: ${req.method} not supported` });
}

/**
 * Start the mock. Returns { server, port, url, store, close }.
 * seedFn(baseUrl) -> { tables, storage } is called at start and on /__reset.
 */
export async function startMock({ port = 0, tls = null, seedFn = null, quiet = false } = {}) {
  const store = new MockStore();
  let baseUrl = "";
  const reseed = (withSeed = true) => store.load(withSeed && seedFn ? seedFn(baseUrl) : {});

  const handler = (req, res) => {
    const chunks = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => {
      const body = Buffer.concat(chunks);
      const url = new URL(req.url, "http://mock");
      const done = () => {
        store.requests.push({ at: now(), method: req.method, path: decodeURIComponent(url.pathname + url.search).slice(0, 400), status: res.statusCode });
        if (store.requests.length > 500) store.requests.shift();
      };
      res.on("finish", done);
      try {
        if (req.method === "OPTIONS") {
          res.writeHead(204, { "access-control-allow-origin": "*", "access-control-allow-headers": "*", "access-control-allow-methods": "*" });
          return res.end();
        }
        const p = url.pathname;
        if (p === "/__health") { res.writeHead(200, { "content-type": "application/json" }); return res.end('{"ok":true}'); }
        if (p === "/__dump" || p.startsWith("/__dump/")) {
          const t = p.slice("/__dump/".length);
          const payload = t ? store.table(t) : {
            tables: store.tables,
            emails: store.emails,
            storage: [...store.storage.entries()].map(([k, v]) => ({ key: k, contentType: v.contentType, size: v.bytes.length })),
            unknown: { tables: [...store.unknown.tables], rpcs: [...store.unknown.rpcs] },
            rpcCalls: store.rpcCalls,
            shippo: shippoDump(store),
          };
          res.writeHead(200, { "content-type": "application/json" });
          return res.end(JSON.stringify(payload));
        }
        if (p === "/__reset" && req.method === "POST") {
          const opts = body.length ? JSON.parse(body.toString()) : {};
          reseed(opts.seed !== false);
          res.writeHead(200, { "content-type": "application/json" });
          return res.end('{"ok":true}');
        }
        if (p.startsWith("/__rows/") && req.method === "POST") {
          const t = p.slice("/__rows/".length);
          const rows = JSON.parse(body.toString());
          store.table(t).push(...(Array.isArray(rows) ? rows : [rows]));
          res.writeHead(200, { "content-type": "application/json" });
          return res.end('{"ok":true}');
        }
        if (p === "/__emails") { res.writeHead(200, { "content-type": "application/json" }); return res.end(JSON.stringify(store.emails)); }
        if (p === "/__requests") { res.writeHead(200, { "content-type": "application/json" }); return res.end(JSON.stringify(store.requests)); }
        if (p.startsWith("/rest/v1")) return handleRest(store, req, res, url, body);
        if (p.startsWith("/storage/v1")) return handleStorage(store, req, res, url, body);
        if (p.startsWith("/auth/v1")) return handleAuth(req, res, url, body);
        if (p.startsWith("/__resend")) return handleResend(store, req, res, url, body);
        if (p.startsWith("/__shippo")) return void handleShippo(store, req, res, url, body, baseUrl).catch((e) => { console.error("[mock-shippo] error", e); if (!res.headersSent) res.writeHead(500); res.end(); });
        if (p.startsWith("/realtime") || p.startsWith("/functions/v1")) { res.writeHead(404); return res.end(); }
        res.writeHead(404, { "content-type": "application/json" });
        res.end(JSON.stringify({ message: `mock: no route ${req.method} ${p}` }));
      } catch (e) {
        console.error("[mock-supabase] error", req.method, req.url, e);
        if (!res.headersSent) res.writeHead(500, { "content-type": "application/json" });
        res.end(JSON.stringify({ code: "MOCK500", message: `mock crashed: ${e?.message ?? e}`, details: null, hint: null }));
      }
    });
  };

  const server = tls ? https.createServer({ key: tls.key, cert: tls.cert }, handler) : http.createServer(handler);
  server.keepAliveTimeout = 5000;
  await new Promise((resolve) => server.listen(port, "127.0.0.1", resolve));
  const actual = server.address().port;
  baseUrl = `${tls ? "https" : "http"}://localhost:${actual}`;
  reseed(true);
  if (!quiet) console.log(`[mock-supabase] listening on ${baseUrl}`);
  return {
    server, store, port: actual, url: baseUrl,
    close: () => new Promise((resolve) => { server.closeAllConnections?.(); server.close(() => resolve()); }),
  };
}

// CLI: node mock-supabase.mjs [--port N] [--https] [--no-seed]
if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  const args = process.argv.slice(2);
  const port = Number(args[args.indexOf("--port") + 1]) || 54400;
  const { buildSeed } = await import("./seed.mjs");
  let tls = null;
  if (args.includes("--https")) {
    const { ensureCert } = await import("./start.mjs");
    tls = ensureCert();
  }
  await startMock({ port, tls, seedFn: args.includes("--no-seed") ? null : (base) => buildSeed({ baseUrl: base }) });
}
