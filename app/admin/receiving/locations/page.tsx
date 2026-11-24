import type { Metadata } from "next";
import { ScanLine } from "lucide-react";
import { requireAdmin } from "@/lib/admin-auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { AdminLink } from "@/components/admin-ui/admin-link";
import { nyToday } from "@/lib/intake/business-days";
import { stationRank } from "../shelf/_lib/places";
import { loadPlaces, type PlaceWithCount } from "./load-places";
import { AddPlaceForm, NextShelfSignsPrint, PlaceItem, StationSignsPrint, type PlaceItemData } from "./places-client";

/**
 * Places: every spot a card can be (one station per step, a shelf slot per
 * due date, the Done shelf, Shipping, anything else), with how many cards
 * are there, each place's sign to print once, and the batch sign prints.
 * Scanning a place's sign and then cards (the Scan page) moves them there.
 */

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Places | Receiving", robots: { index: false } };

const TRACKING_NOTICE =
  "The card tracking database update (supabase/migrations/20261124_card_tracking.sql) isn't applied yet, so places can't be shown or added.";

const focusRing = "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary";
const linkButton = `inline-flex items-center gap-1.5 min-h-11 px-4 rounded-lg border border-border bg-white text-sm font-bold hover:border-primary/40 ${focusRing}`;

function shelfNote(day: string | null, today: string): string | null {
  if (!day) return null;
  if (day < today) return "Past due date";
  if (day === today) return "Due today";
  return null;
}

function toItem(p: PlaceWithCount, today: string): PlaceItemData {
  return {
    id: p.id,
    code: p.code,
    name: p.name,
    kind: p.kind,
    stage: p.stage,
    dueDate: p.due_date,
    active: p.active,
    cardCount: p.cardCount,
    note: p.kind === "shelf" ? shelfNote(p.due_date, today) : null,
    shelfHref: p.kind === "shelf" && p.due_date ? `/admin/receiving/shelf#due-${p.due_date}` : null,
  };
}

function Section({ id, title, hint, places, today, empty }: { id: string; title: string; hint: string; places: PlaceWithCount[]; today: string; empty?: string }) {
  const cards = places.reduce((n, p) => n + p.cardCount, 0);
  return (
    <section aria-labelledby={id}>
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 mb-1">
        <h2 id={id} className="font-heading font-black text-lg text-foreground">
          {title} <span className="text-muted-foreground font-medium text-sm">({places.length})</span>
        </h2>
        {cards > 0 && <p className="text-sm text-muted-foreground">{cards} card{cards === 1 ? "" : "s"} here</p>}
      </div>
      <p className="text-xs text-muted-foreground mb-2">{hint}</p>
      {places.length === 0 ? (
        <p className="bg-white rounded-xl border border-border p-5 text-sm text-muted-foreground">{empty ?? "None yet."}</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {places.map((p) => <PlaceItem key={p.id} place={toItem(p, today)} />)}
        </ul>
      )}
    </section>
  );
}

export default async function PlacesPage() {
  await requireAdmin();
  const today = nyToday();
  const result = await loadPlaces(createAdminClient());
  const all = result.ok ? result.places : [];
  const active = all.filter((p) => p.active);
  const byName = (a: PlaceWithCount, b: PlaceWithCount) => (a.sort ?? 0) - (b.sort ?? 0) || a.name.localeCompare(b.name);

  const stations = active.filter((p) => p.kind === "station").sort((a, b) => stationRank(a) - stationRank(b) || byName(a, b));
  const shelves = active.filter((p) => p.kind === "shelf")
    .sort((a, b) => (a.due_date ?? "9999").localeCompare(b.due_date ?? "9999") || byName(a, b));
  // Past slots with nothing on them fold away (one is made per due date, so they pile up)
  const currentShelves = shelves.filter((p) => p.cardCount > 0 || !p.due_date || p.due_date >= today);
  const oldShelves = shelves.filter((p) => !currentShelves.includes(p));
  const done = active.filter((p) => p.kind === "done").sort(byName);
  const shipping = active.filter((p) => p.kind === "shipping").sort(byName);
  const other = active.filter((p) => !["station", "shelf", "done", "shipping"].includes(p.kind)).sort(byName);
  const off = all.filter((p) => !p.active).sort((a, b) => a.kind.localeCompare(b.kind) || byName(a, b));

  return (
    <div className="min-h-screen bg-secondary/30">
      <div className="max-w-5xl mx-auto px-4 sm:px-6 py-6 sm:py-10">
        <AdminLink href="/admin/receiving" className={`inline-flex items-center min-h-11 text-sm font-semibold text-primary hover:underline rounded ${focusRing}`}>
          ← Receiving
        </AdminLink>
        <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
          <div className="max-w-3xl">
            <h1 className="font-heading font-black text-3xl text-foreground">Places</h1>
            <p className="text-sm text-muted-foreground mt-1">
              Every place a card can be: a station for each step, a shelf slot for each due date, the Done shelf and Shipping. Print each sign once and stick it up. On the Scan page, scan a sign, then the cards: they move there (a station also sets their step).
            </p>
          </div>
          <nav className="flex flex-wrap gap-2" aria-label="Tracking">
            <AdminLink href="/admin/scan" className={linkButton}>
              <ScanLine aria-hidden className="size-4" strokeWidth={1.75} />
              Scan
            </AdminLink>
            <AdminLink href="/admin/receiving/shelf" className={linkButton}>Shelf</AdminLink>
          </nav>
        </div>

        {!result.ok && (
          <p role={result.missingSchema ? "status" : "alert"} className={`mb-5 rounded-xl border px-4 py-3 text-sm ${result.missingSchema ? "border-amber-300 bg-amber-50 text-amber-800" : "border-red-300 bg-red-50 text-red-700"}`}>
            {result.missingSchema ? TRACKING_NOTICE : `Couldn't load the places: ${result.error}`}
          </p>
        )}

        {result.ok && (
          <div className="flex flex-col gap-8">
            <section aria-labelledby="signs-h" className="bg-white rounded-xl border border-border p-4 sm:p-5">
              <h2 id="signs-h" className="font-heading font-black text-lg text-foreground">Print signs</h2>
              <p className="text-sm text-muted-foreground mt-0.5 mb-3">
                50 × 80 mm, one sign per label. A tap gets them ready, a second tap prints.
              </p>
              <div className="flex flex-wrap gap-2">
                <StationSignsPrint placeIds={stations.map((p) => p.id)} />
                <NextShelfSignsPrint />
              </div>
            </section>

            <details className="group bg-white rounded-xl border border-border p-4 sm:p-5">
              <summary className={`cursor-pointer list-none min-h-11 flex items-center justify-between gap-2 font-heading font-black text-lg text-foreground rounded ${focusRing}`}>
                Add a place
                <span aria-hidden className="text-sm font-bold text-primary group-open:hidden">Open</span>
                <span aria-hidden className="text-sm font-bold text-primary hidden group-open:inline">Close</span>
              </summary>
              <div className="mt-3">
                <AddPlaceForm />
              </div>
            </details>

            <Section id="stations-h" title="Stations" hint="One per step, in step order. Scanning cards into a station also sets their step." places={stations} today={today} />
            <div>
              <Section
                id="shelves-h"
                title="Shelf slots by due date"
                hint="Each due date gets its own slot when cards are received; bags wait there between steps."
                places={currentShelves}
                today={today}
                empty="No shelf slots yet. Receiving cards makes the slot for their due date."
              />
              {oldShelves.length > 0 && (
                <details className="mt-2">
                  <summary className={`cursor-pointer min-h-11 inline-flex items-center text-sm font-bold text-primary rounded ${focusRing}`}>
                    Past empty slots ({oldShelves.length})
                  </summary>
                  <ul className="mt-2 flex flex-col gap-2">
                    {oldShelves.map((p) => <PlaceItem key={p.id} place={toItem(p, today)} />)}
                  </ul>
                </details>
              )}
            </div>
            <Section id="done-h" title="Done" hint="Finished cards wait here. Scanning cards here marks them done." places={done} today={today} />
            <Section id="shipping-h" title="Shipping" hint="Where orders are checked before they ship." places={shipping} today={today} />
            {other.length > 0 && <Section id="other-h" title="Other places" hint="Anywhere else a card can be." places={other} today={today} />}
            {off.length > 0 && (
              <details>
                <summary className={`cursor-pointer min-h-11 inline-flex items-center font-heading font-black text-lg text-foreground rounded ${focusRing}`}>
                  Turned off ({off.length})
                </summary>
                <ul className="mt-2 flex flex-col gap-2">
                  {off.map((p) => <PlaceItem key={p.id} place={toItem(p, today)} />)}
                </ul>
              </details>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
