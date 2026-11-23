import { Suspense } from "react";
import { Camera } from "lucide-react";
import { AdminLink } from "@/components/admin-ui/admin-link";
import { createAdminClient } from "@/lib/supabase/admin";
import { nyToday } from "@/lib/intake/business-days";
import { orderPhotosPath } from "@/lib/intake/codes";
import { loadOrderIntake } from "@/lib/intake/data";
import { loadHolidays } from "@/lib/intake/due-dates";
import { nyDate } from "@/lib/intake/tracking-format";
import {
  DoneBar, DUE_TEXT, dueInfo, LabelStatus, shortDay, StepSummary, TierBadge,
} from "@/app/admin/receiving/bags/_components/bag-bits";

/**
 * The order page's "Work orders" panel (/admin/orders/<id>): the order's tier
 * bags, each its own work order on our side (Bag ID, label, due date, steps,
 * completion), while the customer keeps one order. Renders nothing for an
 * order without bags (older orders, or nothing received yet) and streams in
 * after the page, so it never holds the order page up. Read only.
 */
export function OrderBagsPanel({ orderId }: { orderId: string }) {
  return (
    <Suspense fallback={null}>
      <BagsPanel orderId={orderId} />
    </Suspense>
  );
}

const focusRing = "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary";
const button = `min-h-11 px-3 rounded-lg border text-sm font-bold inline-flex items-center justify-center gap-1.5 whitespace-nowrap transition-colors ${focusRing}`;

async function BagsPanel({ orderId }: { orderId: string }) {
  const admin = createAdminClient();
  // Most orders have no bags: one small read before loading the intake model
  const { data: probe, error } = await admin.from("tier_bags").select("id").eq("order_id", orderId).limit(1);
  if (error || !probe?.length) return null;
  const [loaded, holidays] = await Promise.all([loadOrderIntake(admin, orderId, { heal: false }), loadHolidays(admin)]);
  if (!loaded.ok || !loaded.intake.bags.length) return null;
  const { bags } = loaded.intake;
  const today = nyToday();

  return (
    <section aria-labelledby="work-orders-h" className="bg-white rounded-xl border border-border p-4 sm:p-5 mb-6">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <h2 id="work-orders-h" className="font-heading font-black text-lg text-foreground">
          Work orders <span className="text-sm font-medium text-muted-foreground">({bags.length} bag{bags.length === 1 ? "" : "s"})</span>
        </h2>
        <AdminLink href="/admin/receiving/bags" className={`inline-flex items-center min-h-11 text-sm font-bold text-primary hover:underline rounded ${focusRing}`}>
          All open bags →
        </AdminLink>
      </div>
      <p className="text-xs text-muted-foreground">Each tier bag is worked, labelled and finished on its own. The customer still has one order.</p>

      <ul className="mt-2 divide-y divide-border">
        {bags.map((b) => {
          const due = dueInfo({ dueDate: b.dueDate, dueStatus: b.dueStatus, complete: b.complete, today, holidays });
          return (
            <li key={b.id} className="py-3 grid gap-x-5 gap-y-2 md:grid-cols-[minmax(0,13rem)_minmax(0,10rem)_minmax(0,1fr)] xl:grid-cols-[minmax(0,13rem)_minmax(0,10rem)_minmax(0,1fr)_auto] md:items-start">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <AdminLink
                    href={`/admin/receiving/bag/${b.id}`}
                    className={`font-mono font-black text-xl leading-tight text-foreground hover:text-primary hover:underline underline-offset-4 [overflow-wrap:anywhere] rounded ${focusRing}`}
                  >
                    {b.code}
                  </AdminLink>
                  <TierBadge tier={b.tier} name={b.tierName} />
                </div>
                <p className="mt-1 text-sm text-foreground">
                  <span className="font-black tabular-nums">{b.completedCount}/{b.cardCount}</span> card{b.cardCount === 1 ? "" : "s"} done
                </p>
                {b.cardCount > 0 && (
                  <div className="mt-1 max-w-40">
                    <DoneBar done={b.completedCount} total={b.cardCount} />
                  </div>
                )}
              </div>

              <div className="min-w-0">
                {b.complete ? (
                  <>
                    <p className="font-heading font-black text-base leading-tight text-green-700">Completed</p>
                    <p className="text-xs text-muted-foreground">{b.completedAt ? nyDate(b.completedAt) : "All cards done"}</p>
                  </>
                ) : (
                  <>
                    <p className={`font-heading font-black text-base leading-tight ${b.dueDate ? DUE_TEXT[due.kind] : "text-amber-800"}`}>
                      {b.dueDate ? `Due ${shortDay(b.dueDate, today)}` : "No due date"}
                    </p>
                    {due.hint && due.hint !== "No due date" && (
                      <p className={`text-xs font-bold ${due.kind === "upcoming" ? "text-muted-foreground" : DUE_TEXT[due.kind]}`}>{due.hint}</p>
                    )}
                    {due.needsReview && <p className="text-xs font-semibold text-amber-800">Due date needs review</p>}
                  </>
                )}
                {b.receivedOn && <p className="text-xs text-muted-foreground">Received {shortDay(b.receivedOn, today)}</p>}
              </div>

              <div className="min-w-0">
                <StepSummary groups={b.stageGroups} />
              </div>

              <div className="min-w-0 flex flex-wrap items-center gap-2 md:col-span-3 xl:col-span-1 xl:flex-col xl:items-stretch">
                <LabelStatus printedAt={b.labelPrintedAt} outdated={b.labelOutdated} />
                <div className="flex gap-2">
                  <AdminLink
                    href={`/admin/receiving/bag/${b.id}`}
                    aria-label={`Open bag ${b.code}`}
                    className={`${button} flex-1 bg-primary text-primary-foreground border-primary hover:bg-primary/90`}
                  >
                    Open bag
                  </AdminLink>
                  <AdminLink
                    href={orderPhotosPath(b.orderId, b.id)}
                    aria-label={`Photos of bag ${b.code}`}
                    className={`${button} flex-1 bg-white text-foreground border-border hover:border-primary/40`}
                  >
                    <Camera aria-hidden className="size-4" strokeWidth={1.75} />
                    Photos
                  </AdminLink>
                </div>
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
