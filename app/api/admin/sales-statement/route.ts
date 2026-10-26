import { createAdminClient } from "@/lib/supabase/admin";
import { isAdmin } from "@/lib/admin-auth";
import { csvText } from "@/lib/csv";
import { etToday } from "@/lib/dashboard-metrics";
import { loadStatement, parsePreset, statementRange } from "@/app/admin/sales-statement/statement";

function fmt(cents: number | null | undefined) {
  return ((cents ?? 0) / 100).toFixed(2);
}

// The same rows as the Sales Statement page (app/admin/sales-statement/statement.ts):
// payments on the New York day paid, refunds on the day the money went back.
export async function GET(request: Request) {
  if (!(await isAdmin())) {
    return new Response("Unauthorized", { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const range = statementRange(parsePreset(searchParams.get("preset")), searchParams.get("from"), searchParams.get("to"));

  const admin = createAdminClient();
  let statement;
  try {
    statement = await loadStatement(admin, range);
  } catch (e) {
    console.error("[sales-statement csv]", e instanceof Error ? e.message : e);
    return new Response("DB error", { status: 500 });
  }

  const header = ["Date", "Type", "Order #", "Customer Name", "Customer Email", "Tier", "Subtotal", "Discount", "Gift Card Discount", "Shipping", "Est. Tax", "Total", "Refunded", "Net", "Affiliate Code", "Loyalty Discount %"];

  const lines = statement.rows.map((o) => [
    new Date(o.at).toLocaleDateString("en-US", { timeZone: "America/New_York" }),
    o.type,
    o.order_number != null ? `#${o.order_number}` : "",
    o.customer_name,
    o.customer_email,
    o.tier,
    fmt(o.subtotal_cents),
    fmt(o.discount_cents),
    fmt(o.gift_card_discount_cents),
    fmt(o.shipping_cents),
    fmt(o.tax_cents),
    fmt(o.total_cents),
    fmt(o.refunded_cents),
    fmt(o.total_cents - o.refunded_cents),
    o.affiliate_code,
    String(o.loyalty_discount_percent),
  ]);

  // Cells are guarded against spreadsheet formulas (lib/csv.ts)
  const csv = csvText([header, ...lines]);
  const filename = `card-doc-sales-${etToday()}.csv`;

  return new Response(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
    },
  });
}
