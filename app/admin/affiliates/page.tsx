import { createAdminClient } from "@/lib/supabase/admin";
import { redirect } from "next/navigation";
import { NewAffiliateForm } from "./new-affiliate-form";
import { NewCouponForm } from "./new-coupon-form";
import { EditAffiliateForm } from "./edit-affiliate-form";
import { PortalAccess } from "./portal-access";
import Link from "next/link";
import { formatCurrency } from "@/lib/utils";
import { isAdmin } from "@/lib/admin-auth";
import { commissionCents, commissionRatesFor, currentRate, formatPercent, kitSummary, rateAt, saleCents, saleDate } from "@/lib/creator-portal";
import { fetchAll } from "@/lib/fetch-all";

export const dynamic = "force-dynamic";

type Affiliate = {
  id: string;
  name: string;
  code: string;
  discount_percent: number;
  created_at: string;
  portal_set_up: boolean;
  portal_last_login_at: string | null;
  setup_link_pending: boolean;
  commission_percent: number;
};

type Sale = {
  id: string;
  total_cents: number;
  created_at: string;
  customer_name: string;
  type: "kit" | "restoration";
  summary: string;
};

export default async function AdminAffiliatesPage({
  searchParams,
}: {
  searchParams: Promise<{ edit?: string }>;
}) {
  const { edit: editingId } = await searchParams;
  if (!(await isAdmin())) {
    redirect("/admin/login");
  }

  const admin = createAdminClient();

  // Named columns: the portal password and setup link hashes never leave the server
  const { data: affiliates } = await admin
    .from("affiliates")
    .select("id, name, code, discount_percent, created_at, password_hash, portal_last_login_at, setup_token_expires_at")
    .order("created_at", { ascending: false });

  const now = new Date().toISOString();
  const rates = await commissionRatesFor((affiliates ?? []).map((a) => a.id));
  const allAffiliates: Affiliate[] = (affiliates ?? []).map(({ password_hash, setup_token_expires_at, ...a }) => ({
    ...a,
    portal_set_up: !!password_hash,
    setup_link_pending: !!setup_token_expires_at && setup_token_expires_at > now,
    commission_percent: currentRate(rates.get(a.id)),
  }));

  // Every order with a code, read in pages (the API returns at most 1,000 rows a request)
  type CodeOrder = { id: string; items?: unknown; total_cents: number | null; refunded_cents: number | null; created_at: string; status: string | null; customer_name: string; affiliate_code: string };
  const [kitOrders, restorationOrders] = await Promise.all([
    fetchAll<CodeOrder>((from, to) => admin
      .from("shop_orders")
      .select("id, items, total_cents, refunded_cents, created_at, status, customer_name, affiliate_code")
      .not("affiliate_code", "is", null)
      .order("created_at", { ascending: false })
      .order("id", { ascending: true })
      .range(from, to)),
    fetchAll<CodeOrder>((from, to) => admin
      .from("orders")
      .select("id, total_cents, refunded_cents, created_at, customer_name, affiliate_code, status")
      .not("affiliate_code", "is", null)
      .order("created_at", { ascending: false })
      .order("id", { ascending: true })
      .range(from, to)),
  ]);

  // Build sales map by code
  const salesByCode: Record<string, Sale[]> = {};

  // Counted the same way as on the creator's own dashboard (saleCents in lib/creator-portal.ts)
  for (const o of kitOrders) {
    const cents = saleCents("kit", o);
    if (cents === null) continue;
    const code = o.affiliate_code.toUpperCase();
    if (!salesByCode[code]) salesByCode[code] = [];
    salesByCode[code].push({ id: o.id, total_cents: cents, created_at: o.created_at, customer_name: o.customer_name, type: "kit", summary: kitSummary(o.items) });
  }

  for (const o of restorationOrders) {
    const cents = saleCents("restoration", o);
    if (cents === null) continue;
    const code = o.affiliate_code.toUpperCase();
    if (!salesByCode[code]) salesByCode[code] = [];
    salesByCode[code].push({ id: o.id, total_cents: cents, created_at: o.created_at, customer_name: o.customer_name, type: "restoration", summary: "Restoration service" });
  }
  // Newest first across both kinds, as on the creator's dashboard
  for (const list of Object.values(salesByCode)) list.sort((a, b) => b.created_at.localeCompare(a.created_at));

  return (
    <div className="max-w-4xl mx-auto px-6 py-10">
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="font-heading font-black text-3xl text-foreground">Affiliates &amp; Coupons</h1>
          <p className="text-muted-foreground text-sm mt-1">
            {allAffiliates.length} code{allAffiliates.length !== 1 ? "s" : ""} · commission set per code
          </p>
        </div>
      </div>

      <NewAffiliateForm />
      <NewCouponForm />

      {allAffiliates.length === 0 ? (
        <div className="bg-white rounded-xl border border-border p-8 text-center">
          <p className="text-muted-foreground text-sm">No codes yet. Add one above.</p>
        </div>
      ) : (
        <div className="flex flex-col gap-6">
          {allAffiliates.map((affiliate) => {
            const sales = salesByCode[affiliate.code.toUpperCase()] ?? [];
            const totalRevenue = sales.reduce((s, o) => s + o.total_cents, 0);
            // Each sale at the rate in effect when it was placed
            const affiliateRates = rates.get(affiliate.id);
            const saleCommission = (sale: Sale) => commissionCents(sale.total_cents, rateAt(affiliateRates, sale.created_at));
            const earned = sales.reduce((s, sale) => s + saleCommission(sale), 0);
            const mixedRates = sales.some((sale) => rateAt(affiliateRates, sale.created_at) !== affiliate.commission_percent);

            return (
              <div key={affiliate.id} className="bg-white rounded-xl border border-border overflow-hidden">
                <div className="p-6 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                  <div>
                    <h2 className="font-heading font-black text-xl text-foreground">{affiliate.name}</h2>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      Created {saleDate(affiliate.created_at, { month: "numeric", day: "numeric", year: "numeric" })}
                    </p>
                    {editingId !== affiliate.id && (
                      <Link
                        href={`/admin/affiliates?edit=${affiliate.id}`}
                        scroll={false}
                        className="inline-block mt-2 text-xs font-semibold text-primary hover:underline underline-offset-2"
                      >
                        Edit name, code, discount or commission
                      </Link>
                    )}
                  </div>
                  <div className="flex flex-wrap items-center gap-x-6 gap-y-3 text-sm">
                    <div className="text-center">
                      <p className="font-mono font-black text-lg text-foreground tracking-widest">{affiliate.code}</p>
                      <p className="text-xs text-muted-foreground">code</p>
                    </div>
                    {affiliate.discount_percent > 0 && (
                      <div className="text-center">
                        <p className="font-heading font-black text-lg text-green-600">{affiliate.discount_percent}%</p>
                        <p className="text-xs text-muted-foreground">customer discount</p>
                      </div>
                    )}
                    <div className="text-center">
                      <p className="font-heading font-black text-lg text-foreground">{sales.length}</p>
                      <p className="text-xs text-muted-foreground">sales</p>
                    </div>
                    <div className="text-center">
                      <p className="font-heading font-black text-lg text-foreground">{formatCurrency(totalRevenue)}</p>
                      <p className="text-xs text-muted-foreground">revenue</p>
                    </div>
                    <div className="text-center">
                      <p className="font-heading font-black text-lg text-green-700">{formatCurrency(earned)}</p>
                      <p className="text-xs text-muted-foreground">earned ({formatPercent(affiliate.commission_percent)}{mixedRates ? " now" : ""})</p>
                    </div>
                  </div>
                </div>

                {editingId === affiliate.id && <EditAffiliateForm affiliate={affiliate} />}

                <PortalAccess
                  affiliate={{ id: affiliate.id, name: affiliate.name }}
                  setUp={affiliate.portal_set_up}
                  lastLogin={affiliate.portal_last_login_at}
                  linkPending={affiliate.setup_link_pending}
                />

                {sales.length > 0 && (
                  <div className="border-t border-border px-6 py-4">
                    <p className="text-xs font-bold uppercase tracking-widest text-muted-foreground mb-3">Recent Sales</p>
                    <div className="flex flex-col gap-2">
                      {sales.slice(0, 5).map((sale) => (
                        <div key={sale.id} className="flex items-center justify-between text-sm">
                          <div className="flex items-center gap-2 min-w-0">
                            <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded shrink-0 ${sale.type === "kit" ? "bg-blue-100 text-blue-700" : "bg-purple-100 text-purple-700"}`}>
                              {sale.type === "kit" ? "KIT" : "REST"}
                            </span>
                            <span className="font-medium text-foreground truncate">{sale.customer_name || "Customer"}</span>
                            <span className="text-muted-foreground text-xs truncate hidden sm:block">{sale.summary}</span>
                          </div>
                          <div className="flex items-center gap-3 shrink-0">
                            <span className="text-xs text-muted-foreground">{saleDate(sale.created_at, { month: "numeric", day: "numeric", year: "numeric" })}</span>
                            <span className="font-semibold text-foreground">{formatCurrency(sale.total_cents)}</span>
                            <span className="text-xs text-green-700 font-semibold">+{formatCurrency(saleCommission(sale))}</span>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
