import { AdminLink } from "@/components/admin-ui/admin-link";
import { requireAdmin } from "@/lib/admin-auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { SETUP_BATCH } from "@/lib/intake/migration";
import { intakeTablesReady, MISSING_TABLES_NOTICE } from "@/app/api/admin/intake/setup/_lib/store";
import { SetupClient } from "./setup-client";

export const dynamic = "force-dynamic";

export default async function HistoricalOrderSetupPage() {
  await requireAdmin();
  let ready = true;
  let error: string | null = null;
  try {
    ready = await intakeTablesReady(createAdminClient());
  } catch (e) {
    error = e instanceof Error ? e.message : String(e);
  }

  return (
    <div className="min-h-screen bg-secondary/30">
      <div className="max-w-5xl mx-auto px-4 sm:px-6 py-6 sm:py-10">
        <AdminLink href="/admin/receiving" className="inline-flex items-center min-h-11 text-sm font-semibold text-primary hover:underline">
          ← Receiving
        </AdminLink>
        <div className="mb-5">
          <h1 className="font-heading font-black text-3xl text-foreground">Historical Order Setup</h1>
          <p className="text-muted-foreground text-sm mt-0.5 max-w-2xl">
            Gives orders from before Receiving their Card IDs, tier bags, QR codes and due dates. Customer details, images,
            stages and completed orders stay exactly as they are, and running it again changes nothing that&apos;s already set up.
          </p>
        </div>

        {!ready ? (
          <div role="status" className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
            {MISSING_TABLES_NOTICE}
          </div>
        ) : error ? (
          <div role="alert" className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-800">
            Couldn&apos;t check the database: {error}
          </div>
        ) : (
          <SetupClient batchSize={SETUP_BATCH} />
        )}
      </div>
    </div>
  );
}
