import Link from "next/link";
import { requireAdmin } from "@/lib/admin-auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { formatCurrency } from "@/lib/utils";
import { addDays, etToday, formatDay } from "@/lib/dashboard-metrics";
import { RESTORATION_TIERS, type RestorationTierId } from "@/lib/restoration-tiers";
import {
  getCheckoutFunnel, getUnpaidCheckouts,
  type FunnelCode, type FunnelFlow, type FunnelReport, type UnpaidCheckouts,
} from "@/lib/checkout-funnel-server";
import type { CheckoutFlow } from "@/lib/checkout-funnel";

export const dynamic = "force-dynamic";

// Where customers leave each checkout and what stops them (lib/checkout-funnel.ts,
// lib/checkout-funnel-server.ts), counted in the database for New York days
// (supabase/migrations/20261118_checkout_funnel.sql).

const RANGES = [
  { key: "7", label: "7 Days" },
  { key: "30", label: "30 Days" },
] as const;

/** Longest custom range, in days. */
const MAX_DAYS = 366;

const FLOWS: { flow: CheckoutFlow; label: string; steps: string[] }[] = [
  { flow: "restoration", label: "Restoration", steps: ["Cards", "Your Info", "Shipping", "Review"] },
  { flow: "prep", label: "PSA Prep", steps: ["Order form"] },
  { flow: "kits", label: "Kits", steps: ["Cart", "Add-ons", "Checkout"] },
  { flow: "gift_card", label: "Gift Cards", steps: ["Gift card form"] },
  { flow: "kit_club", label: "Kit Club", steps: ["Sign-up form"] },
];

const CODE_LABELS: Record<string, string> = {
  missing_fields: "Something required missing or wrong",
  slab_unsigned: "Slab authorization not signed",
  NETWORK_ERROR: "Couldn't reach the server",
};

const DAY = /^\d{4}-\d{2}-\d{2}$/;
function isDay(s: string | undefined): s is string {
  if (!s || !DAY.test(s)) return false;
  const d = new Date(`${s}T12:00:00Z`);
  return !isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

/** Whole days from a to b (YYYY-MM-DD). */
function daysBetween(a: string, b: string): number {
  return Math.round((Date.parse(`${b}T12:00:00Z`) - Date.parse(`${a}T12:00:00Z`)) / 86_400_000);
}

function pct(part: number, whole: number): string {
  return whole > 0 ? `${Math.round((part / whole) * 100)}%` : "—";
}

function plural(n: number, word: string): string {
  return `${n.toLocaleString("en-US")} ${word}${n === 1 ? "" : "s"}`;
}

function codeLabel(code: string): string {
  return CODE_LABELS[code] ?? code;
}

function etTime(iso: string): string {
  return `${new Date(iso).toLocaleString("en-US", { timeZone: "America/New_York", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })} ET`;
}

/** "47 min", "5 h 12 min", "3 d 4 h" since a moment. */
function waitingSince(iso: string, nowMs: number): string {
  const min = Math.max(0, Math.floor((nowMs - new Date(iso).getTime()) / 60_000));
  if (min < 60) return `${min} min`;
  const h = Math.floor(min / 60);
  if (h < 24) return min % 60 ? `${h} h ${min % 60} min` : `${h} h`;
  const d = Math.floor(h / 24);
  return h % 24 ? `${d} d ${h % 24} h` : `${d} d`;
}

function tierName(tier: string | null, service: string): string {
  if (service === "prep") return "PSA Prep";
  if (!tier) return "Mixed";
  return RESTORATION_TIERS[tier as RestorationTierId]?.name ?? tier;
}

function now(): number {
  return Date.now();
}

/** The codes for one step (or the whole flow), most frequent first. */
function CodeList({ codes, empty }: { codes: FunnelCode[]; empty: string }) {
  if (codes.length === 0) return <span className="text-muted-foreground">{empty}</span>;
  const sorted = [...codes].sort((a, b) => b.count - a.count || a.code.localeCompare(b.code));
  return (
    <ul className="flex flex-col gap-0.5">
      {sorted.map((c) => (
        <li key={`${c.source}-${c.step ?? "x"}-${c.code}`}>
          <span className="font-semibold text-foreground">{codeLabel(c.code)}</span>
          {codeLabel(c.code) !== c.code && <span className="ml-1 font-mono text-[11px] text-muted-foreground">{c.code}</span>}
          <span className="text-muted-foreground">
            {" "}· {plural(c.count, "time")}{c.source === "browser" ? ` · ${plural(c.visits, "visit")}` : ""}
          </span>
        </li>
      ))}
    </ul>
  );
}

function FlowCard({ def, data }: { def: (typeof FLOWS)[number]; data: FunnelFlow }) {
  const stepRows = def.steps.map((name, i) => {
    const n = i + 1;
    const s = data.steps.find((x) => x.step === n);
    return {
      n,
      name,
      views: s?.views ?? 0,
      blocked: s?.blocked ?? 0,
      blockedVisits: s?.blocked_visits ?? 0,
      codes: data.codes.filter((c) => c.event === "blocked" && c.step === n),
    };
  });
  const lastViews = stepRows[stepRows.length - 1]?.views ?? 0;
  const photosAdded = data.steps.reduce((t, s) => t + s.photos_added, 0);
  const photosFailed = data.steps.reduce((t, s) => t + s.photos_failed, 0);
  const browserRefusals = data.codes.filter((c) => c.event === "rejected" && c.source === "browser");
  const serverRefusals = data.codes.filter((c) => c.event === "rejected" && c.source === "server");
  const known = data.phone + data.desktop;

  return (
    <section className="bg-white rounded-xl border border-border overflow-hidden" aria-labelledby={`flow-${def.flow}`}>
      <div className="px-5 py-4 border-b border-border flex flex-col sm:flex-row sm:items-end gap-2">
        <h2 id={`flow-${def.flow}`} className="font-heading font-black text-xl text-foreground flex-1">{def.label}</h2>
        <p className="text-xs text-muted-foreground">
          {plural(data.visits, "visit")} · {pct(data.phone, known)} phone · {pct(data.desktop, known)} desktop · {pct(data.in_app, data.visits)} in an app&apos;s browser
        </p>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-secondary/40 text-xs font-bold uppercase tracking-wider text-muted-foreground">
              <th scope="col" className="px-4 py-2.5 text-left whitespace-nowrap">Step</th>
              <th scope="col" className="px-4 py-2.5 text-right whitespace-nowrap">Visits</th>
              <th scope="col" className="px-4 py-2.5 text-right whitespace-nowrap">Of previous</th>
              <th scope="col" className="px-4 py-2.5 text-right whitespace-nowrap border-l border-border">Blocked</th>
              <th scope="col" className="px-4 py-2.5 text-left">Why</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border tabular-nums">
            {stepRows.map((r, i) => (
              <tr key={r.n} className="align-top">
                <td className="px-4 py-2.5 whitespace-nowrap font-semibold text-foreground">{r.n}. {r.name}</td>
                <td className="px-4 py-2.5 text-right font-semibold text-foreground">{r.views.toLocaleString("en-US")}</td>
                <td className="px-4 py-2.5 text-right text-muted-foreground">{i === 0 ? "—" : pct(r.views, stepRows[i - 1].views)}</td>
                <td className="px-4 py-2.5 text-right border-l border-border whitespace-nowrap">
                  {r.blocked > 0 ? (
                    <>
                      <span className="font-semibold text-foreground">{plural(r.blockedVisits, "visit")}</span>
                      <span className="block text-xs text-muted-foreground">{pct(r.blockedVisits, r.views)} · {plural(r.blocked, "time")}</span>
                    </>
                  ) : (
                    <span className="text-muted-foreground">0</span>
                  )}
                </td>
                <td className="px-4 py-2.5 text-xs"><CodeList codes={r.codes} empty="" /></td>
              </tr>
            ))}
            <tr className="bg-secondary/20">
              <td className="px-4 py-2.5 whitespace-nowrap font-semibold text-foreground">Submitted</td>
              <td className="px-4 py-2.5 text-right font-semibold text-foreground">{data.submit_visits.toLocaleString("en-US")}</td>
              <td className="px-4 py-2.5 text-right text-muted-foreground">{pct(data.submit_visits, lastViews)}</td>
              <td className="px-4 py-2.5 border-l border-border" />
              <td className="px-4 py-2.5 text-xs text-muted-foreground">Passed every check and was sent to us{data.submits > data.submit_visits ? ` (${plural(data.submits, "try")} in all)` : ""}</td>
            </tr>
            <tr className="bg-secondary/20">
              <td className="px-4 py-2.5 whitespace-nowrap font-semibold text-foreground">Sent to payment</td>
              <td className="px-4 py-2.5 text-right font-semibold text-foreground">{data.redirect_visits.toLocaleString("en-US")}</td>
              <td className="px-4 py-2.5 text-right text-muted-foreground">{pct(data.redirect_visits, data.submit_visits)}</td>
              <td className="px-4 py-2.5 border-l border-border" />
              <td className="px-4 py-2.5 text-xs text-muted-foreground">Left for Stripe&apos;s payment page</td>
            </tr>
          </tbody>
        </table>
      </div>

      <div className="px-5 py-4 border-t border-border grid grid-cols-1 md:grid-cols-2 gap-5 text-xs">
        <div>
          <h3 className="font-bold uppercase tracking-wider text-muted-foreground mb-1.5">Refusals customers saw</h3>
          <CodeList codes={browserRefusals} empty="None" />
        </div>
        <div>
          <h3 className="font-bold uppercase tracking-wider text-muted-foreground mb-1.5">Refusals recorded by the server</h3>
          <CodeList codes={serverRefusals} empty="None" />
          {data.server_rejected_in_app > 0 && (
            <p className="mt-1.5 text-muted-foreground">{plural(data.server_rejected_in_app, "refusal")} came from an app&apos;s browser.</p>
          )}
        </div>
        {(photosAdded > 0 || photosFailed > 0 || data.in_app_notices > 0) && (
          <p className="md:col-span-2 text-muted-foreground">
            {[
              photosAdded > 0 || photosFailed > 0 ? `Photos: ${photosAdded.toLocaleString("en-US")} uploaded, ${photosFailed.toLocaleString("en-US")} failed (${pct(photosFailed, photosAdded + photosFailed)})` : null,
              data.in_app_notices > 0 ? `"Open in your browser" notice shown ${plural(data.in_app_notices, "time")}` : null,
            ].filter(Boolean).join(" · ")}
          </p>
        )}
      </div>
    </section>
  );
}

function UnpaidTable({ unpaid, nowMs }: { unpaid: UnpaidCheckouts; nowMs: number }) {
  if (unpaid.total === 0) {
    return (
      <div className="bg-white rounded-xl border border-border p-10 text-center">
        <p className="font-heading font-black text-lg text-foreground mb-1">No unpaid checkouts</p>
        <p className="text-sm text-muted-foreground">Every restoration and prep checkout in this range was paid, or is less than 15 minutes old.</p>
      </div>
    );
  }
  return (
    <div className="bg-white rounded-xl border border-border overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-secondary/40 text-xs font-bold uppercase tracking-wider text-muted-foreground">
              <th scope="col" className="px-4 py-2.5 text-left whitespace-nowrap">Order</th>
              <th scope="col" className="px-4 py-2.5 text-left whitespace-nowrap">Created</th>
              <th scope="col" className="px-4 py-2.5 text-left whitespace-nowrap">Tier</th>
              <th scope="col" className="px-4 py-2.5 text-right whitespace-nowrap">Cards</th>
              <th scope="col" className="px-4 py-2.5 text-right whitespace-nowrap">Total</th>
              <th scope="col" className="px-4 py-2.5 text-right whitespace-nowrap">Waiting</th>
              <th scope="col" className="px-4 py-2.5 text-left whitespace-nowrap">Reminder sent</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border tabular-nums">
            {unpaid.orders.map((o) => (
              <tr key={o.id}>
                <td className="px-4 py-2.5 whitespace-nowrap">
                  <Link href={`/admin/orders/${o.id}`} className="font-semibold text-primary hover:underline">
                    {o.order_number ?? o.id.slice(0, 8)}
                  </Link>
                </td>
                <td className="px-4 py-2.5 whitespace-nowrap text-muted-foreground">{etTime(o.created_at)}</td>
                <td className="px-4 py-2.5 whitespace-nowrap text-foreground">{tierName(o.tier, o.service)}</td>
                <td className="px-4 py-2.5 text-right text-foreground">{o.cards ?? "—"}</td>
                <td className="px-4 py-2.5 text-right text-foreground">{o.total_cents != null ? formatCurrency(o.total_cents) : "—"}</td>
                <td className="px-4 py-2.5 text-right whitespace-nowrap text-muted-foreground">{waitingSince(o.created_at, nowMs)}</td>
                <td className="px-4 py-2.5 whitespace-nowrap">
                  {!unpaid.reminder_tracked ? (
                    <span className="text-muted-foreground">—</span>
                  ) : o.reminder_sent_at ? (
                    <span className="text-foreground">{etTime(o.reminder_sent_at)}</span>
                  ) : (
                    <span className="text-muted-foreground">Not sent</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export default async function CheckoutFunnelPage({ searchParams }: { searchParams: Promise<{ range?: string; from?: string; to?: string }> }) {
  await requireAdmin();
  const sp = await searchParams;

  const today = etToday();
  let range: string = RANGES.find((r) => r.key === sp.range)?.key ?? "7";
  let from = addDays(today, -(Number(range) - 1));
  let to = today;
  // Custom range: both days valid, in order, not after today and at most MAX_DAYS long
  if (sp.range === "custom" && isDay(sp.from) && isDay(sp.to)) {
    let a = sp.from <= sp.to ? sp.from : sp.to;
    let b = sp.from <= sp.to ? sp.to : sp.from;
    if (b > today) b = today;
    if (a > b) a = b;
    if (daysBetween(a, b) >= MAX_DAYS) a = addDays(b, -(MAX_DAYS - 1));
    range = "custom";
    from = a;
    to = b;
  }
  const label = from === to
    ? formatDay(from, { weekday: "short", month: "short", day: "numeric", year: "numeric" })
    : `${formatDay(from, { month: "short", day: "numeric", year: "numeric" })} to ${formatDay(to, { month: "short", day: "numeric", year: "numeric" })}`;

  const admin = createAdminClient();
  const [funnelResult, unpaidResult] = await Promise.allSettled([
    getCheckoutFunnel(admin, from, to),
    getUnpaidCheckouts(admin, from, to),
  ]);
  const funnel: FunnelReport | null = funnelResult.status === "fulfilled" ? funnelResult.value : null;
  const unpaid: UnpaidCheckouts | null = unpaidResult.status === "fulfilled" ? unpaidResult.value : null;
  const nowMs = now();

  const shown = FLOWS.flatMap((def) => {
    const data = funnel?.flows.find((f) => f.flow === def.flow);
    return data ? [{ def, data }] : [];
  });
  const quiet = FLOWS.filter((def) => !shown.some((s) => s.def.flow === def.flow)).map((def) => def.label);

  const dateInput = "h-9 border border-border rounded-lg px-2 text-xs bg-white focus:outline-none focus:border-primary";

  return (
    <div className="min-h-screen bg-secondary/30">
      <div className="max-w-6xl mx-auto px-6 py-10 flex flex-col gap-6">
        <div className="flex flex-col lg:flex-row lg:items-end gap-4">
          <div className="flex-1">
            <h1 className="font-heading font-black text-3xl text-foreground">Checkout Funnel</h1>
            <p className="text-muted-foreground text-sm mt-1">
              Where customers leave each checkout, and what stopped them · {label} (New York time)
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <div className="flex gap-1 bg-white border border-border rounded-lg p-1">
              {RANGES.map((r) => (
                <Link
                  key={r.key}
                  href={`/admin/checkout-funnel?range=${r.key}`}
                  aria-current={range === r.key ? "page" : undefined}
                  className={`px-3 py-1.5 rounded-md text-xs font-bold whitespace-nowrap transition-colors ${
                    range === r.key ? "bg-foreground text-background" : "text-muted-foreground hover:text-foreground"
                  }`}
                >
                  {r.label}
                </Link>
              ))}
            </div>
            <form method="GET" action="/admin/checkout-funnel" className="flex items-center gap-2">
              <input type="hidden" name="range" value="custom" />
              <input type="date" name="from" aria-label="From" defaultValue={from} max={today} className={dateInput} />
              <span className="text-xs text-muted-foreground">to</span>
              <input type="date" name="to" aria-label="To" defaultValue={to} max={today} className={dateInput} />
              <button
                type="submit"
                className={`h-9 px-3 rounded-lg text-xs font-bold transition-colors ${
                  range === "custom" ? "bg-foreground text-background" : "bg-white border border-border text-foreground hover:bg-secondary"
                }`}
              >
                Show
              </button>
            </form>
          </div>
        </div>

        {!funnel ? (
          <div className="bg-white rounded-xl border border-border p-10 text-center">
            <p className="font-heading font-black text-lg text-foreground mb-1">The funnel couldn&apos;t load</p>
            <p className="text-sm text-muted-foreground">
              {funnelResult.status === "rejected" ? String(funnelResult.reason instanceof Error ? funnelResult.reason.message : funnelResult.reason) : ""}
            </p>
          </div>
        ) : shown.length === 0 ? (
          <div className="bg-white rounded-xl border border-border p-10 text-center">
            <p className="font-heading font-black text-lg text-foreground mb-1">No checkout visits in this range</p>
            <p className="text-sm text-muted-foreground">
              {funnel.first_event_at
                ? `Tracking started ${etTime(funnel.first_event_at)}.`
                : "Visits show here as customers open a checkout."}
            </p>
          </div>
        ) : (
          <>
            {shown.map(({ def, data }) => <FlowCard key={def.flow} def={def} data={data} />)}
            {quiet.length > 0 && <p className="text-xs text-muted-foreground">No visits in this range: {quiet.join(", ")}.</p>}
          </>
        )}

        <div className="flex flex-col gap-3 mt-4">
          <div>
            <h2 className="font-heading font-black text-2xl text-foreground">Unpaid checkouts</h2>
            <p className="text-muted-foreground text-sm mt-1">
              Restoration and prep orders placed in this range, more than 15 minutes ago, still waiting for payment
              {unpaid ? ` · ${plural(unpaid.total, "order")}${unpaid.total > unpaid.orders.length ? `, newest ${unpaid.orders.length} shown` : ""}` : ""}
              {unpaid && !unpaid.reminder_tracked ? " · payment reminders aren't recorded yet" : ""}
            </p>
          </div>
          {unpaid ? (
            <UnpaidTable unpaid={unpaid} nowMs={nowMs} />
          ) : (
            <div className="bg-white rounded-xl border border-border p-10 text-center">
              <p className="font-heading font-black text-lg text-foreground mb-1">Unpaid checkouts couldn&apos;t load</p>
              <p className="text-sm text-muted-foreground">
                {unpaidResult.status === "rejected" ? String(unpaidResult.reason instanceof Error ? unpaidResult.reason.message : unpaidResult.reason) : ""}
              </p>
            </div>
          )}
        </div>

        <div className="text-xs text-muted-foreground leading-relaxed flex flex-col gap-1.5">
          <p>
            <strong className="text-foreground">How it&apos;s counted.</strong> A visit is one browser tab going through one checkout, counted once per step however often the step was opened.
            Blocked means Continue, Sign or Pay was pressed with something required missing or wrong (the customer saw the red outlines); a visit can be blocked several times and still go on.
            Submitted means the order passed every check in the browser and was sent to us; refusals customers saw are our server&apos;s answers (or no answer) as their browser got them, and refusals recorded by the server are counted on our side, so the two lists overlap.
            Phone or desktop is by screen width (narrower than 768px is a phone), counted from the first step of each visit; an app&apos;s browser is Instagram, Facebook, TikTok or X.
            Only counts are kept: no names, emails, addresses or card details. Browsers that block tracking may be missing.
          </p>
          <p>
            <strong className="text-foreground">Unpaid checkouts</strong> are orders still Awaiting Payment. Each try at checkout makes its own order, so a customer who paid on a later try can still have an earlier one here. Kit, gift card and Kit Club checkouts don&apos;t create an order until they&apos;re paid, so they aren&apos;t listed.
          </p>
        </div>
      </div>
    </div>
  );
}
