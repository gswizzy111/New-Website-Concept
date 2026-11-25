import { AdminLink } from "@/components/admin-ui/admin-link";

/**
 * A code the scan landing can't open (not a Bag ID or order number, or one
 * nothing has): the same plain words as the /q route's "not found"
 * (app/q/[code]/route.ts).
 */
export default function OpenCodeNotFound() {
  return (
    <div className="min-h-screen bg-secondary/30 px-4 py-10 sm:px-6">
      <div className="mx-auto max-w-sm rounded-2xl border border-border bg-white p-6">
        <h1 className="font-heading text-2xl font-black text-foreground">Code not found</h1>
        <p className="mt-2 text-[15px] leading-relaxed text-muted-foreground">
          This QR code doesn&apos;t match an order, a card, a bag or a place. The label may be from a deleted bag, or the code was mistyped.
        </p>
        <AdminLink
          href="/admin/receiving"
          className="mt-5 flex min-h-11 items-center justify-center rounded-xl bg-primary px-4 text-[15px] font-bold text-primary-foreground hover:bg-primary/90 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
        >
          Open Receiving
        </AdminLink>
      </div>
    </div>
  );
}
