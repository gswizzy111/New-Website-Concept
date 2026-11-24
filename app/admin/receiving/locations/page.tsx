import type { Metadata } from "next";
import { ScanLine } from "lucide-react";
import { requireAdmin } from "@/lib/admin-auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { AdminLink } from "@/components/admin-ui/admin-link";
import { nyToday } from "@/lib/intake/business-days";
import { stationName } from "@/lib/intake/tracking/stations";
import { shortDay } from "../bags/_components/bag-bits";
import { STATION_TYPES, stageRank, stepText, type StationType } from "../shelf/_lib/places";
import { loadPlaces, type PlaceWithCards } from "./load-places";
import {
  AddPlaceForm, AddSlotsForm, NextShelfSignsPrint, PlaceItem, SlotTile, StationRangePrint,
  type PlaceItemData, type SlotTileData,
} from "./places-client";

/**
 * Places: every serial-numbered slot (CLAMP 07, HEAT PRESS 03...) grouped by
 * station type with who's in it, the due-date shelf slots, the Done shelf,
 * Shipping and anything else. Add slots in bulk, print their QR labels (one,
 * or a serial range), rename and turn off. On the Scan page, scanning a slot
 * then a bag's label puts a card in it (the card's step follows the slot).
 */

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Places | Receiving", robots: { index: false } };

const TRACKING_NOTICE =
  "The card tracking database update (supabase/migrations/20261124_card_tracking.sql) isn't applied yet, so places can't be shown or added.";

const focusRing = "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary";
const linkButton = `inline-flex items-center gap-1.5 min-h-11 px-4 rounded-lg border border-border bg-white text-sm font-bold hover:border-primary/40 ${focusRing}`;

/** The station type a slot belongs to (its key; a place made before slot types by its step). */
function typeKey(p: PlaceWithCards): string {
  return p.station ?? STATION_TYPES.find((t) => t.stage === p.stage)?.key ?? `step:${p.stage ?? "none"}`;
}

function shelfNote(day: string | null, today: string): string | null {
  if (!day) return null;
  if (day < today) return "Past due date";
  if (day === today) return "Due today";
  return null;
}

function toItem(p: PlaceWithCards, today: string): PlaceItemData {
  return {
    id: p.id,
    code: p.code,
    name: p.name,
    kind: p.kind,
    stage: p.stage,
    active: p.active,
    cardCount: p.cards.length,
    note: p.kind === "shelf" ? shelfNote(p.due_date, today) : null,
    shelfHref: p.kind === "shelf" && p.due_date ? `/admin/receiving/shelf#due-${p.due_date}` : null,
  };
}

function toTile(p: PlaceWithCards, today: string): SlotTileData {
  return {
    id: p.id,
    code: p.code,
    name: p.name,
    active: p.active,
    capacity: p.capacity,
    cards: p.cards.map((c) => ({
      id: c.id,
      code: c.code,
      name: c.name,
      customer: c.customer,
      dueText: c.dueDate ? `Due ${shortDay(c.dueDate, today)}` : null,
    })),
  };
}

function PlaceList({ id, title, hint, places, today, empty, action }: {
  id: string; title: string; hint: string; places: PlaceWithCards[]; today: string; empty?: string; action?: React.ReactNode;
}) {
  const cards = places.reduce((n, p) => n + p.cards.length, 0);
  return (
    <section aria-labelledby={id}>
      <div className="flex flex-wrap items-end justify-between gap-x-3 gap-y-2 mb-2">
        <div>
          <h2 id={id} className="font-heading font-black text-lg text-foreground">
            {title} <span className="text-muted-foreground font-medium text-sm">({places.length}{cards ? ` · ${cards} card${cards === 1 ? "" : "s"}` : ""})</span>
          </h2>
          <p className="text-xs text-muted-foreground">{hint}</p>
        </div>
        {action}
      </div>
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
  const byName = (a: PlaceWithCards, b: PlaceWithCards) => (a.sort ?? 0) - (b.sort ?? 0) || a.name.localeCompare(b.name);

  // Station slots by type, types in step order (the known ones first), slots by serial
  const slots = active.filter((p) => p.kind === "station");
  const types: StationType[] = [...STATION_TYPES];
  for (const p of slots) {
    const key = typeKey(p);
    if (!types.some((t) => t.key === key)) {
      types.push({ key, name: stationName(p.station) ?? (stepText(p.stage) || "Station"), stage: p.stage ?? "", defaultCapacity: p.capacity });
    }
  }
  types.sort((a, b) => stageRank(a.stage) - stageRank(b.stage));
  const groups = types.map((t) => ({
    type: t,
    slots: slots.filter((p) => typeKey(p) === t.key)
      .sort((a, b) => (a.serial ?? Number.MAX_SAFE_INTEGER) - (b.serial ?? Number.MAX_SAFE_INTEGER) || byName(a, b)),
  }));
  const withSlots = groups.filter((g) => g.slots.length);
  const noSlots = groups.filter((g) => !g.slots.length && STATION_TYPES.some((t) => t.key === g.type.key));
  // Serials continue after the highest one used (turned-off slots keep theirs)
  const nextSerial: Record<string, number> = {};
  for (const p of all.filter((x) => x.kind === "station" && x.serial != null)) {
    const key = typeKey(p);
    nextSerial[key] = Math.max(nextSerial[key] ?? 1, (p.serial as number) + 1);
  }
  const slotCount = slots.length;
  const inUse = slots.filter((p) => p.cards.length).length;

  const shelves = active.filter((p) => p.kind === "shelf")
    .sort((a, b) => (a.due_date ?? "9999").localeCompare(b.due_date ?? "9999") || byName(a, b));
  // Past slots with nothing on them fold away (one is made per due date, so they pile up)
  const currentShelves = shelves.filter((p) => p.cards.length > 0 || !p.due_date || p.due_date >= today);
  const oldShelves = shelves.filter((p) => !currentShelves.includes(p));
  const done = active.filter((p) => p.kind === "done").sort(byName);
  const shipping = active.filter((p) => p.kind === "shipping").sort(byName);
  const other = active.filter((p) => !["station", "shelf", "done", "shipping"].includes(p.kind)).sort(byName);
  const off = all.filter((p) => !p.active).sort((a, b) => a.kind.localeCompare(b.kind) || byName(a, b));

  return (
    <div className="min-h-screen bg-secondary/30">
      <div className="max-w-6xl mx-auto px-4 sm:px-6 py-6 sm:py-10">
        <AdminLink href="/admin/receiving" className={`inline-flex items-center min-h-11 text-sm font-semibold text-primary hover:underline rounded ${focusRing}`}>
          ← Receiving
        </AdminLink>
        <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
          <div className="max-w-3xl">
            <h1 className="font-heading font-black text-3xl text-foreground">Places</h1>
            <p className="text-sm text-muted-foreground mt-1">
              Every clamp, press spot and humidor spot is a numbered slot with its own QR label. On the Scan page, scan a slot, then the bag&apos;s label, and tap the card: it&apos;s in that slot and at that step. Bags wait on the shelf of their due date.
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
            <section aria-labelledby="add-h" className="bg-white rounded-xl border border-border p-4 sm:p-5">
              <h2 id="add-h" className="font-heading font-black text-lg text-foreground mb-3">Add slots</h2>
              <AddSlotsForm types={STATION_TYPES} nextSerial={nextSerial} />
              <details className="group mt-4 border-t border-border pt-3">
                <summary className={`cursor-pointer list-none min-h-11 inline-flex items-center gap-2 text-sm font-bold text-primary rounded ${focusRing}`}>
                  <span className="group-open:hidden">Add another kind of place</span>
                  <span className="hidden group-open:inline">Close</span>
                </summary>
                <div className="mt-3">
                  <AddPlaceForm />
                </div>
              </details>
            </section>

            <section aria-labelledby="slots-h" className="flex flex-col gap-5">
              <div>
                <h2 id="slots-h" className="font-heading font-black text-xl text-foreground">
                  Station slots <span className="text-muted-foreground font-medium text-sm">({slotCount} · {inUse} in use)</span>
                </h2>
                <p className="text-xs text-muted-foreground">By station, in step order. Print each slot&apos;s label once and stick it on the slot.</p>
              </div>
              {withSlots.length === 0 && (
                <p className="bg-white rounded-xl border border-border p-5 text-sm text-muted-foreground">No slots yet. Add them above, for example 20 clamps.</p>
              )}
              {withSlots.map(({ type, slots: list }) => {
                const used = list.filter((p) => p.cards.length).length;
                const serials = list.map((p) => p.serial).filter((s): s is number => s != null);
                return (
                  <section key={type.key} aria-labelledby={`type-${type.key}`} className="rounded-xl bg-white/60 border border-border p-3 sm:p-4">
                    <div className="flex flex-wrap items-end justify-between gap-3 mb-3">
                      <div>
                        <h3 id={`type-${type.key}`} className="font-heading font-black text-lg text-foreground">{type.name}</h3>
                        <p className="text-xs text-muted-foreground">
                          {[stepText(type.stage), `${list.length} slot${list.length === 1 ? "" : "s"}`, `${used} in use`, `${list.length - used} empty`].filter(Boolean).join(" · ")}
                        </p>
                      </div>
                      <StationRangePrint
                        station={type.key}
                        name={type.name.toLowerCase()}
                        min={serials.length === list.length ? Math.min(...serials) : null}
                        max={serials.length === list.length ? Math.max(...serials) : null}
                        ids={list.map((p) => p.id)}
                      />
                    </div>
                    <ul className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-2">
                      {list.map((p) => <SlotTile key={p.id} slot={toTile(p, today)} />)}
                    </ul>
                  </section>
                );
              })}
              {noSlots.length > 0 && (
                <p className="text-sm text-muted-foreground">
                  No slots yet: {noSlots.map((g) => g.type.name).join(", ")}.
                </p>
              )}
            </section>

            <div>
              <PlaceList
                id="shelves-h"
                title="Shelf slots by due date"
                hint="Each due date gets its own shelf when cards are received; bags wait there between steps."
                places={currentShelves}
                today={today}
                empty="No shelf slots yet. Receiving cards makes the shelf for their due date."
                action={<NextShelfSignsPrint />}
              />
              {oldShelves.length > 0 && (
                <details className="mt-2">
                  <summary className={`cursor-pointer min-h-11 inline-flex items-center text-sm font-bold text-primary rounded ${focusRing}`}>
                    Past empty shelf slots ({oldShelves.length})
                  </summary>
                  <ul className="mt-2 flex flex-col gap-2">
                    {oldShelves.map((p) => <PlaceItem key={p.id} place={toItem(p, today)} />)}
                  </ul>
                </details>
              )}
            </div>
            <PlaceList id="done-h" title="Done" hint="Finished cards wait here." places={done} today={today} />
            <PlaceList id="shipping-h" title="Shipping" hint="Where orders are checked before they ship." places={shipping} today={today} />
            {other.length > 0 && <PlaceList id="other-h" title="Other places" hint="Anywhere else a card can be." places={other} today={today} />}
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
