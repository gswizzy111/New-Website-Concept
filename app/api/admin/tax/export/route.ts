import { requireAdminOrAccountant } from "@/lib/admin-auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { csvText } from "@/lib/csv";
import { filterTaxRows, taxRowsForYear, taxYear } from "@/app/admin/tax/tax-rows";

function fmtDate(iso: string) {
  return new Date(iso).toLocaleDateString("en-US", {
    timeZone: "America/New_York", month: "2-digit", day: "2-digit", year: "numeric",
  });
}

function dollars(cents: number) {
  return (cents / 100).toFixed(2);
}

// The same rows as the Tax Reports page (app/admin/tax/tax-rows.ts): sales on the
// New York day paid, refunds as negative rows on the day the money went back.
export async function GET(req: Request) {
  await requireAdminOrAccountant();

  const url = new URL(req.url);
  const year = taxYear(url.searchParams.get("year"));
  const quarter = url.searchParams.get("quarter") ?? "all";
  const monthParam = url.searchParams.get("month") ?? "all";
  const month = /^(?:[0-9]|1[01])$/.test(monthParam) ? monthParam : "all";
  const stateFilter = url.searchParams.get("state") ?? "all";
  const typeFilter = url.searchParams.get("type") ?? "all";

  const admin = createAdminClient();
  const rows = await taxRowsForYear(admin, year);
  const filtered = filterTaxRows(rows, { month, quarter, state: stateFilter, type: typeFilter });

  const header = ["Date", "Order #", "Customer Name", "Email", "City", "State", "Country", "Service", "Type", "Subtotal ($)", "Shipping ($)", "NJ Tax ($)", "Total ($)", "NJ Taxable"];
  const dataRows = filtered.map((r) => [
    fmtDate(r.date),
    r.order_number ? `#${r.order_number}` : "",
    r.customer_name, r.customer_email,
    r.city, r.state, r.country, r.service,
    r.note ?? "Sale",
    dollars(r.subtotal_cents), dollars(r.shipping_cents),
    dollars(r.tax_cents), dollars(r.total_cents),
    r.is_nj ? "Yes" : "No",
  ]);

  const totals = [
    "TOTALS", "", `${filtered.length} transactions`, "", "", "", "", "", "",
    dollars(filtered.reduce((s, r) => s + r.subtotal_cents, 0)),
    dollars(filtered.reduce((s, r) => s + r.shipping_cents, 0)),
    dollars(filtered.reduce((s, r) => s + r.tax_cents, 0)),
    dollars(filtered.reduce((s, r) => s + r.total_cents, 0)),
    "",
  ];

  // Cells are guarded against spreadsheet formulas (lib/csv.ts)
  const csv = csvText([header, ...dataRows, [], totals]);

  const label = month !== "all"
    ? `${new Date(Date.UTC(year, parseInt(month, 10), 1)).toLocaleString("en-US", { month: "long", timeZone: "UTC" })}-${year}`
    : quarter !== "all" ? `${quarter.replace(/[^A-Za-z0-9]/g, "")}-${year}` : String(year);

  return new Response(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="tax-report-${label}.csv"`,
    },
  });
}
