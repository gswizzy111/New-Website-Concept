import { notFound } from "next/navigation";
import { createAdminClient } from "@/lib/supabase/admin";
import { AdminLink } from "@/components/admin-ui/admin-link";
import { requireAdmin } from "@/lib/admin-auth";
import { getDropoffServices } from "@/lib/show-dropoff-services";
import { FIVE_PLUS_LABEL, addressLine, serviceName } from "@/lib/show-dropoffs";
import { dropoffRevenue } from "@/lib/show-dropoff-revenue";
import { DropoffActions } from "./dropoff-actions";

export const dynamic = "force-dynamic";

type Card = { name: string; details: string | null; service: string | null };

const usd = (cents: number) =>
  `$${(cents / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const when = (iso: string) =>
  new Date(iso).toLocaleString("en-US", { timeZone: "America/New_York", dateStyle: "medium", timeStyle: "short" });

export default async function ShowDropoffPage({ params }: { params: Promise<{ id: string }> }) {
  await requireAdmin();
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();

  const admin = createAdminClient();
  const [{ data: d }, services] = await Promise.all([
    admin.from("show_dropoffs").select("*").eq("id", id).maybeSingle(),
    getDropoffServices(),
  ]);
  if (!d) notFound();

  // Its order, and what it counts on Show Dropoffs (the order's total once entered)
  const [order, money] = await Promise.all([
    d.order_id
      ? admin.from("orders").select("id, order_number").eq("id", d.order_id).maybeSingle()
          .then(({ data }) => data as { id: string; order_number: string | null } | null)
      : null,
    dropoffRevenue([d]).then((m) => m.get(d.id) ?? null, () => null),
  ]);

  const cards = (d.cards ?? []) as Card[];
  const panel = "bg-white rounded-xl border border-border p-6 flex flex-col gap-3";
  const h2 = "font-heading font-black text-base text-foreground";
  const row = "flex flex-wrap justify-between gap-x-4 gap-y-0.5 text-sm";
  const k = "text-muted-foreground";

  return (
    <div className="min-h-screen bg-secondary/30">
      <div className="max-w-3xl mx-auto px-6 py-10 flex flex-col gap-6">
        <AdminLink href="/admin/show-dropoffs" className="text-sm text-muted-foreground hover:text-primary transition-colors">
          ← All Show Dropoffs
        </AdminLink>

        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h1 className="font-heading font-black text-3xl text-foreground">Drop-off #{d.dropoff_number}</h1>
            <p className="text-muted-foreground text-sm mt-1">
              {d.customer_name} · {when(d.created_at)}{d.show_name ? ` · ${d.show_name}` : ""}
            </p>
          </div>
          {d.status === "new" && (
            <AdminLink
              href={`/admin/orders/new?show_dropoff=${d.id}`}
              className="h-10 px-5 bg-primary text-primary-foreground rounded-lg text-sm font-bold hover:bg-primary/90 transition-colors flex items-center"
            >
              Create Order →
            </AdminLink>
          )}
          {d.status === "entered" && order && (
            <AdminLink
              href={`/admin/orders/${order.id}`}
              className="h-10 px-5 bg-green-600 text-white rounded-lg text-sm font-bold hover:bg-green-700 transition-colors flex items-center"
            >
              Entered as order #{order.order_number ?? "—"} →
            </AdminLink>
          )}
          {d.status === "cancelled" && (
            <span className="rounded-full bg-gray-100 px-3 py-1 text-xs font-bold text-gray-600">Cancelled</span>
          )}
        </div>

        <section className={panel}>
          <h2 className={h2}>Customer</h2>
          <div className={row}><span className={k}>Name</span><span className="font-semibold">{d.customer_name}</span></div>
          <div className={row}><span className={k}>Email</span><a className="font-semibold text-primary hover:underline" href={`mailto:${d.customer_email}`}>{d.customer_email}</a></div>
          <div className={row}><span className={k}>Phone</span><a className="font-semibold text-primary hover:underline" href={`tel:${d.customer_phone}`}>{d.customer_phone}</a></div>
          <div className={row}><span className={k}>Return address</span><span className="font-semibold text-right">{addressLine(d.return_address ?? {})}</span></div>
        </section>

        <section className={panel}>
          <h2 className={h2}>Services and cards</h2>
          <div className="flex flex-wrap gap-1.5">
            {(d.tiers as string[]).map((t) => (
              <span key={t} className="rounded-full bg-primary/10 px-2.5 py-0.5 text-xs font-bold text-primary">{serviceName(services, t)}</span>
            ))}
          </div>
          {d.five_plus ? (
            <p className="rounded-lg bg-yellow-50 border border-yellow-200 px-4 py-3 text-sm">
              <strong>{FIVE_PLUS_LABEL}</strong>{d.card_count ? `: about ${d.card_count} cards` : ""}. The customer didn&apos;t list them: log each card when you create the order.
            </p>
          ) : (
            <ol className="flex flex-col gap-2">
              {cards.map((c, i) => (
                <li key={i} className="rounded-lg border border-border px-4 py-3 text-sm">
                  <div className="flex flex-wrap justify-between gap-2">
                    <span className="font-semibold">{i + 1}. {c.name}</span>
                    {c.service && <span className="text-xs font-bold text-primary">{serviceName(services, c.service)}</span>}
                  </div>
                  {c.details && <p className="mt-1 text-muted-foreground whitespace-pre-line">{c.details}</p>}
                </li>
              ))}
            </ol>
          )}
          {d.customer_notes && (
            <div className="text-sm"><span className={k}>Customer notes: </span><span className="whitespace-pre-line">{d.customer_notes}</span></div>
          )}
          {money && !money.cancelled && (
            <div className={`${row} border-t border-border pt-3`}>
              <span className={k}>{money.fromOrder ? "Total (the order's total)" : "Total at today's prices"}</span>
              {!money.complete && money.cents === 0 ? (
                <span className="text-muted-foreground">Needs pricing (Diamond, or 5+ cards with several services)</span>
              ) : (
                <span className="font-black tabular-nums">{usd(money.cents)}{money.complete ? "" : "+"}</span>
              )}
            </div>
          )}
        </section>

        <section className={panel}>
          <h2 className={h2}>Signature</h2>
          <div className={row}><span className={k}>Signed by</span><span className="font-semibold">{d.signed_name}</span></div>
          <div className={row}><span className={k}>Signed at</span><span>{when(d.signed_at)}</span></div>
          <div className={row}><span className={k}>Terms of Service</span><a className="text-primary hover:underline" href={`/terms/v${d.terms_version}`} target="_blank" rel="noreferrer">v{d.terms_version}</a></div>
          <div className={row}><span className={k}>Photos on social media</span><span>{d.media_permission ? (d.tag_permission ? "Yes, may tag them" : "Yes, no tag") : "No"}</span></div>
          <details className="text-sm">
            <summary className="cursor-pointer font-semibold text-primary">Exact text signed</summary>
            <pre className="mt-2 max-h-96 overflow-auto whitespace-pre-wrap rounded-lg bg-secondary/50 p-3 text-xs">{d.signed_text}</pre>
            <p className="mt-1 break-all text-xs text-muted-foreground">SHA-256 (Terms + text): {d.signed_sha256}</p>
          </details>
        </section>

        <section className={panel}>
          <h2 className={h2}>Processing</h2>
          <DropoffActions id={d.id} status={d.status} adminNotes={d.admin_notes ?? ""} />
        </section>
      </div>
    </div>
  );
}
