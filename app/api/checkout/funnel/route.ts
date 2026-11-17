import { after } from "next/server";
import {
  CHECKOUT_EVENTS,
  CHECKOUT_FLOWS,
  FUNNEL_CODE,
  insertCheckoutEvent,
  tabOverDailyCap,
  type CheckoutEventRecord,
} from "@/lib/checkout-funnel-server";
import type { CheckoutEvent, CheckoutFlow } from "@/lib/checkout-funnel";

// Checkout funnel events from the browser (trackCheckout() in
// lib/checkout-funnel.ts, sent with sendBeacon or a keepalive fetch). Counts
// only: flow, event, step, code, tier, cards, a random tab id, phone or
// desktop, in-app browser. Every field is checked, unknown keys are dropped,
// and the answer (204) goes out before the row is written. Bad input gets a
// bare 400. A tab that already sent 300 events in 24 hours is ignored.

const MAX_BODY_BYTES = 1024;
const TAB_ID = /^[A-Za-z0-9-]{1,64}$/;

const ok = () => new Response(null, { status: 204 });
const bad = () => new Response(null, { status: 400 });

/** The body as text, or null when it is larger than `max` bytes. */
async function readSmallBody(request: Request, max: number): Promise<string | null> {
  const declared = Number(request.headers.get("content-length") ?? "0");
  if (!Number.isFinite(declared) || declared > max) return null;
  if (!request.body) return "";
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > max) {
      reader.cancel().catch(() => {});
      return null;
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const c of chunks) {
    bytes.set(c, offset);
    offset += c.byteLength;
  }
  return new TextDecoder().decode(bytes);
}

/** Marks a field that is present but wrong: the whole event is refused. */
const INVALID = Symbol("invalid");

/** undefined or null: absent; anything else must pass `test`. */
function optional<T>(v: unknown, test: (v: unknown) => v is T): T | null | typeof INVALID {
  if (v === undefined || v === null) return null;
  return test(v) ? v : INVALID;
}

const isInt = (min: number, max: number) => (v: unknown): v is number =>
  typeof v === "number" && Number.isInteger(v) && v >= min && v <= max;
const isCode = (v: unknown): v is string => typeof v === "string" && FUNNEL_CODE.test(v);
const isTier = (v: unknown): v is string => typeof v === "string" && v.length <= 32 && FUNNEL_CODE.test(v);
const isDevice = (v: unknown): v is "phone" | "desktop" => v === "phone" || v === "desktop";
const isBool = (v: unknown): v is boolean => typeof v === "boolean";

function parseEvent(raw: unknown): (CheckoutEventRecord & { sid: string }) | null {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return null;
  const b = raw as Record<string, unknown>;

  if (typeof b.flow !== "string" || !Object.hasOwn(CHECKOUT_FLOWS, b.flow)) return null;
  if (typeof b.event !== "string" || !Object.hasOwn(CHECKOUT_EVENTS, b.event)) return null;
  if (typeof b.sid !== "string" || !TAB_ID.test(b.sid)) return null;

  const step = optional(b.step, isInt(1, 9));
  const code = optional(b.code, isCode);
  const tier = optional(b.tier, isTier);
  const cards = optional(b.cards, isInt(0, 500));
  const device = optional(b.device, isDevice);
  const inApp = optional(b.inApp, isBool);
  if (step === INVALID || code === INVALID || tier === INVALID || cards === INVALID || device === INVALID || inApp === INVALID) return null;

  return {
    flow: b.flow as CheckoutFlow,
    event: b.event as CheckoutEvent,
    step,
    code,
    tier,
    cards,
    sid: b.sid,
    device,
    inApp,
    source: "browser",
  };
}

export async function POST(request: Request) {
  let text: string | null;
  try {
    text = await readSmallBody(request, MAX_BODY_BYTES);
  } catch {
    return bad();
  }
  if (!text) return bad();

  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return bad();
  }
  const ev = parseEvent(raw);
  if (!ev) return bad();

  // Written after the answer: the customer's page never waits on this
  after(async () => {
    if (await tabOverDailyCap(ev.sid)) return;
    await insertCheckoutEvent(ev);
  });
  return ok();
}
