import { requireAdmin } from "@/lib/admin-auth";
import { AdminLink } from "@/components/admin-ui/admin-link";
import { thumbnail } from "@/lib/thumbnail";
import { catalogThumb } from "@/lib/card-catalog";
import { tierLabel, statusLabel } from "@/lib/support-view";
import { loadCompletedBags, progressText, type CompletedBag } from "@/lib/intake/completed";
import { dayText, nyDate, nyDateTime } from "@/lib/intake/tracking-format";
import { MarkOrderCompletedButton, MarkSeenButton } from "@/components/intake/tracking-actions";

export const dynamic = "force-dynamic";

const PAGE = 50;
const MAX = 500;

function BagPanel({ bag }: { bag: CompletedBag }) {
  const p = bag.progress;
  const done = bag.cards.filter((c) => c.completed && !c.refunded).length;
  const orderDone = ["completed", "shipped_back", "delivered"].includes(bag.order.status);
  return (
    <li className={`bg-white rounded-xl border p-4 sm:p-5 ${bag.isNew ? "border-green-300 ring-1 ring-green-200" : "border-border"}`}>
      <div className="flex flex-wrap items-center gap-2">
        {bag.isNew && <span className="text-[11px] font-bold px-2 py-0.5 rounded-full bg-green-600 text-white">New</span>}
        <AdminLink href={`/admin/receiving/bag/${bag.id}`} className="font-mono font-black text-lg text-primary hover:underline">
          {bag.bag_code}
        </AdminLink>
        <span className="text-xs font-bold px-2 py-0.5 rounded-full bg-secondary text-foreground">{tierLabel(bag.tier)}</span>
        <span className="ml-auto text-xs text-muted-foreground">Completed {nyDateTime(bag.completed_at)}</span>
      </div>

      <dl className="mt-3 grid grid-cols-2 sm:grid-cols-4 gap-x-4 gap-y-2 text-sm">
        <div>
          <dt className="text-xs font-semibold text-muted-foreground">Customer</dt>
          <dd className="font-semibold text-foreground break-words">{bag.order.customer_name || "—"}</dd>
        </div>
        <div>
          <dt className="text-xs font-semibold text-muted-foreground">Order</dt>
          <dd>
            <AdminLink href={`/admin/orders/${bag.order.id}`} className="font-semibold text-primary hover:underline">
              {bag.order.order_number ? `#${bag.order.order_number}` : "Open order"}
            </AdminLink>
          </dd>
        </div>
        <div>
          <dt className="text-xs font-semibold text-muted-foreground">Cards completed</dt>
          <dd className="font-semibold tabular-nums text-foreground">{done} of {bag.cardCount}</dd>
        </div>
        <div>
          <dt className="text-xs font-semibold text-muted-foreground">Received · Due</dt>
          <dd className="text-foreground">{dayText(bag.received_on, false)} · {dayText(bag.due_date, false)}</dd>
        </div>
      </dl>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <span
          className={`text-xs font-bold px-2.5 py-1 rounded-full ${
            orderDone ? "bg-green-100 text-green-800" : p.allCardsDone ? "bg-green-100 text-green-800" : "bg-amber-100 text-amber-800"
          }`}
        >
          {orderDone ? `Order ${statusLabel(bag.order.status)}` : progressText(p)}
        </span>
        {!orderDone && !p.allCardsDone && (
          <span className="text-xs text-muted-foreground tabular-nums">{p.cardsDone} of {p.cardsTotal} cards of the order done</span>
        )}
      </div>

      <div className="mt-3 flex flex-col sm:flex-row sm:items-start gap-2">
        {p.canMarkCompleted && !orderDone && <MarkOrderCompletedButton orderId={bag.order.id} orderNumber={bag.order.order_number} />}
        {bag.isNew && <MarkSeenButton bagIds={[bag.id]} label="Mark seen" />}
        <AdminLink
          href={`/admin/receiving/bag/${bag.id}`}
          className="min-h-11 px-3 rounded-lg border border-border bg-white text-sm font-bold text-foreground hover:border-primary/40 transition-colors inline-flex items-center justify-center"
        >
          Open bag
        </AdminLink>
      </div>

      <details className="mt-3 rounded-lg border border-border">
        <summary className="min-h-11 px-3 flex items-center text-sm font-semibold text-foreground cursor-pointer select-none">
          Card details ({bag.cards.length})
        </summary>
        <ul className="divide-y divide-border">
          {bag.cards.map((c) => (
            <li key={c.id} className="flex items-center gap-3 px-3 py-2">
              {c.photo ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={c.photoIsReference ? catalogThumb(c.photo) : thumbnail(c.photo, 40)}
                  alt=""
                  loading="lazy"
                  decoding="async"
                  className={`w-10 h-14 shrink-0 rounded object-cover border ${c.photoIsReference ? "border-dashed border-border object-contain bg-white" : "border-border"}`}
                />
              ) : (
                <span className="w-10 h-14 shrink-0 rounded border border-dashed border-border bg-secondary/50" aria-hidden />
              )}
              <div className="min-w-0 flex-1">
                <AdminLink href={`/admin/receiving/card/${c.id}`} className="block text-sm font-semibold text-primary hover:underline truncate">
                  {c.card_name}
                </AdminLink>
                <p className="text-xs text-muted-foreground truncate">
                  {[c.card_code, [c.card_year, c.card_set].filter(Boolean).join(" "), c.card_number ? `#${c.card_number}` : ""].filter(Boolean).join(" · ")}
                </p>
              </div>
              <span className={`shrink-0 text-[11px] font-bold px-2 py-0.5 rounded-full ${c.refunded ? "bg-gray-100 text-gray-500" : c.completed ? "bg-green-100 text-green-800" : "bg-amber-100 text-amber-800"}`}>
                {c.refunded ? "Refunded" : c.completed ? (c.completed_at ? `Done ${nyDate(c.completed_at)}` : "Done") : "Not done"}
              </span>
            </li>
          ))}
        </ul>
      </details>
    </li>
  );
}

export default async function CompletedBagsPage({ searchParams }: { searchParams: Promise<{ limit?: string }> }) {
  await requireAdmin();
  const sp = await searchParams;
  const limit = Math.min(MAX, Math.max(PAGE, Number.parseInt(sp.limit ?? "", 10) || PAGE));
  const { bags, hasMore, unseen, missingTables, error } = await loadCompletedBags(limit);

  return (
    <div className="min-h-screen bg-secondary/30">
      <div className="max-w-5xl mx-auto px-4 sm:px-6 py-6 sm:py-10">
        <AdminLink href="/admin/receiving" className="inline-flex items-center min-h-11 text-sm font-semibold text-primary hover:underline">
          ← Receiving
        </AdminLink>
        <div className="flex flex-wrap items-end justify-between gap-3 mb-5">
          <div>
            <h1 className="font-heading font-black text-3xl text-foreground">Completed</h1>
            <p className="text-muted-foreground text-sm mt-0.5 max-w-2xl">
              Tier bags whose cards are all done, newest first. A finished bag never completes its order: mark the order completed once every card is done.
            </p>
          </div>
          {unseen > 0 && (
            <div className="flex items-center gap-2">
              <span className="text-sm font-bold text-green-800">{unseen} new</span>
              <MarkSeenButton />
            </div>
          )}
        </div>

        {missingTables && (
          <div role="status" className="mb-5 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
            The receiving tables aren&apos;t in the database yet. Apply <code className="font-mono">supabase/migrations/20261123_intake_tracking.sql</code>, then reload.
          </div>
        )}
        {error && (
          <div role="alert" className="mb-5 rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-800">
            Couldn&apos;t load completed bags: {error}
          </div>
        )}

        {!missingTables && !error && bags.length === 0 && (
          <div className="rounded-xl border border-border bg-white p-8 text-center text-sm text-muted-foreground">
            No completed bags yet. A bag shows up here once every card in it is done.
          </div>
        )}

        {bags.length > 0 && (
          <ul className="flex flex-col gap-3">
            {bags.map((b) => <BagPanel key={b.id} bag={b} />)}
          </ul>
        )}

        {hasMore && limit < MAX && (
          <div className="mt-5 text-center">
            <AdminLink
              href={`/admin/receiving/completed?limit=${Math.min(MAX, limit + PAGE)}`}
              className="inline-flex items-center justify-center min-h-11 px-4 rounded-lg border border-border bg-white text-sm font-bold text-foreground hover:border-primary/40"
            >
              Show older
            </AdminLink>
          </div>
        )}
      </div>
    </div>
  );
}
