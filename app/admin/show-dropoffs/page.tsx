import { createAdminClient } from "@/lib/supabase/admin";
import { AdminLink } from "@/components/admin-ui/admin-link";
import { requireAdmin } from "@/lib/admin-auth";
import { getDropoffServices } from "@/lib/show-dropoff-services";
import { FIVE_PLUS_LABEL, serviceName } from "@/lib/show-dropoffs";

export const dynamic = "force-dynamic";

const STATUS_STYLES: Record<string, { label: string; cls: string }> = {
  new:       { label: "To enter",  cls: "bg-blue-100 text-blue-700" },
  entered:   { label: "Entered",   cls: "bg-green-100 text-green-700" },
  cancelled: { label: "Cancelled", cls: "bg-gray-100 text-gray-500" },
};

type Row = {
  id: string; dropoff_number: number; created_at: string; show_name: string | null;
  customer_name: string; customer_email: string; customer_phone: string;
  tiers: string[]; five_plus: boolean; card_count: number | null; status: string;
};

const when = (iso: string) =>
  new Date(iso).toLocaleString("en-US", { timeZone: "America/New_York", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });

export default async function ShowDropoffsAdminPage({ searchParams }: { searchParams: Promise<{ filter?: string; show?: string }> }) {
  await requireAdmin();
  const sp = await searchParams;
  const filter = sp.filter ?? "new";
  const show = sp.show ?? "";

  const admin = createAdminClient();
  let query = admin
    .from("show_dropoffs")
    .select("id, dropoff_number, created_at, show_name, customer_name, customer_email, customer_phone, tiers, five_plus, card_count, status")
    .order("created_at", { ascending: false })
    .limit(500);
  if (filter !== "all") query = query.eq("status", filter);
  if (show) query = query.eq("show_name", show);
  const [{ data, error }, services, { data: shows }] = await Promise.all([
    query,
    getDropoffServices(),
    admin.from("show_dropoffs").select("show_name").not("show_name", "is", null).order("created_at", { ascending: false }).limit(1000),
  ]);
  const list = (data ?? []) as Row[];
  const showNames = [...new Set((shows ?? []).map((r) => r.show_name as string))].slice(0, 12);

  const link = (patch: Record<string, string>) => {
    const p = new URLSearchParams({ filter, ...(show ? { show } : {}), ...patch });
    if (!p.get("show")) p.delete("show");
    return `/admin/show-dropoffs?${p}`;
  };
  const chip = (label: string, href: string, active: boolean) => (
    <AdminLink
      key={href}
      href={href}
      className={`px-3 py-1.5 rounded-lg text-xs font-bold border whitespace-nowrap transition-colors ${active ? "bg-primary text-primary-foreground border-primary" : "bg-white text-muted-foreground border-border hover:border-primary/40"}`}
    >
      {label}
    </AdminLink>
  );

  return (
    <div className="min-h-screen bg-secondary/30">
      <div className="max-w-5xl mx-auto px-6 py-10">
        <div className="flex flex-wrap items-end justify-between gap-4 mb-6">
          <div>
            <h1 className="font-heading font-black text-3xl text-foreground">Show Dropoffs</h1>
            <p className="text-muted-foreground text-sm mt-0.5">
              Cards taken in at card shows. Open one and press Create Order to enter it.
            </p>
          </div>
          <a
            href="/show-dropoffs"
            target="_blank"
            rel="noreferrer"
            className="h-9 px-4 bg-primary text-primary-foreground rounded-lg text-sm font-bold hover:bg-primary/90 transition-colors flex items-center"
          >
            Open the form ↗
          </a>
        </div>

        <div className="flex flex-wrap gap-2 mb-3">
          {chip("To enter", link({ filter: "new" }), filter === "new")}
          {chip("Entered", link({ filter: "entered" }), filter === "entered")}
          {chip("Cancelled", link({ filter: "cancelled" }), filter === "cancelled")}
          {chip("All", link({ filter: "all" }), filter === "all")}
        </div>
        {showNames.length > 0 && (
          <div className="flex flex-wrap gap-2 mb-6">
            {chip("Every show", link({ show: "" }), !show)}
            {showNames.map((n) => chip(n, link({ show: n }), show === n))}
          </div>
        )}

        {error ? (
          <p className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">Couldn&apos;t load drop-offs: {error.message}</p>
        ) : list.length === 0 ? (
          <div className="rounded-xl border border-border bg-white p-10 text-center text-sm text-muted-foreground">
            No drop-offs here yet.
          </div>
        ) : (
          <div className="overflow-x-auto rounded-xl border border-border bg-white">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-left text-xs font-semibold text-muted-foreground">
                  <th className="px-4 py-3">#</th>
                  <th className="px-4 py-3">Customer</th>
                  <th className="px-4 py-3">Services</th>
                  <th className="px-4 py-3">Cards</th>
                  <th className="px-4 py-3">Show</th>
                  <th className="px-4 py-3">Received</th>
                  <th className="px-4 py-3">Status</th>
                </tr>
              </thead>
              <tbody>
                {list.map((r) => {
                  const st = STATUS_STYLES[r.status] ?? STATUS_STYLES.new;
                  return (
                    <tr key={r.id} className="border-b border-border last:border-0 hover:bg-secondary/40">
                      <td className="px-4 py-3 font-bold tabular-nums">
                        <AdminLink href={`/admin/show-dropoffs/${r.id}`} className="text-primary hover:underline">#{r.dropoff_number}</AdminLink>
                      </td>
                      <td className="px-4 py-3">
                        <AdminLink href={`/admin/show-dropoffs/${r.id}`} className="font-semibold text-foreground hover:underline">{r.customer_name}</AdminLink>
                        <div className="text-xs text-muted-foreground">{r.customer_email}</div>
                      </td>
                      <td className="px-4 py-3 text-xs">{r.tiers.map((t) => serviceName(services, t)).join(", ")}</td>
                      <td className="px-4 py-3 whitespace-nowrap">
                        {r.five_plus ? <span className="font-semibold">{FIVE_PLUS_LABEL}{r.card_count ? ` (~${r.card_count})` : ""}</span> : r.card_count ?? "—"}
                      </td>
                      <td className="px-4 py-3 text-xs text-muted-foreground">{r.show_name ?? "—"}</td>
                      <td className="px-4 py-3 text-xs text-muted-foreground whitespace-nowrap">{when(r.created_at)}</td>
                      <td className="px-4 py-3"><span className={`rounded-full px-2 py-0.5 text-xs font-bold ${st.cls}`}>{st.label}</span></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
