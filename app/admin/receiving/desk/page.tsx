import type { Metadata } from "next";
import { MapPin, ScanLine } from "lucide-react";
import { requireAdminOrWorkshop, staffName } from "@/lib/admin-auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { AdminLink } from "@/components/admin-ui/admin-link";
import { normalizeCode, scanPathForLocation } from "@/lib/intake/codes";
import { DESK_CODE, deskPagePath, deskPlaces, ensureDesk, loadDeskCards, pickDesk, type DeskPlace } from "@/lib/intake/tracking/desk";
import { ShelfSignButton } from "../shelf/_components/print-buttons";
import { missingTracking } from "../shelf/_lib/places";
import { DeskBoard } from "./_components/desk-board";
import { deskPanelCard, workshopDeskCard, type DeskPanelCard } from "./_lib/view";

/**
 * The Desk (menu "Desk"): every card on a desk, one panel each, so a stack
 * that came off a holder (scan HEAT PRESS 01, Move, scan DESK) can be gone
 * through card by card: photos, what the card is, whose order, the
 * customer's notes, and where it goes next. One desk at a time
 * (?desk=<code>, a picker when there are several: LOC-DESK, LOC-DESK-<NAME>).
 * When there is no desk at all, LOC-DESK "DESK" is made here (one small,
 * idempotent insert). Full admins and workshop logins
 * (lib/workshop-access.ts); reads only otherwise, and every
 * action goes through the tracking API (app/api/admin/track/**).
 */

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Desk | Receiving", robots: { index: false } };

type Params = Record<string, string | string[] | undefined>;
const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";
const errText = (e: unknown) => (e instanceof Error ? e.message : String(e));

const focusRing = "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary";
const primaryButton = `inline-flex items-center justify-center gap-1.5 min-h-11 px-4 rounded-lg bg-primary text-primary-foreground text-sm font-bold hover:bg-primary/90 ${focusRing}`;
const secondaryButton = `inline-flex items-center justify-center gap-1.5 min-h-11 px-4 rounded-lg border border-border bg-white text-sm font-bold text-foreground hover:border-primary/40 ${focusRing}`;

type Loaded =
  | {
      ok: true;
      desks: DeskPlace[];
      desk: DeskPlace | null;
      cards: DeskPanelCard[];
      /** This visit made the first desk. */
      made: boolean;
      makeError: string | null;
      /** A ?desk= code that isn't a desk. */
      unknown: string | null;
      now: number;
    }
  | { ok: false; missing: boolean; error: string };

async function loadDesk(requested: string): Promise<Loaded> {
  const admin = createAdminClient();
  try {
    let desks = await deskPlaces(admin);
    let made = false;
    let makeError: string | null = null;
    if (!desks.length) {
      try {
        const { location, created } = await ensureDesk(admin, await staffName());
        made = created;
        // Not read again with deskPlaces(): Next.js memoizes identical GET fetches within one
        // render, so a second read answers the empty list from before the insert.
        if (location.kind === "other") desks = [{ ...location, cardCount: 0 }];
        // LOC-DESK is taken by a place that isn't an 'other' place (so not a desk)
        else makeError = `${DESK_CODE} is taken by a place that isn't a desk`;
      } catch (e) {
        makeError = errText(e);
      }
    }
    const desk = pickDesk(desks, requested);
    const cards = desk ? (await loadDeskCards(admin, desk.id)).map(deskPanelCard) : [];
    return { ok: true, desks, desk, cards, made, makeError, unknown: requested && desk?.code !== requested ? requested : null, now: Date.now() };
  } catch (e) {
    const error = errText(e);
    return { ok: false, missing: missingTracking(error), error };
  }
}

function Notice({ tone, children }: { tone: "green" | "amber" | "red"; children: React.ReactNode }) {
  const cls = tone === "green" ? "border-green-300 bg-green-50 text-green-950" : tone === "amber" ? "border-amber-300 bg-amber-50 text-amber-950" : "border-red-300 bg-red-50 text-red-800";
  return <div role={tone === "red" ? "alert" : "status"} className={`mb-4 rounded-xl border px-4 py-3 text-sm break-words ${cls}`}>{children}</div>;
}

// `places`: false for workshop logins, who don't get Places (lib/workshop-access.ts)
function SignButtons({ desk, places }: { desk: DeskPlace; places: boolean }) {
  return (
    <>
      <ShelfSignButton placeId={desk.id} code={desk.code} name={desk.name} />
      {places && (
        <AdminLink href="/admin/receiving/locations" className={secondaryButton}>
          <MapPin aria-hidden className="size-4" strokeWidth={1.75} />
          Places
        </AdminLink>
      )}
    </>
  );
}

function EmptyDesk({ desk, places }: { desk: DeskPlace; places: boolean }) {
  return (
    <div className="rounded-2xl border border-border bg-white p-5 sm:p-6">
      <p className="font-heading text-xl font-black text-foreground">Nothing on {desk.name}</p>
      <p className="mt-1 text-sm text-muted-foreground">Cards show up here as soon as they&apos;re put on the desk.</p>
      <ul className="mt-3 list-disc space-y-1.5 pl-5 text-sm text-foreground">
        <li><span className="font-bold">A whole stack:</span> on Scan, scan the holder (say HEAT PRESS 01), tap Move, then scan the {desk.name} sign. Every card in it comes here.</li>
        <li><span className="font-bold">One card:</span> scan the {desk.name} sign, then the card&apos;s bag, and tap the card.</li>
        <li><span className="font-bold">No sign yet?</span> {places ? "Print it below, or on Places." : "Print it below."} Stick it on the desk.</li>
      </ul>
      <div className="mt-4 flex flex-wrap gap-2">
        <AdminLink href={scanPathForLocation(desk.code)} className={primaryButton}>
          <ScanLine aria-hidden className="size-4" strokeWidth={1.75} />
          Scan cards onto {desk.name}
        </AdminLink>
        <SignButtons desk={desk} places={places} />
      </div>
    </div>
  );
}

export default async function DeskPage({ searchParams }: { searchParams: Promise<Params> }) {
  const role = await requireAdminOrWorkshop();
  const workshop = role === "workshop";
  const requested = normalizeCode(first((await searchParams).desk));
  const loaded = await loadDesk(requested);
  // Workshop logins: no declared values and no order page links (lib/workshop-access.ts)
  const result = loaded.ok && workshop ? { ...loaded, cards: loaded.cards.map(workshopDeskCard) } : loaded;
  const desk = result.ok ? result.desk : null;

  return (
    <div className="min-h-screen bg-secondary/30 pb-4 lining-nums sm:pb-6">
      <div className="mx-auto max-w-7xl px-4 pt-4 sm:px-6 sm:pt-8">
        <AdminLink href="/admin/receiving" className={`inline-flex items-center min-h-11 text-sm font-semibold text-primary hover:underline rounded ${focusRing}`}>
          ← Receiving
        </AdminLink>
        <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
          <div className="min-w-0 max-w-3xl">
            <h1 className="font-heading text-3xl font-black text-foreground break-words sm:text-4xl">{desk?.name ?? "Desk"}</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              The cards on {desk ? "this desk" : "your desk"}, with their photos, their order and the customer&apos;s notes. Put each one in a holder, mark it done{workshop ? "" : ", or open its order"}.
            </p>
          </div>
          <nav className="flex flex-wrap gap-2" aria-label="Desk">
            <AdminLink href="/admin/scan" className={primaryButton}>
              <ScanLine aria-hidden className="size-4" strokeWidth={1.75} />
              Scan
            </AdminLink>
            {desk && <SignButtons desk={desk} places={!workshop} />}
          </nav>
        </div>

        {!result.ok && (
          <Notice tone={result.missing ? "amber" : "red"}>
            {result.missing
              ? "The card tracking update (supabase/migrations/20261124_card_tracking.sql) isn't applied yet, so there are no desks or holders."
              : `Couldn't load the desk: ${result.error}`}
          </Notice>
        )}

        {result.ok && result.desks.length > 1 && (
          <nav aria-label="Desks" className="mb-4 flex flex-wrap gap-2">
            {result.desks.map((d) => {
              const current = d.id === desk?.id;
              return (
                <AdminLink
                  key={d.id}
                  href={deskPagePath(d.code)}
                  aria-current={current ? "page" : undefined}
                  className={`inline-flex items-center gap-1.5 min-h-11 px-3.5 rounded-full border text-sm font-bold transition-colors ${focusRing} ${current ? "bg-primary text-primary-foreground border-primary" : "bg-white border-border text-foreground hover:border-primary/40"}`}
                >
                  {d.name}
                  <span className={`min-w-6 px-1.5 py-0.5 rounded-full text-xs font-black tabular-nums text-center ${current ? "bg-white/20" : "bg-secondary"}`}>{d.cardCount}</span>
                  {!d.active && <span className="text-xs font-semibold opacity-80">off</span>}
                </AdminLink>
              );
            })}
          </nav>
        )}

        {result.ok && result.made && desk && (
          <Notice tone="green">
            <p className="font-bold">Your desk is ready: {desk.name}.</p>
            <p className="mt-0.5">Print its sign and stick it on the desk. Scan it on the Scan page to put cards here. Need another desk? Add one on Places (Add a desk).</p>
          </Notice>
        )}
        {result.ok && result.makeError && (
          <Notice tone="red">Couldn&apos;t make the desk: {result.makeError}. Add a desk on the Places page.</Notice>
        )}
        {result.ok && result.unknown && desk && (
          <Notice tone="amber">No desk has the code {result.unknown}. Showing {desk.name}.</Notice>
        )}
        {desk && !desk.active && (
          <Notice tone="amber">{desk.name} is switched off, so no cards can be put on it. Turn it back on in Places.</Notice>
        )}
      </div>

      {result.ok && desk && (
        <div className="mx-auto max-w-7xl px-4 sm:px-6">
          <DeskBoard
            desk={{ id: desk.id, code: desk.code, name: desk.name }}
            cards={result.cards}
            serverNow={result.now}
            empty={<EmptyDesk desk={desk} places={!workshop} />}
          />
        </div>
      )}
    </div>
  );
}
