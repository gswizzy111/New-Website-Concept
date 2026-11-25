import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { ExternalLink, Images, Package } from "lucide-react";
import { requireAdmin, staffName } from "@/lib/admin-auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { AdminLink } from "@/components/admin-ui/admin-link";
import { nyToday } from "@/lib/intake/business-days";
import { TierBadge } from "../../bags/_components/bag-bits";
import { missingTracking } from "../../shelf/_lib/places";
import { OpenBoard } from "./_components/open-board";
import { loadDeskChoice, loadOpen } from "./_lib/load";
import { buildOpenView, type OpenBagLine, type OpenHeader } from "./_lib/view";

/**
 * Where a bag QR (CD-2549-P) or an order QR (CD-2549) opens: /q/<code>
 * redirects here (codeTargetPath in lib/intake/codes.ts), so labels already
 * printed land here too. Made for a phone in one hand (owner, Nov 25 2026:
 * "a page that is very simple ... see the persons order ... move the card to
 * my desk"): the customer's name big, the order, the bag's tier and due date,
 * the customer's notes; ONE big "Move all N cards to my desk"; then each
 * card with its photos, where it is now and its own "Move to my desk" and
 * "Done". The header counts "3 of 4 done" and says where the bag is ("Bag:
 * Open bags box · R"); a finished bag gets one big step, "Bag finished: put
 * it in the Ready to ship bin" (the done flow, owner Nov 25 2026). Nothing
 * else: steps, due dates and labels are on their own pages (the photos page
 * stays one tap away, "All photos").
 *
 * Full admins only. Reads only, except making the first desk (LOC-DESK)
 * when there is none, as the Desk page does. Moves, Done and Ready to ship go
 * through the tracking API (POST /api/admin/track/assign, done, bag-ready).
 */

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Order | Receiving", robots: { index: false } };

const focusRing = "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary";
const smallLink = `inline-flex min-h-11 items-center gap-1.5 rounded-lg px-1 text-sm font-bold text-primary hover:underline ${focusRing}`;

function Due({ due }: { due: OpenBagLine["due"] }) {
  return (
    <span className={due.overdue ? "text-red-700" : undefined}>
      {due.text}
      {due.overdue && <span className="ml-2 inline-block rounded-full bg-red-600 px-2 py-0.5 align-middle font-sans text-xs font-bold text-white">Overdue</span>}
    </span>
  );
}

/**
 * The person, in two parts so the big button stays on a phone's first screen
 * whatever the order holds: who and what (name, order, bag, due date, card
 * count), then, under the button, the order's bags, the customer's notes and
 * the links. On a computer the two parts read as one card beside the button.
 */
function PersonTop({ header }: { header: OpenHeader }) {
  const { bag } = header;
  return (
    <section aria-labelledby="open-customer" className="min-w-0 rounded-2xl border border-border bg-white p-4 sm:p-6 lg:rounded-b-none lg:border-b-0 lg:pb-0">
      <h1 id="open-customer" className="font-heading text-5xl font-black leading-[1.02] text-foreground break-words sm:text-6xl">{header.customer}</h1>

      <p className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1.5 text-lg font-bold text-foreground">
        <span className="break-all">{header.orderNumber}</span>
        {bag && (
          <>
            <TierBadge tier={bag.tier} name={bag.tierName} />
            <span className="font-mono text-base font-black break-all">{bag.code}</span>
          </>
        )}
      </p>
      <p className="mt-1 font-heading text-2xl font-black text-foreground">
        {bag && <><Due due={bag.due} /><span aria-hidden="true" className="mx-2 text-muted-foreground">·</span></>}
        {header.countText}
      </p>
      {/* Where the bag is: its due-date shelf, the Open bags box (a card is out), Ready to ship */}
      {bag && (
        <p className="mt-1 flex items-center gap-1.5 text-base font-bold text-foreground">
          <Package className="size-5 shrink-0 text-muted-foreground" strokeWidth={1.75} aria-hidden="true" />
          <span className="break-words">Bag: {bag.place}</span>
        </p>
      )}
    </section>
  );
}

function PersonMore({ header }: { header: OpenHeader }) {
  return (
    <div className="min-w-0 rounded-2xl border border-border bg-white px-4 pb-1 pt-3 sm:px-6 lg:rounded-t-none lg:border-t-0 lg:pt-3">
      {header.bags.length > 0 && (
        <ul aria-label="Bags" className="flex flex-col gap-1.5">
          {header.bags.map((b) => (
            <li key={b.id} className="flex flex-wrap items-center gap-x-2.5 gap-y-1 rounded-xl bg-secondary/50 px-3 py-2 text-sm font-semibold text-foreground">
              <TierBadge tier={b.tier} name={b.tierName} />
              <span className="font-mono font-black break-all">{b.code}</span>
              <Due due={b.due} />
              <span className="text-muted-foreground">{b.countText}</span>
              <span className="basis-full text-foreground sm:basis-auto">Bag: {b.place}</span>
            </li>
          ))}
        </ul>
      )}

      {header.customerNotes && (
        <div className={`${header.bags.length > 0 ? "mt-3" : ""} rounded-xl border-2 border-amber-300 bg-amber-50 px-4 py-3 text-amber-950`}>
          <h2 className="text-xs font-black uppercase tracking-widest">Customer&apos;s notes</h2>
          <p className="mt-1 whitespace-pre-wrap break-words text-base">{header.customerNotes}</p>
        </div>
      )}

      <nav aria-label="More about this order" className={`${header.bags.length > 0 || header.customerNotes ? "mt-2" : ""} flex flex-wrap gap-x-4`}>
        <AdminLink href={header.orderUrl} className={smallLink}>
          <ExternalLink className="size-4" strokeWidth={1.75} aria-hidden="true" />
          Open full order
        </AdminLink>
        <AdminLink href={header.photosUrl} className={smallLink}>
          <Images className="size-4" strokeWidth={1.75} aria-hidden="true" />
          All photos
        </AdminLink>
      </nav>
    </div>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-secondary/30 pb-8 lining-nums">
      <div className="mx-auto max-w-6xl px-4 pt-4 sm:px-6 sm:pt-8">
        <AdminLink href="/admin/receiving" className={`mb-1 inline-flex min-h-11 items-center rounded text-sm font-semibold text-primary hover:underline ${focusRing}`}>
          ← Receiving
        </AdminLink>
        {children}
      </div>
    </div>
  );
}

export default async function OpenCodePage({ params }: { params: Promise<{ code: string }> }) {
  await requireAdmin();
  const { code } = await params;
  const admin = createAdminClient();
  const loaded = await loadOpen(admin, code);
  if (!loaded.ok) {
    if (loaded.status === 404) notFound();
    return (
      <Shell>
        <p role="alert" className="mt-2 rounded-xl border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-800 break-words">
          {missingTracking(loaded.error)
            ? "The card tracking update (supabase/migrations/20261124_card_tracking.sql) isn't applied yet, so this page can't show where the cards are."
            : `Couldn't load this order: ${loaded.error}`}
        </p>
      </Shell>
    );
  }
  // The desk only once the code is known: an unknown code makes nothing
  const desks = await loadDeskChoice(admin, await staffName());
  const view = buildOpenView(loaded.input, nyToday());
  return (
    <Shell>
      <OpenBoard
        person={<PersonTop header={view.header} />}
        personMore={<PersonMore header={view.header} />}
        groups={view.groups}
        bags={view.bags}
        orderStatus={view.orderStatus}
        desks={desks.desks}
        defaultDeskId={desks.defaultId}
        deskProblem={desks.problem}
      />
    </Shell>
  );
}
