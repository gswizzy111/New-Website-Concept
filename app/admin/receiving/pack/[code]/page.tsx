import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { requireAdmin } from "@/lib/admin-auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { AdminLink } from "@/components/admin-ui/admin-link";
import { PackBoard } from "./_components/pack-board";
import { loadPack } from "./_lib/load";

/**
 * Packing one bag (/admin/receiving/pack/<Bag ID>, any case): the owner
 * ships each bag when it's done (Nov 25 2026). Made for a phone: who it is
 * and where it goes, the bag's cards with a photo and a big ✓ or ✗ each to
 * match by eye, then ONE button for what comes next: "Buy return label",
 * "Print label" and "Mark shipped", or the tracking once it has shipped.
 * Full admins only. The page reads through the packing service
 * (lib/intake/shipping/bag-shipments.ts loadPacking, the GET route's own
 * answer); buying and Mark shipped go through
 * POST /api/admin/intake/bags/<id>/ship-label and .../shipped.
 */

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Pack and ship | Receiving", robots: { index: false } };

const focusRing = "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary";

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-secondary/30 pb-10 lining-nums">
      <div className="mx-auto max-w-5xl px-4 pt-4 sm:px-6 sm:pt-8">
        <AdminLink href="/admin/receiving" className={`mb-1 inline-flex min-h-11 items-center rounded text-sm font-semibold text-primary hover:underline ${focusRing}`}>
          ← Receiving
        </AdminLink>
        {children}
      </div>
    </div>
  );
}

export default async function PackPage({ params }: { params: Promise<{ code: string }> }) {
  await requireAdmin();
  const { code } = await params;
  const loaded = await loadPack(createAdminClient(), code);
  if (!loaded.ok) {
    if (loaded.status === 404) notFound();
    return (
      <Shell>
        <p role="alert" className="mt-2 rounded-xl border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-800 break-words">
          Couldn&apos;t load this bag: {loaded.error}
        </p>
      </Shell>
    );
  }
  return (
    <Shell>
      <PackBoard initial={loaded.packing} extras={loaded.extras} />
    </Shell>
  );
}
