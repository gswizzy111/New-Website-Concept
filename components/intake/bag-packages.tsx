import { createAdminClient } from "@/lib/supabase/admin";
import { AdminLink } from "@/components/admin-ui/admin-link";
import { tierDisplayName } from "@/lib/intake/codes";
import { packageRows, trackingHref, type PackageTone } from "@/lib/intake/packing-view";
import { packageSummaries, type BagShipmentRow } from "@/lib/intake/shipping/types";

/**
 * The admin order page's Shipping card, under the return label: one row per
 * package when the order ships bag by bag ("ship each bag when done", owner,
 * Nov 25 2026): the bag, its state, its tracking and its packing page.
 * Shown only once a bag label exists (bought, being bought or shipped);
 * nothing before the bag_shipments migration or on a failed read. Server
 * component; reads only.
 */

type CardLike = { id: string; bag_id?: string | null; status?: string | null; completed?: boolean | null };
type BagRow = { id: string; bag_code: string; tier: string; batch: number | null };
type ShipmentRow = Pick<BagShipmentRow, "id" | "bag_id" | "order_id" | "status" | "tracking_number" | "tracking_url" | "carrier"> & { claimed_at: string };

const TONE: Record<PackageTone, string> = {
  done: "bg-green-100 text-green-700",
  label: "bg-blue-100 text-blue-700",
  ready: "bg-amber-100 text-amber-800",
  work: "bg-gray-100 text-gray-600",
};
const LIVE = ["claimed", "purchased", "shipped", "delivered"];

export async function BagPackages({ orderId, cards }: { orderId: string; cards: readonly CardLike[] }) {
  const admin = createAdminClient();
  const [bagsRes, shipRes] = await Promise.all([
    admin.from("tier_bags").select("id, bag_code, tier, batch").eq("order_id", orderId),
    // Rows with no bag are the order page's own claim on its whole-order label: not a package
    admin.from("bag_shipments").select("id, bag_id, order_id, status, tracking_number, tracking_url, carrier, claimed_at")
      .eq("order_id", orderId).not("bag_id", "is", null).order("claimed_at"),
  ]);
  if (bagsRes.error || shipRes.error) return null;
  const shipments = (shipRes.data ?? []) as ShipmentRow[];
  if (!shipments.some((s) => LIVE.includes(s.status))) return null;
  const bags = (bagsRes.data ?? []) as BagRow[];
  const rows = packageRows(
    packageSummaries(
      bags,
      cards.map((c) => ({ id: c.id, bag_id: c.bag_id ?? null, status: c.status ?? null, completed: !!c.completed })),
      shipments as unknown as BagShipmentRow[],
      (tier) => tierDisplayName(tier),
    ),
  );
  if (rows.length === 0) return null;
  const live = (bagId: string) => shipments.find((s) => s.bag_id === bagId && LIVE.includes(s.status)) ?? null;
  return (
    <div className="mt-4">
      <p className="text-xs font-bold uppercase tracking-widest text-muted-foreground mb-2">
        Packages ({rows.length}, one label per bag)
      </p>
      <ul className="flex flex-col divide-y divide-border rounded-lg border border-border">
        {rows.map((r) => {
          const s = live(r.bagId);
          const href = s?.tracking_number ? trackingHref({ trackingNumber: s.tracking_number, carrier: s.carrier, trackingUrl: s.tracking_url }) : null;
          return (
            <li key={r.bagId} className="flex flex-wrap items-center gap-x-2 gap-y-1 px-3 py-2 text-sm">
              <span className="font-semibold text-foreground">{r.tierName}</span>
              <span className="font-mono text-xs font-bold text-foreground">{r.bagCode}</span>
              <span className={`text-xs font-bold px-2 py-0.5 rounded-full ${TONE[r.status.tone]}`}>{r.status.text}</span>
              {r.trackingNumber && (
                href ? (
                  <a href={href} target="_blank" rel="noopener noreferrer" className="font-mono text-xs text-primary hover:underline break-all">{r.trackingNumber}</a>
                ) : (
                  <span className="font-mono text-xs text-muted-foreground break-all">{r.trackingNumber}</span>
                )
              )}
              <AdminLink href={r.href} className="ml-auto text-xs font-bold text-primary hover:underline">Packing page →</AdminLink>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
