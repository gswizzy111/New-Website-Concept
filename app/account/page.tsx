import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { redirect } from "next/navigation";
import { formatCurrency } from "@/lib/utils";
import { ORDER_STATUSES } from "@/lib/constants";
import type { OrderStatus } from "@/lib/constants";
import Link from "next/link";
import { AccountHeader } from "./account-header";
import { likeExact } from "@/lib/like-exact";
import { ArrowRight } from "lucide-react";
import { PAGE_TITLE, PANEL, PANEL_TITLE, Eyebrow, StatusPill } from "@/components/account/portal";
import { cta } from "@/components/brand";

export const dynamic = "force-dynamic";

type Tone = "ink" | "cobalt" | "sun" | "success" | "danger" | "muted" | "wash";

const STATUS_TONE: Record<string, Tone> = {
  awaiting_payment: "muted",
  awaiting_cards:   "sun",
  received:         "wash",
  in_progress:      "cobalt",
  completed:        "success",
  shipped_back:     "ink",
  delivered:        "success",
  cancelled:        "danger",
};

const KIT_STATUS_TONE: Record<string, Tone> = {
  paid:       "wash",
  processing: "sun",
  shipped:    "ink",
  delivered:  "success",
  cancelled:  "danger",
};

const ROW = "group flex items-center justify-between gap-4 rounded-[18px] bg-white p-4 shadow-[0_0_0_1px_var(--line)] transition-[box-shadow,transform] duration-200 hover:-translate-y-0.5 hover:shadow-[0_0_0_1px_var(--line),var(--pop-shadow)] focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-cobalt sm:p-5 motion-reduce:hover:translate-y-0";

type ShopItem = { product_name: string; quantity: number };

export default async function AccountPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/account/login");

  const email = user.email!;
  const admin = createAdminClient();

  const [restResult, kitResult] = await Promise.all([
    admin
      .from("orders")
      .select("id, order_number, status, restoration_tier, total_cents, created_at, shipping_label_url, inbound_method")
      .ilike("customer_email", likeExact(email))
      .not("status", "eq", "awaiting_payment")
      .order("created_at", { ascending: false }),
    admin
      .from("shop_orders")
      .select("id, order_number, status, total_cents, created_at, items, tracking_number, carrier")
      .ilike("customer_email", likeExact(email))
      .order("created_at", { ascending: false }),
  ]);

  const restorationOrders = restResult.data ?? [];
  const kitOrders = kitResult.data ?? [];

  const displayName = (user.user_metadata?.name as string | undefined) ?? email.split("@")[0];

  return (
    <div className="surface-chalk min-h-screen">
      <AccountHeader email={email} active="orders" />

      <div className="mx-auto flex max-w-5xl flex-col gap-10 px-4 py-10 sm:px-6 md:py-14">
        <div className="flex flex-col justify-between gap-6 md:flex-row md:items-end">
          <div>
            <h1 className={`${PAGE_TITLE} [overflow-wrap:anywhere]`}>Welcome back, {displayName}</h1>
            <p className="mt-3 text-[17px] text-ink-soft">View and manage your orders below.</p>
          </div>
          <Link href="/order" className={cta({ tone: "sun", size: "md", className: "self-start md:self-auto" })}>
            Book a Restoration
            <ArrowRight aria-hidden className="size-4" strokeWidth={2.25} />
          </Link>
        </div>

        {/* Restoration Orders */}
        <section>
          <Eyebrow as="h2">Restoration Orders</Eyebrow>
          {restorationOrders.length === 0 ? (
            <div className={`${PANEL} mt-2 flex flex-col items-start gap-4 sm:flex-row sm:items-center sm:justify-between`}>
              <p className="text-[15px] text-ink-soft">No restoration orders found.</p>
              <Link href="/order" className={cta({ tone: "outline", size: "sm" })}>Place your first order →</Link>
            </div>
          ) : (
            <div className="mt-2 flex flex-col gap-3">
              {restorationOrders.map((order) => {
                const status = order.status as OrderStatus;
                const statusInfo = ORDER_STATUSES[status] ?? { label: order.status };
                const orderLabel = /^\d+$/.test(String(order.order_number))
                  ? `R${order.order_number}`
                  : order.order_number;

                return (
                  <Link key={order.id} href={`/account/orders/${order.id}`} className={ROW}>
                    <div className="flex min-w-0 flex-col gap-2">
                      <div className="flex flex-wrap items-center gap-2.5">
                        <span className={PANEL_TITLE}>{orderLabel}</span>
                        <StatusPill tone={STATUS_TONE[order.status] ?? "muted"}>{statusInfo.label}</StatusPill>
                        {order.status === "awaiting_cards" && (
                          <StatusPill tone="wash">Edit cards ✏️</StatusPill>
                        )}
                      </div>
                      <p className="text-sm text-ink-soft">
                        {new Date(order.created_at).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}
                        {order.total_cents ? ` · ${formatCurrency(order.total_cents)}` : ""}
                      </p>
                    </div>
                    <span className="flex shrink-0 items-center gap-1 text-sm font-bold text-ink-soft group-hover:text-ink">
                      View →
                    </span>
                  </Link>
                );
              })}
            </div>
          )}
        </section>

        {/* Kit Orders */}
        {kitOrders.length > 0 && (
          <section>
            <Eyebrow as="h2">Kit Orders</Eyebrow>
            <div className="mt-2 flex flex-col gap-3">
              {kitOrders.map((order) => {
                const items = (order.items ?? []) as ShopItem[];
                const kitStatusLabels: Record<string, string> = { paid: "Processing", processing: "Processing", shipped: "Shipped", delivered: "Delivered", cancelled: "Cancelled" };
                const statusLabel = kitStatusLabels[order.status] ?? order.status;

                return (
                  <Link key={order.id} href={`/account/kit-orders/${order.id}`} className={ROW}>
                    <div className="flex min-w-0 flex-col gap-2">
                      <div className="flex flex-wrap items-center gap-2.5">
                        {order.order_number && (
                          <span className={PANEL_TITLE}>K{order.order_number}</span>
                        )}
                        <StatusPill tone={KIT_STATUS_TONE[order.status] ?? "muted"}>{statusLabel}</StatusPill>
                      </div>
                      <p className="text-sm text-ink-soft">
                        {new Date(order.created_at).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}
                        {order.total_cents ? ` · ${formatCurrency(order.total_cents)}` : ""}
                        {items.length > 0 ? ` · ${items.map((i) => i.product_name).join(", ")}` : ""}
                      </p>
                    </div>
                    <span className="flex shrink-0 items-center gap-1 text-sm font-bold text-ink-soft group-hover:text-ink">
                      View →
                    </span>
                  </Link>
                );
              })}
            </div>
          </section>
        )}
      </div>
    </div>
  );
}
