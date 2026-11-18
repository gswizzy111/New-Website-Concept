import Link from "next/link";
import { requireAdmin } from "@/lib/admin-auth";
import { readCatalogStatus, type CatalogLangStatus } from "@/lib/card-catalog-sync";
import { CatalogSync } from "./catalog-sync";
import { CatalogTry } from "./catalog-try";

export const dynamic = "force-dynamic";

// The card catalog behind the card picker on the admin card forms
// (lib/card-catalog.ts): how full it is, and "Sync now". Reads only
// card_catalog_sync (a few hundred small rows), never the catalog itself.
export default async function CardCatalogPage() {
  await requireAdmin();

  let status: CatalogLangStatus[] | null = null;
  try {
    status = await readCatalogStatus();
  } catch (err) {
    console.error("[admin/card-catalog]", err instanceof Error ? err.message : err);
  }

  return (
    <div className="min-h-screen bg-secondary/30">
      <div className="max-w-5xl mx-auto px-6 py-10 flex flex-col gap-6">
        <div>
          <Link href="/admin" className="text-sm text-muted-foreground hover:text-primary mb-2 block">← Orders</Link>
          <h1 className="font-heading font-black text-3xl text-foreground">Card Catalog</h1>
          <p className="text-muted-foreground text-sm mt-1 max-w-2xl">
            English and Japanese Pokémon cards and their pictures, from TCGdex (an open card database). When you add
            or edit a card, type in the card name box and pick the exact card: its name, set, year and number fill in,
            and its picture is kept as a reference photo. It keeps itself up to date; new sets show up within about 6 hours.
          </p>
        </div>

        {status ? (
          <CatalogSync initial={status} />
        ) : (
          <div className="bg-white rounded-xl border border-amber-200 p-6 text-sm text-amber-800">
            The card catalog isn&apos;t set up yet: its database tables are missing (supabase/migrations/20261118_card_catalog.sql).
          </div>
        )}

        <CatalogTry />
      </div>
    </div>
  );
}
