import { createAdminClient } from "@/lib/supabase/admin";
import { redirect } from "next/navigation";
import { getPartner } from "@/lib/partner-portal";
import { LogSaleButton } from "./log-sale-button";
import { LogReferralButton } from "./log-referral-button";
import { PAGE_TITLE, PANEL, PANEL_TITLE, PortalHeader } from "@/components/account/portal";

export const dynamic = "force-dynamic";

export default async function PartnerDashboard() {
  // Signed in through a partner session (lib/partner-portal.ts)
  const partner = await getPartner();
  if (!partner) redirect("/partners");
  const partnerId = partner.id;

  const admin = createAdminClient();

  const [{ data: sales }, { data: referrals }] = await Promise.all([
    admin.from("partner_kit_sales").select("*").eq("partner_id", partnerId).order("created_at", { ascending: false }),
    admin.from("partner_referrals").select("*").eq("partner_id", partnerId).order("created_at", { ascending: false }),
  ]);

  const allSales = sales ?? [];
  const kitSales    = allSales.filter(s => (s.product_type ?? "kit") === "kit");
  const polishSales = allSales.filter(s => s.product_type === "polish");
  const spraySales  = allSales.filter(s => s.product_type === "spray");

  const kitsSold    = kitSales.reduce((s, r) => s + r.quantity, 0);
  const polishSold  = polishSales.reduce((s, r) => s + r.quantity, 0);
  const spraySold   = spraySales.reduce((s, r) => s + r.quantity, 0);

  const remainingKits   = (partner.kits_allocated ?? 0) - kitsSold;
  const remainingPolish = (partner.polish_allocated ?? 0) - polishSold;
  const remainingSpray  = (partner.spray_allocated ?? 0) - spraySold;

  const totalProfit = kitsSold * 18.50 + polishSold * 7.75 + spraySold * 8.10;

  const productLabel = (s: { product_type?: string; quantity: number }) => {
    if (s.product_type === "polish") return `${s.quantity} polish`;
    if (s.product_type === "spray") return `${s.quantity} spray`;
    return `${s.quantity} kit${s.quantity !== 1 ? "s" : ""}`;
  };

  return (
    <div className="surface-chalk min-h-screen">
      <PortalHeader width="max-w-3xl">
        <form action="/api/partners/logout" method="POST">
          <button className="inline-flex min-h-11 items-center rounded-full px-3 text-sm font-bold text-ink-soft transition-colors hover:bg-chalk hover:text-ink">Sign out</button>
        </form>
      </PortalHeader>
      <div className="mx-auto max-w-3xl px-4 py-10 sm:px-6 md:py-14">

        {/* Header */}
        <div className="mb-8">
          <h1 className={`${PAGE_TITLE} [overflow-wrap:anywhere]`}>{partner.store_name ?? partner.name}</h1>
          <p className="mt-3 text-[15px] text-ink-soft">Partner Dashboard — The Card Doc</p>
        </div>

        {/* Profit banner */}
        <div className="surface-ink mb-4 flex flex-wrap items-end justify-between gap-4 rounded-[22px] p-6 sm:p-8">
          <div>
            <p className="label-caps mb-2 text-[15px] text-sun">Total Profit Earned</p>
            <p className="font-heading text-[3.25rem] leading-none font-black md:text-[4rem]">${totalProfit.toFixed(2)}</p>
          </div>
          <div className="space-y-0.5 text-xs text-on-dark-muted sm:text-right">
            <p>{kitsSold} kit{kitsSold !== 1 ? "s" : ""} × $18.50</p>
            <p>{polishSold} polish × $7.75</p>
            <p>{spraySold} spray × $8.10</p>
          </div>
        </div>

        {/* Inventory stats */}
        <div className="mb-6 grid grid-cols-3 gap-3 sm:gap-4">
          {[
            { label: "Kits", allocated: partner.kits_allocated ?? 0, sold: kitsSold, remaining: remainingKits },
            { label: "Polish", allocated: partner.polish_allocated ?? 0, sold: polishSold, remaining: remainingPolish },
            { label: "Spray", allocated: partner.spray_allocated ?? 0, sold: spraySold, remaining: remainingSpray },
          ].map(({ label, allocated, sold, remaining }) => (
            <div key={label} className="rounded-[18px] bg-white p-4 shadow-[0_0_0_1px_var(--line)] sm:p-5">
              <p className="label-caps mb-2 text-[15px] text-ink-soft">{label}</p>
              <p className="font-heading text-[2.25rem] leading-none font-black text-ink">{remaining}<span className="font-sans text-sm font-semibold text-ink-soft">/{allocated}</span></p>
              <p className="mt-1.5 text-xs text-ink-soft">{sold} sold</p>
            </div>
          ))}
        </div>

        {/* Actions */}
        <div className="mb-8 grid grid-cols-2 gap-3 sm:gap-4">
          <LogSaleButton remainingKits={remainingKits} remainingPolish={remainingPolish} remainingSpray={remainingSpray} />
          <LogReferralButton />
        </div>

        {/* Sales history */}
        <div className={`${PANEL} mb-4`}>
          <h2 className={`${PANEL_TITLE} mb-4`}>Sales History</h2>
          {!allSales.length ? (
            <p className="text-sm text-muted-foreground">No sales logged yet.</p>
          ) : (
            <div className="flex flex-col gap-3">
              {allSales.map((s) => (
                <div key={s.id} className="flex items-center justify-between text-sm border-b border-line pb-3 last:border-0 last:pb-0">
                  <div>
                    <p className="font-bold text-foreground">{productLabel(s)} sold</p>
                    {s.notes && <p className="text-muted-foreground text-xs">{s.notes}</p>}
                  </div>
                  <p className="text-xs text-muted-foreground">{new Date(s.created_at).toLocaleDateString()}</p>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Referrals history */}
        <div className={PANEL}>
          <h2 className={`${PANEL_TITLE} mb-4`}>
            Referrals <span className="font-sans text-sm font-semibold text-ink-soft">({referrals?.length ?? 0} total)</span>
          </h2>
          {!referrals?.length ? (
            <p className="text-sm text-muted-foreground">No referrals logged yet.</p>
          ) : (
            <div className="flex flex-col gap-3">
              {referrals.map((r) => (
                <div key={r.id} className="flex items-center justify-between text-sm border-b border-line pb-3 last:border-0 last:pb-0">
                  <div>
                    <p className="font-bold text-foreground">{r.client_name ?? "Client"}</p>
                    {r.notes && <p className="text-muted-foreground text-xs">{r.notes}</p>}
                  </div>
                  <p className="text-xs text-muted-foreground">{new Date(r.created_at).toLocaleDateString()}</p>
                </div>
              ))}
            </div>
          )}
        </div>

      </div>
    </div>
  );
}
