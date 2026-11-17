import { after } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createAdminClient } from "@/lib/supabase/admin";
import { PREVIEW_MODE } from "@/lib/preview";
import { IN_APP_BROWSER } from "@/lib/in-app-browser";
import type { CheckoutEvent, CheckoutFlow } from "@/lib/checkout-funnel";

/**
 * Checkout funnel tracking (server side): the table checkout_funnel_events
 * (supabase/migrations/20261118_checkout_funnel.sql) and the admin Checkout
 * Funnel page's reports.
 *
 * Rows come from two places:
 * - the browser, through POST /api/checkout/funnel (trackCheckout() in
 *   lib/checkout-funnel.ts), source 'browser';
 * - each checkout route's refusals (withRefusalTracking below), source 'server'.
 *
 * Recording never throws and never holds up the customer's answer: the insert
 * runs after the response (Next.js after()), and every failure is caught. In
 * preview mode nothing is written (lib/preview.ts refuses writes anyway), quietly.
 */

/** Every flow and event, as the migration's checks allow them. A new one goes in both places. */
export const CHECKOUT_FLOWS: Record<CheckoutFlow, true> = {
  restoration: true,
  prep: true,
  kits: true,
  gift_card: true,
  kit_club: true,
};
export const CHECKOUT_EVENTS: Record<CheckoutEvent, true> = {
  step_view: true,
  photo_added: true,
  photo_failed: true,
  blocked: true,
  submit: true,
  redirect: true,
  rejected: true,
  in_app_notice: true,
};

/** Codes and tier ids: letters, digits, _ and -, up to 64 characters. */
export const FUNNEL_CODE = /^[A-Za-z0-9_-]{1,64}$/;

/** A browser tab that sends more events than this in 24 hours is ignored (abuse guard). */
export const DAILY_EVENTS_PER_TAB = 300;

export type CheckoutEventRecord = {
  flow: CheckoutFlow;
  event: CheckoutEvent;
  step?: number | null;
  code?: string | null;
  tier?: string | null;
  cards?: number | null;
  sid?: string | null;
  device?: "phone" | "desktop" | null;
  inApp?: boolean | null;
  source: "browser" | "server";
};

/** Inserts one row. Never throws; does nothing in preview mode. */
export async function insertCheckoutEvent(ev: CheckoutEventRecord): Promise<void> {
  if (PREVIEW_MODE) return;
  try {
    const { error } = await createAdminClient().from("checkout_funnel_events").insert({
      flow: ev.flow,
      event: ev.event,
      step: ev.step ?? null,
      code: ev.code ?? null,
      tier: ev.tier ?? null,
      cards: ev.cards ?? null,
      sid: ev.sid ?? null,
      device: ev.device ?? null,
      in_app: ev.inApp ?? null,
      source: ev.source,
    });
    if (error) console.warn(`[checkout-funnel] not recorded: ${error.message}`);
  } catch (err) {
    console.warn("[checkout-funnel] not recorded:", err instanceof Error ? err.message : err);
  }
}

/** Keeps a background task running after the response is sent; outside a request it just runs. */
function inBackground(task: Promise<unknown>): void {
  try {
    after(task);
  } catch {
    // not inside a request: the task still runs on its own
  }
}

/** Records one event without waiting for it (fire and forget). Never throws. */
export function recordCheckoutEvent(ev: CheckoutEventRecord): void {
  inBackground(insertCheckoutEvent(ev));
}

/** True when this tab already sent DAILY_EVENTS_PER_TAB events in the last 24 hours. Fails open. */
export async function tabOverDailyCap(sid: string): Promise<boolean> {
  if (PREVIEW_MODE) return true;
  try {
    const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const { count, error } = await createAdminClient()
      .from("checkout_funnel_events")
      .select("id", { count: "exact", head: true })
      .eq("sid", sid)
      .gte("created_at", since);
    if (error) return false;
    return (count ?? 0) >= DAILY_EVENTS_PER_TAB;
  } catch {
    return false;
  }
}

/**
 * Runs a checkout route's handler and records its refusals (status 400 and
 * up, or a crash) as 'rejected' events with the response's `code`, else
 * HTTP_<status>. The response goes back exactly as the handler made it, and a
 * crash is thrown on as before.
 */
export async function withRefusalTracking(
  flow: CheckoutFlow,
  request: Request,
  handler: () => Promise<Response>,
): Promise<Response> {
  const inApp = (() => {
    try {
      return IN_APP_BROWSER.test(request.headers.get("user-agent") ?? "");
    } catch {
      return null;
    }
  })();
  let res: Response;
  try {
    res = await handler();
  } catch (err) {
    recordCheckoutEvent({ flow, event: "rejected", code: "HTTP_500", inApp, source: "server" });
    throw err;
  }
  try {
    if (res.status >= 400) {
      const status = res.status;
      const copy = res.clone();
      inBackground((async () => {
        let code: unknown = null;
        try {
          code = ((await copy.json()) as { code?: unknown } | null)?.code;
        } catch {
          // not JSON
        }
        await insertCheckoutEvent({
          flow,
          event: "rejected",
          code: typeof code === "string" && FUNNEL_CODE.test(code) ? code : `HTTP_${status}`,
          inApp,
          source: "server",
        });
      })().catch(() => {}));
    }
  } catch {
    // tracking never changes the answer
  }
  return res;
}

// ── Admin reports ─────────────────────────────────────────────────────────────

export type FunnelStep = {
  step: number;
  views: number;          // visits (browser tabs) that saw the step
  blocked: number;        // times Continue / Sign / Pay was pressed with something missing
  blocked_visits: number; // visits blocked at least once here
  photos_added: number;
  photos_failed: number;
  submits: number;
  redirects: number;
  rejected: number;
};

export type FunnelCode = {
  step: number | null;
  event: "blocked" | "rejected";
  source: "browser" | "server";
  code: string;
  count: number;
  visits: number; // 0 for server rows (they have no tab id)
};

export type FunnelFlow = {
  flow: CheckoutFlow;
  visits: number;
  phone: number;
  desktop: number;
  unknown_device: number;
  in_app: number;
  submits: number;
  submit_visits: number;
  redirects: number;
  redirect_visits: number;
  rejected: number;          // refusals the browser saw
  rejected_visits: number;
  server_rejected: number;   // refusals the checkout routes recorded
  server_rejected_in_app: number;
  in_app_notices: number;
  steps: FunnelStep[];
  codes: FunnelCode[];
};

export type FunnelReport = {
  from: string;
  to: string;
  first_event_at: string | null;
  flows: FunnelFlow[];
};

/** The funnel for New York days from..to (YYYY-MM-DD), counted in the database. */
export async function getCheckoutFunnel(admin: SupabaseClient, from: string, to: string): Promise<FunnelReport> {
  const { data, error } = await admin.rpc("checkout_funnel_report", { p_from: from, p_to: to });
  if (error) throw new Error(`checkout_funnel_report: ${error.message}`);
  return data as FunnelReport;
}

export type UnpaidCheckout = {
  id: string;
  order_number: string | null;
  created_at: string;
  service: "prep" | "restoration";
  tier: string | null;
  cards: number | null;
  total_cents: number | null;
  reminder_sent_at: string | null;
};

export type UnpaidCheckouts = {
  total: number;              // all of them; `orders` holds the newest 500
  reminder_tracked: boolean;  // orders.payment_reminder_sent_at exists yet
  orders: UnpaidCheckout[];
};

/** Restoration and prep checkouts placed from..to (New York days), more than 15 minutes ago, still unpaid. */
export async function getUnpaidCheckouts(admin: SupabaseClient, from: string, to: string): Promise<UnpaidCheckouts> {
  const { data, error } = await admin.rpc("checkout_unpaid_orders", { p_from: from, p_to: to });
  if (error) throw new Error(`checkout_unpaid_orders: ${error.message}`);
  return data as UnpaidCheckouts;
}
