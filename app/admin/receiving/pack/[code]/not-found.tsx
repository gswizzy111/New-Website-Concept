import { AdminLink } from "@/components/admin-ui/admin-link";

/** A code the packing page can't open: not a Bag ID, or a bag nothing has. */
export default function PackNotFound() {
  return (
    <div className="min-h-screen bg-secondary/30 px-4 py-10 sm:px-6">
      <div className="mx-auto max-w-sm rounded-2xl border border-border bg-white p-6">
        <h1 className="font-heading text-2xl font-black text-foreground">Bag not found</h1>
        <p className="mt-2 text-[15px] leading-relaxed text-muted-foreground">
          This isn&apos;t a Bag ID we have (a Bag ID looks like CD-2549-P). The bag may have been deleted, or the code was mistyped.
        </p>
        <AdminLink
          href="/admin/ship-queue?tab=restoration"
          className="mt-5 flex min-h-11 items-center justify-center rounded-xl bg-primary px-4 text-[15px] font-bold text-primary-foreground hover:bg-primary/90 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
        >
          Open the ship queue
        </AdminLink>
      </div>
    </div>
  );
}
