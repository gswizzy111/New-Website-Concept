import { redirect } from "next/navigation";
import { AdminLink } from "@/components/admin-ui/admin-link";
import { ManualOrderForm } from "./manual-order-form";
import { isAdmin } from "@/lib/admin-auth";
import { getLiveTiers } from "@/lib/live-tiers";
import { createAdminClient } from "@/lib/supabase/admin";
import { dropoffPrefill } from "@/lib/show-dropoff-prefill";
import { getPrepCardCents } from "@/lib/show-dropoff-services";

export const dynamic = "force-dynamic";

export default async function NewManualOrderPage({ searchParams }: { searchParams: Promise<{ show_dropoff?: string }> }) {
  if (!(await isAdmin())) {
    redirect("/admin/login");
  }
  // The admin's tier names and prices, so the preview matches what is saved
  const tiers = await getLiveTiers();

  // Opened from a show drop-off: start with its customer, cards and notes
  const { show_dropoff } = await searchParams;
  let prefill = null;
  if (show_dropoff && /^[0-9a-f-]{36}$/i.test(show_dropoff)) {
    const { data } = await createAdminClient().from("show_dropoffs").select("*").eq("id", show_dropoff).eq("status", "new").maybeSingle();
    // PSA Prep isn't a tier here: its cards start at the admin's Prep price, as Show Dropoffs prices them
    if (data) prefill = dropoffPrefill(data, (data.tiers as string[]).includes("prep") ? await getPrepCardCents() : null);
  }

  return (
    <div className="min-h-screen bg-secondary/30">
      <div className="max-w-3xl mx-auto px-6 py-10">
        <div className="mb-8 flex items-center gap-3">
          <AdminLink href="/admin" className="text-sm text-muted-foreground hover:text-primary transition-colors">
            ← All Orders
          </AdminLink>
        </div>
        <div className="mb-8">
          <h1 className="font-heading font-black text-3xl text-foreground">Create Manual Order</h1>
          <p className="text-muted-foreground text-sm mt-1">Add a restoration order manually — no Stripe payment required.</p>
        </div>
        {prefill && (
          <div className="mb-6 rounded-xl border border-primary/30 bg-primary/5 px-5 py-4 text-sm">
            <p className="font-bold text-foreground">From Show Drop-off #{prefill.dropoffNumber}</p>
            <p className="text-muted-foreground mt-0.5">
              Their details, return address and cards are filled in. {prefill.fivePlus ? "They chose 5+ Cards, so add each card below." : "Check each card and add anything missing."} Creating the order marks the drop-off as entered. The order shows its total, which isn&apos;t counted in revenue reports.
            </p>
          </div>
        )}
        <ManualOrderForm tiers={tiers} prefill={prefill} />
      </div>
    </div>
  );
}
