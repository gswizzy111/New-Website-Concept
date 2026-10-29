import { requireAdmin } from "@/lib/admin-auth";
import { createAdminClient } from "@/lib/supabase/admin";
import Link from "next/link";
import { PrintButton } from "./print-button";
import { syncRefundsQuietly } from "@/lib/refund-ledger";
import { loadStatement, parsePreset, statementRange, type Preset } from "./statement";

export const dynamic = "force-dynamic";

function fmt(cents: number | null | undefined) {
  const n = cents ?? 0;
  return `$${(n / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

// Signed: refunds can outweigh a period's sales, and refund rows take tax back
function money(cents: number) {
  return cents < 0 ? `-${fmt(-cents)}` : fmt(cents);
}

function dateLabel(d: Date) {
  return d.toLocaleDateString("en-US", { timeZone: "America/New_York", month: "short", day: "numeric", year: "numeric" });
}

export default async function SalesStatementPage({
  searchParams,
}: {
  searchParams: Promise<{ preset?: string; from?: string; to?: string }>;
}) {
  await requireAdmin();

  const sp = await searchParams;
  const preset = parsePreset(sp.preset);
  // New York calendar days; refunds dated when the money went back (./statement.ts)
  const range = statementRange(preset, sp.from, sp.to);
  const { label } = range;

  const admin = createAdminClient();
  await syncRefundsQuietly(admin); // refunds made in the Stripe Dashboard (gives up after a few seconds)
  const statement = await loadStatement(admin, range);
  const list = statement.rows;

  // Totals
  const totalRevenue = statement.gross;
  const totalRefunds = statement.refunds;
  const netRevenue = statement.net;
  const totalShipping = statement.shipping;
  const totalSubtotal = statement.subtotal;
  const totalDiscounts = statement.discounts;
  // NJ tax: 6.625% on taxable (subtotal − discounts), less the share given back by refunds
  const totalTax = statement.tax;

  const csvParams = new URLSearchParams();
  if (range.custom) {
    csvParams.set("from", sp.from!);
    csvParams.set("to", sp.to!);
  } else {
    csvParams.set("preset", preset);
  }
  const csvHref = `/api/admin/sales-statement?${csvParams}`;

  const presets: { value: Preset; label: string }[] = [
    { value: "this_month", label: "This Month" },
    { value: "last_month", label: "Last Month" },
    { value: "this_year", label: "This Year" },
    { value: "all", label: "All Time" },
  ];

  return (
    <>
      {/* Print styles */}
      <style>{`
        @media print {
          body * { visibility: hidden !important; }
          #statement-printable, #statement-printable * { visibility: visible !important; }
          #statement-printable { position: absolute; inset: 0; padding: 32px; }
          .no-print { display: none !important; }
          table { border-collapse: collapse; width: 100%; font-size: 11px; }
          th, td { border: 1px solid #ddd; padding: 4px 8px; text-align: left; }
          th { background: #f5f5f5; }
        }
      `}</style>

      <div className="min-h-screen bg-secondary/30">
        <div className="max-w-7xl mx-auto px-6 py-10">

          {/* Header */}
          <div className="flex items-start justify-between mb-6 no-print flex-wrap gap-4">
            <div>
              <Link href="/admin" className="text-sm text-muted-foreground hover:text-primary transition-colors">← Admin</Link>
              <h1 className="font-heading font-black text-3xl text-foreground mt-1">Sales Statement</h1>
              <p className="text-muted-foreground text-sm mt-0.5">{statement.orders} paid order{statement.orders !== 1 ? "s" : ""} · {label}</p>
            </div>
            <div className="flex items-center gap-2">
              <a
                href={csvHref}
                className="h-9 px-4 border border-border bg-white rounded-lg text-sm font-semibold text-foreground hover:bg-secondary transition-colors flex items-center gap-2"
              >
                ⬇ CSV
              </a>
              <PrintButton />
            </div>
          </div>

          {/* Period filter */}
          <div className="flex flex-wrap gap-2 mb-6 no-print">
            {presets.map((p) => (
              <Link
                key={p.value}
                href={`/admin/sales-statement?preset=${p.value}`}
                className={`px-4 py-1.5 rounded-lg text-xs font-bold border transition-colors ${
                  preset === p.value && !range.custom
                    ? "bg-primary text-primary-foreground border-primary"
                    : "bg-white text-muted-foreground border-border hover:border-primary/40"
                }`}
              >
                {p.label}
              </Link>
            ))}

            {/* Custom date range */}
            <form method="GET" action="/admin/sales-statement" className="flex items-center gap-2">
              <input type="date" name="from" defaultValue={sp.from ?? ""} className="h-8 border border-border rounded-lg px-2 text-xs bg-white focus:outline-none focus:border-primary" />
              <span className="text-xs text-muted-foreground">to</span>
              <input type="date" name="to" defaultValue={sp.to ?? ""} className="h-8 border border-border rounded-lg px-2 text-xs bg-white focus:outline-none focus:border-primary" />
              <button type="submit" className="h-8 px-3 bg-secondary rounded-lg text-xs font-semibold text-foreground hover:bg-secondary/80 transition-colors">Go</button>
            </form>
          </div>

          <div id="statement-printable">
            {/* Print header */}
            <div className="hidden print:block mb-6">
              <p className="text-2xl font-black">The Card Doc — Sales Statement</p>
              <p className="text-sm text-gray-500">{label} · Generated {new Date().toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric", timeZone: "America/New_York" })}</p>
            </div>

            {/* Summary cards */}
            <div className="grid grid-cols-2 lg:grid-cols-5 gap-4 mb-6">
              {[
                { label: "Gross Revenue", value: fmt(totalRevenue), color: "text-green-700" },
                { label: "Refunds", value: fmt(totalRefunds), color: "text-red-600" },
                { label: "Net Revenue", value: money(netRevenue), color: "text-foreground font-black" },
                { label: "Est. Tax Collected", value: money(totalTax), color: "text-blue-700" },
                { label: "Total Discounts", value: fmt(totalDiscounts), color: "text-orange-600" },
              ].map((s) => (
                <div key={s.label} className="bg-white rounded-xl border border-border p-4">
                  <p className="text-xs text-muted-foreground mb-1">{s.label}</p>
                  <p className={`text-lg font-black ${s.color}`}>{s.value}</p>
                </div>
              ))}
            </div>

            {/* Orders table */}
            {list.length === 0 ? (
              <div className="bg-white rounded-xl border border-border p-16 text-center">
                <p className="font-heading font-black text-lg">No paid orders in this period</p>
              </div>
            ) : (
              <div className="bg-white rounded-xl border border-border overflow-hidden">
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-border bg-secondary/30">
                        <th className="text-left px-4 py-3 text-xs font-bold uppercase tracking-widest text-muted-foreground">Date</th>
                        <th className="text-left px-4 py-3 text-xs font-bold uppercase tracking-widest text-muted-foreground">Order #</th>
                        <th className="text-left px-4 py-3 text-xs font-bold uppercase tracking-widest text-muted-foreground">Customer</th>
                        <th className="text-left px-4 py-3 text-xs font-bold uppercase tracking-widest text-muted-foreground">Tier</th>
                        <th className="text-right px-4 py-3 text-xs font-bold uppercase tracking-widest text-muted-foreground">Subtotal</th>
                        <th className="text-right px-4 py-3 text-xs font-bold uppercase tracking-widest text-muted-foreground">Discount</th>
                        <th className="text-right px-4 py-3 text-xs font-bold uppercase tracking-widest text-muted-foreground">Shipping</th>
                        <th className="text-right px-4 py-3 text-xs font-bold uppercase tracking-widest text-muted-foreground">Tax</th>
                        <th className="text-right px-4 py-3 text-xs font-bold uppercase tracking-widest text-muted-foreground">Total</th>
                        <th className="text-right px-4 py-3 text-xs font-bold uppercase tracking-widest text-muted-foreground">Refunded</th>
                      </tr>
                    </thead>
                    <tbody>
                      {list.map((o) => {
                        const refund = o.kind === "refund";
                        const discountTotal = o.discount_cents + o.gift_card_discount_cents;
                        return (
                          <tr key={o.key} className={`border-b border-border last:border-0 hover:bg-secondary/20 transition-colors ${refund ? "bg-red-50/40" : ""}`}>
                            <td className="px-4 py-3 text-muted-foreground text-xs whitespace-nowrap">
                              {dateLabel(new Date(o.at))}
                            </td>
                            <td className="px-4 py-3">
                              {o.order_id ? (
                                <>
                                  <Link href={`/admin/orders/${o.order_id}`} className="font-mono text-xs font-bold text-primary hover:underline no-print">
                                    #{o.order_number}
                                  </Link>
                                  <span className="font-mono text-xs font-bold hidden print:inline">#{o.order_number}</span>
                                </>
                              ) : (
                                <span className="text-xs text-muted-foreground">—</span>
                              )}
                              {o.type !== "Sale" && (
                                <p className={`text-[11px] mt-0.5 ${refund ? "font-semibold text-red-700" : "text-muted-foreground"}`}>{o.type}</p>
                              )}
                            </td>
                            <td className="px-4 py-3">
                              <p className="font-medium text-foreground text-xs">{o.customer_name}</p>
                              <p className="text-muted-foreground text-[11px]">{o.customer_email}</p>
                            </td>
                            <td className="px-4 py-3">
                              <span className="text-xs text-muted-foreground">
                                {o.tier || "—"}
                              </span>
                            </td>
                            <td className="px-4 py-3 text-right text-xs font-mono">{refund ? "—" : fmt(o.subtotal_cents)}</td>
                            <td className="px-4 py-3 text-right text-xs font-mono text-orange-600">
                              {discountTotal > 0 ? `-${fmt(discountTotal)}` : "—"}
                            </td>
                            <td className="px-4 py-3 text-right text-xs font-mono">{refund ? "—" : fmt(o.shipping_cents)}</td>
                            <td className="px-4 py-3 text-right text-xs font-mono text-blue-600">{money(o.tax_cents)}</td>
                            <td className="px-4 py-3 text-right text-xs font-mono font-bold">{refund ? "—" : fmt(o.total_cents)}</td>
                            <td className="px-4 py-3 text-right text-xs font-mono text-red-600">
                              {o.refunded_cents > 0 ? `-${fmt(o.refunded_cents)}` : "—"}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                    <tfoot>
                      <tr className="border-t-2 border-border bg-secondary/30">
                        <td colSpan={4} className="px-4 py-3 text-xs font-black uppercase tracking-widest text-foreground">Totals ({statement.orders} orders)</td>
                        <td className="px-4 py-3 text-right text-xs font-mono font-black">{fmt(totalSubtotal)}</td>
                        <td className="px-4 py-3 text-right text-xs font-mono font-black text-orange-600">{totalDiscounts > 0 ? `-${fmt(totalDiscounts)}` : "—"}</td>
                        <td className="px-4 py-3 text-right text-xs font-mono font-black">{fmt(totalShipping)}</td>
                        <td className="px-4 py-3 text-right text-xs font-mono font-black text-blue-600">{money(totalTax)}</td>
                        <td className="px-4 py-3 text-right text-xs font-mono font-black">{fmt(totalRevenue)}</td>
                        <td className="px-4 py-3 text-right text-xs font-mono font-black text-red-600">{totalRefunds > 0 ? `-${fmt(totalRefunds)}` : "—"}</td>
                      </tr>
                      <tr className="bg-green-50">
                        <td colSpan={8} className="px-4 py-3 text-xs font-black text-green-900">Net Revenue (after refunds)</td>
                        <td colSpan={2} className="px-4 py-3 text-right text-sm font-black text-green-800">{money(netRevenue)}</td>
                      </tr>
                    </tfoot>
                  </table>
                </div>
              </div>
            )}

            {/* Footer note */}
            <p className="text-xs text-muted-foreground mt-4 text-center">
              Tax estimates use NJ rate (6.625%) on taxable revenue. For official tax purposes, consult your accountant.
            </p>
            <p className="text-xs text-muted-foreground mt-1 text-center">
              Dates are New York time. Orders count on the day they were paid. Refunds count on the day the money went back, whenever the order was paid.
            </p>
          </div>
        </div>
      </div>
    </>
  );
}
