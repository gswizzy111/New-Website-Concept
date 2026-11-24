import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { z } from "zod";
import { requireAdmin } from "@/lib/admin-auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { AdminLink } from "@/components/admin-ui/admin-link";
import { normalizeCode, orderPhotosPath } from "@/lib/intake/codes";
import { isMissingIntakeSchema } from "@/lib/intake/completed";
import { loadShipCheck } from "@/components/intake/ship/ship-data";
import { ShipChecklist } from "@/components/intake/ship/ship-checklist";
import { PLACES_NOTICE } from "@/components/intake/ship/schema";

/**
 * Ship check (/admin/receiving/ship/<orderId>[?bag=<bagId or Bag ID>]): before
 * an order goes out, every card is listed by bag with whether it's done and
 * whether it's still in a slot (CLAMP 07...). Cards carry no sticker, so
 * packing is ticked by hand ("in the box", or Confirm all present). A card
 * not marked done gets Mark done; a done card still in a slot gets Taken out.
 * "All good: ready to ship" leads to the order page's shipping area. The Scan
 * page sends a scanned bag or order here (?bag= outlines the scanned bag).
 */

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Ship check | Receiving", robots: { index: false } };

type Params = Record<string, string | string[] | undefined>;
const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";
const linkClass = "inline-flex items-center min-h-11 text-sm font-semibold text-primary hover:underline rounded focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary";

function Notice({ tone, children }: { tone: "amber" | "red" | "blue"; children: React.ReactNode }) {
  const cls = tone === "amber" ? "border-amber-300 bg-amber-50 text-amber-900" : tone === "red" ? "border-red-300 bg-red-50 text-red-800" : "border-blue-200 bg-blue-50 text-blue-900";
  return <div role={tone === "red" ? "alert" : "status"} className={`rounded-xl border px-4 py-3 text-sm ${cls}`}>{children}</div>;
}

export default async function ShipCheckPage({ params, searchParams }: { params: Promise<{ orderId: string }>; searchParams: Promise<Params> }) {
  await requireAdmin();
  const { orderId } = await params;
  if (!z.string().uuid().safeParse(orderId).success) notFound();
  const sp = await searchParams;

  const result = await loadShipCheck(createAdminClient(), orderId);
  if (!result.ok && result.status === 404) notFound();
  if (!result.ok) {
    return (
      <div className="min-h-screen bg-secondary/30">
        <div className="max-w-3xl mx-auto px-4 sm:px-6 py-6 sm:py-10 flex flex-col gap-4">
          <AdminLink href="/admin/receiving" className={linkClass}>← Receiving</AdminLink>
          {isMissingIntakeSchema({ message: result.error }) ? (
            <Notice tone="amber">
              The receiving tables aren&apos;t in the database yet. Apply <code className="font-mono">supabase/migrations/20261123_intake_tracking.sql</code>, then reload.
            </Notice>
          ) : (
            <Notice tone="red">Couldn&apos;t load this order&apos;s ship check: {result.error}</Notice>
          )}
        </div>
      </div>
    );
  }

  const { order, groups, trackPlaces, placesError } = result.data;
  // ?bag= is a bag id or a Bag ID (CD-2549-P) from the Scan page
  const bagParam = first(sp.bag).trim();
  const bagCode = normalizeCode(bagParam);
  const highlight = groups.find((g) => g.bag && (g.bag.id === bagParam || (bagCode && g.bag.code.toUpperCase() === bagCode)))?.bag?.id ?? null;
  const shipped = ["shipped_back", "delivered"].includes(order.status);

  return (
    <div className="min-h-screen bg-secondary/30">
      <div className="max-w-3xl mx-auto px-4 sm:px-6 py-4 sm:py-8 flex flex-col gap-4">
        <nav aria-label="Related pages" className="flex flex-wrap items-center justify-between gap-x-4">
          <AdminLink href="/admin/receiving" className={linkClass}>← Receiving</AdminLink>
          <div className="flex flex-wrap gap-x-4">
            <AdminLink href={orderPhotosPath(order.id)} className={linkClass}>Photos</AdminLink>
            <AdminLink href={`/admin/orders/${order.id}`} className={linkClass}>Order page →</AdminLink>
          </div>
        </nav>

        <header>
          <p className="text-xs font-bold uppercase tracking-widest text-muted-foreground">Ship check</p>
          <h1 className="font-heading font-black text-3xl sm:text-4xl text-foreground leading-tight break-words [overflow-wrap:anywhere]">
            {order.customerName?.trim() || "No customer name"}
          </h1>
          <div className="mt-1 flex flex-wrap items-center gap-2">
            <span className="font-mono font-black text-2xl text-foreground">{order.orderNumber}</span>
            <span className="text-xs font-bold px-2.5 py-1 rounded-full bg-white border border-border text-foreground">{order.statusLabel}</span>
          </div>
          <p className="mt-2 text-sm text-muted-foreground">
            Every card going back: done, out of its slot, and in the box. Tick each card as you pack it.
          </p>
        </header>

        {shipped && <Notice tone="blue">This order is already {order.statusLabel}. The list shows how it went out.</Notice>}
        {!trackPlaces && !placesError && <Notice tone="amber">{PLACES_NOTICE}</Notice>}
        {placesError && <Notice tone="red">Couldn&apos;t read where cards are ({placesError}). Done / not done still shows.</Notice>}

        {groups.length === 0 ? (
          <div className="rounded-xl border border-border bg-white p-8 text-center text-sm text-muted-foreground">This order has no cards.</div>
        ) : (
          <ShipChecklist
            orderId={order.id}
            groups={groups}
            highlightBagId={highlight}
            shippingHref={`/admin/orders/${order.id}#shipping`}
            trackPlaces={trackPlaces}
          />
        )}
      </div>
    </div>
  );
}
