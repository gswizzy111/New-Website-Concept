"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Ban, CircleAlert, CircleCheck, LoaderCircle, PackageCheck, PackageX, TriangleAlert, Truck } from "lucide-react";
import { AdminLink } from "@/components/admin-ui/admin-link";
import { readyToShip, shipCounts } from "./rules";
import type { ShipGroup, ShipRow } from "./ship-types";
import { markCardsDone, takeCardsOut } from "./track-client";

/**
 * The ship check list: every card of the order, grouped by bag, with a tick
 * box "in the box" (cards carry no sticker, so packing is checked by eye and
 * ticked here; ticks stay in this browser tab, sessionStorage), "Confirm all
 * present", Mark done (POST /api/admin/track/done) for a card not marked done
 * and Taken out (POST /api/admin/track/release) for a done card still in a
 * slot. "All good: ready to ship" shows once every card is done, out of its
 * slot and ticked. Each save refreshes the page's server data.
 */

const focusRing = "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary";
const isLive = (r: ShipRow) => r.status !== "refunded" && r.status !== "not_received";
const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

function StatusLine({ row, trackPlaces }: { row: ShipRow; trackPlaces: boolean }) {
  const seen = trackPlaces && row.lastSeen ? row.lastSeen : "";
  if (row.status === "ok") {
    return (
      <p className="mt-1.5 flex items-start gap-1.5 text-sm text-green-800">
        <CircleCheck aria-hidden className="size-5 shrink-0" strokeWidth={1.75} />
        <span><span className="font-bold">Done</span>{trackPlaces ? " · not in a slot" : ""}</span>
      </p>
    );
  }
  if (row.status === "not_done") {
    return (
      <div className="mt-1.5 text-sm text-red-800">
        <p className="flex items-start gap-1.5">
          <CircleAlert aria-hidden className="size-5 shrink-0" strokeWidth={1.75} />
          <span><span className="font-bold">Not marked done</span> · Step: {row.stageLabel}</span>
        </p>
        {seen && <p className="ml-6.5 text-xs text-red-900/80">Last seen: {seen}</p>}
      </div>
    );
  }
  if (row.status === "in_slot") {
    return (
      <div className="mt-1.5 text-sm text-amber-900">
        <p className="flex items-start gap-1.5">
          <TriangleAlert aria-hidden className="size-5 shrink-0 text-amber-700" strokeWidth={1.75} />
          <span><span className="font-bold">Still in {row.place?.name ?? "a slot"}</span> · marked done</span>
        </p>
        <p className="ml-6.5 text-xs">Check it isn&apos;t still there. Once it&apos;s out, tap Taken out.{seen ? ` (${seen})` : ""}</p>
      </div>
    );
  }
  if (row.status === "refunded") {
    return (
      <p className="mt-1.5 flex items-start gap-1.5 text-sm text-gray-600">
        <Ban aria-hidden className="size-5 shrink-0" strokeWidth={1.75} />
        <span className="font-bold">Refunded</span>
      </p>
    );
  }
  return (
    <p className="mt-1.5 flex items-start gap-1.5 text-sm text-gray-600">
      <PackageX aria-hidden className="size-5 shrink-0" strokeWidth={1.75} />
      <span><span className="font-bold">Never arrived</span> · still flagged awaiting arrival</span>
    </p>
  );
}

function RowActions({ row, onSaved, orderId, trackPlaces }: { row: ShipRow; onSaved: () => void; orderId: string; trackPlaces: boolean }) {
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [note, setNote] = useState("");
  const label = row.code ?? row.name;

  async function run(action: "done" | "out") {
    setBusy(true);
    setError("");
    const out = action === "done" ? await markCardsDone([row.id]) : await takeCardsOut([row.id]);
    setBusy(false);
    setConfirming(false);
    if (!out.ok) {
      setError(out.error);
      return;
    }
    setNote(out.message || (action === "done" ? `${label} marked done.` : `${label} taken out.`));
    onSaved();
  }

  const button = "min-h-11 px-3.5 rounded-lg text-sm font-bold transition-colors disabled:opacity-50 inline-flex items-center gap-1.5";
  // Cards that never came in through Receiving (older orders), or before the
  // places tables exist: the tracking API can't mark them done, the order page can
  if (row.status === "not_done" && (!row.received || !trackPlaces)) {
    return (
      <div className="mt-2">
        <AdminLink href={`/admin/orders/${orderId}`} className={`${button} border border-border bg-white text-foreground hover:bg-secondary ${focusRing}`}>
          Mark done on the order page →
        </AdminLink>
      </div>
    );
  }
  return (
    <div className="mt-2">
      {row.status === "not_done" && !confirming && (
        <button type="button" onClick={() => setConfirming(true)} disabled={busy} className={`${button} bg-primary text-primary-foreground hover:bg-primary/90 ${focusRing}`}>
          Mark done
        </button>
      )}
      {row.status === "not_done" && confirming && (
        <div className="rounded-lg border border-border bg-secondary/40 p-3">
          <p className="text-sm font-semibold text-foreground">
            Is {label} finished?{row.atFinalDry ? " It's at Final Dry." : ` Its step is ${row.stageLabel}.`}
          </p>
          <div className="mt-2 flex flex-wrap gap-2">
            <button type="button" onClick={() => run("done")} disabled={busy} className={`${button} bg-green-700 text-white hover:bg-green-800 ${focusRing}`}>
              {busy && <LoaderCircle aria-hidden className="size-4 animate-spin motion-reduce:animate-none" strokeWidth={1.75} />}
              Yes, mark done
            </button>
            <button type="button" onClick={() => setConfirming(false)} disabled={busy} className={`${button} border border-border bg-white text-foreground hover:bg-secondary ${focusRing}`}>
              Cancel
            </button>
          </div>
        </div>
      )}
      {row.status === "in_slot" && (
        <button type="button" onClick={() => run("out")} disabled={busy} className={`${button} border border-amber-300 bg-white text-amber-900 hover:bg-amber-50 ${focusRing}`}>
          {busy && <LoaderCircle aria-hidden className="size-4 animate-spin motion-reduce:animate-none" strokeWidth={1.75} />}
          Taken out of {row.place?.name ?? "the slot"}
        </button>
      )}
      {error && <p role="alert" className="mt-1.5 text-sm text-red-700">{error}</p>}
      {note && !error && <p role="status" className="mt-1.5 text-sm text-green-800">{note}</p>}
    </div>
  );
}

function CardRow({ row, ticked, onTick, onSaved, trackPlaces, orderId }: {
  row: ShipRow; ticked: boolean; onTick: (on: boolean) => void; onSaved: () => void; trackPlaces: boolean; orderId: string;
}) {
  const live = isLive(row);
  const tone = row.status === "ok" ? "bg-white" : row.status === "not_done" ? "bg-red-50/60" : row.status === "in_slot" ? "bg-amber-50/70" : "bg-gray-50";
  return (
    <li className={`flex gap-3 px-3 py-3 sm:px-4 border-t border-border first:border-t-0 ${tone}`}>
      {live ? (
        <label className="shrink-0 flex flex-col items-center justify-start gap-0.5 min-w-11 min-h-11 pt-0.5 cursor-pointer select-none">
          <input
            type="checkbox"
            checked={ticked}
            onChange={(e) => onTick(e.target.checked)}
            className="size-6 accent-green-700 cursor-pointer"
            aria-label={`${row.code ?? row.name} is in the box`}
          />
          <span aria-hidden className="text-[10px] font-bold uppercase tracking-wide text-muted-foreground">In box</span>
        </label>
      ) : (
        <span aria-hidden className="shrink-0 min-w-11" />
      )}
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
          {row.code ? (
            <AdminLink href={`/admin/receiving/card/${row.id}`} className={`font-mono font-black text-base text-foreground hover:underline rounded ${focusRing}`}>
              {row.code}
            </AdminLink>
          ) : (
            <span className="text-xs font-bold text-muted-foreground">No Card ID</span>
          )}
          <span className="font-semibold text-foreground break-words [overflow-wrap:anywhere]">{row.name}</span>
        </div>
        {row.detail && <p className="text-xs text-muted-foreground break-words">{row.detail}</p>}
        <StatusLine row={row} trackPlaces={trackPlaces} />
        <RowActions row={row} onSaved={onSaved} orderId={orderId} trackPlaces={trackPlaces} />
      </div>
    </li>
  );
}

export function ShipChecklist({
  orderId,
  groups,
  highlightBagId,
  shippingHref,
  trackPlaces,
}: {
  orderId: string;
  groups: ShipGroup[];
  /** The bag that was scanned (shown first, outlined). */
  highlightBagId: string | null;
  /** The order page's shipping area. */
  shippingHref: string;
  trackPlaces: boolean;
}) {
  const router = useRouter();
  const [refreshing, startTransition] = useTransition();
  const [present, setPresent] = useState<Record<string, boolean>>({});
  const storageKey = `tcd-ship-check:${orderId}`;

  // Ticks survive a reload of this tab (never shared, never saved to the database)
  useEffect(() => {
    try {
      const raw = sessionStorage.getItem(storageKey);
      // eslint-disable-next-line react-hooks/set-state-in-effect -- reading browser storage after hydration
      if (raw) setPresent(JSON.parse(raw) as Record<string, boolean>);
    } catch {
      /* storage blocked: ticks just aren't remembered */
    }
  }, [storageKey]);

  function save(next: Record<string, boolean>) {
    setPresent(next);
    try {
      sessionStorage.setItem(storageKey, JSON.stringify(next));
    } catch {
      /* storage blocked */
    }
  }

  const rows = groups.flatMap((g) => g.rows);
  const live = rows.filter(isLive);
  const counts = shipCounts(rows.map((r) => r.status));
  const tickedCount = live.filter((r) => present[r.id]).length;
  const allTicked = live.length > 0 && tickedCount === live.length;
  const ready = readyToShip(rows, present);
  const ordered = highlightBagId
    ? [...groups].sort((a, b) => Number(b.bag?.id === highlightBagId) - Number(a.bag?.id === highlightBagId))
    : groups;
  const refresh = () => startTransition(() => router.refresh());

  const problems = [
    counts.notDone ? `${plural(counts.notDone, "card")} not marked done` : "",
    counts.inSlot ? `${plural(counts.inSlot, "card")} still in a slot` : "",
  ].filter(Boolean);

  return (
    <div className="flex flex-col gap-4">
      {/* Summary + tick all */}
      <section aria-label="Packing progress" className="rounded-xl border border-border bg-white p-4 sm:p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="font-heading font-black text-xl text-foreground tabular-nums" aria-live="polite">
              {tickedCount} of {live.length} in the box
            </p>
            <p className="text-sm text-muted-foreground mt-0.5">
              {counts.ok} ready
              {counts.notDone ? ` · ${counts.notDone} not marked done` : ""}
              {counts.inSlot ? ` · ${counts.inSlot} still in a slot` : ""}
              {counts.refunded ? ` · ${counts.refunded} refunded` : ""}
              {counts.notReceived ? ` · ${counts.notReceived} never arrived` : ""}
              {refreshing ? " · updating…" : ""}
            </p>
          </div>
          {live.length > 0 && (
            allTicked ? (
              <button type="button" onClick={() => save({})} className={`min-h-11 px-4 rounded-lg border border-border bg-white text-sm font-bold text-foreground hover:bg-secondary transition-colors ${focusRing}`}>
                Clear ticks
              </button>
            ) : (
              <button
                type="button"
                onClick={() => save({ ...present, ...Object.fromEntries(live.map((r) => [r.id, true])) })}
                className={`min-h-11 px-4 rounded-lg bg-primary text-primary-foreground text-sm font-bold hover:bg-primary/90 transition-colors inline-flex items-center gap-1.5 ${focusRing}`}
              >
                <PackageCheck aria-hidden className="size-4" strokeWidth={1.75} />
                Confirm all {live.length} present
              </button>
            )
          )}
        </div>
        <div className="mt-3 h-2 rounded-full bg-secondary overflow-hidden" aria-hidden>
          <div className="h-full bg-green-600 transition-[width] duration-300 motion-reduce:transition-none" style={{ width: `${live.length ? (tickedCount / live.length) * 100 : 0}%` }} />
        </div>
      </section>

      {/* Cards by bag */}
      {ordered.map((g) => {
        const scanned = !!g.bag && g.bag.id === highlightBagId;
        return (
          <section
            key={g.bag?.id ?? "no-bag"}
            aria-label={g.bag ? `Bag ${g.bag.code}` : "Cards in no bag"}
            className={`rounded-xl border bg-white overflow-hidden ${scanned ? "border-primary ring-2 ring-primary/30" : "border-border"}`}
          >
            <header className="flex flex-wrap items-center justify-between gap-2 px-3 py-2.5 sm:px-4 bg-secondary/50 border-b border-border">
              <div className="flex flex-wrap items-center gap-2 min-w-0">
                {g.bag ? (
                  <>
                    <AdminLink href={`/admin/receiving/bag/${g.bag.id}`} className={`font-mono font-black text-foreground hover:underline rounded ${focusRing}`}>
                      {g.bag.code}
                    </AdminLink>
                    <span className="text-xs font-bold px-2 py-0.5 rounded-full bg-white border border-border">{g.bag.tierName}</span>
                    {scanned && <span className="text-xs font-bold px-2 py-0.5 rounded-full bg-primary text-primary-foreground">Scanned</span>}
                  </>
                ) : (
                  <span className="font-bold text-foreground">Not in a bag</span>
                )}
              </div>
              <span className="text-xs text-muted-foreground">
                {plural(g.rows.filter(isLive).length, "card")}
                {g.bag?.place ? ` · bag on ${g.bag.place}` : ""}
              </span>
            </header>
            <ul>
              {g.rows.map((row) => (
                <CardRow
                  key={row.id}
                  row={row}
                  ticked={!!present[row.id]}
                  onTick={(on) => save({ ...present, [row.id]: on })}
                  onSaved={refresh}
                  trackPlaces={trackPlaces}
                  orderId={orderId}
                />
              ))}
            </ul>
          </section>
        );
      })}

      {/* Verdict */}
      {ready ? (
        <AdminLink
          href={shippingHref}
          className={`flex items-center justify-center gap-2 min-h-14 px-5 rounded-xl bg-green-700 text-white text-lg font-black hover:bg-green-800 transition-colors ${focusRing}`}
        >
          <Truck aria-hidden className="size-6" strokeWidth={1.75} />
          All good: ready to ship
        </AdminLink>
      ) : (
        <div role="status" className={`rounded-xl border p-4 text-sm ${problems.length ? "border-amber-300 bg-amber-50 text-amber-900" : "border-border bg-white text-foreground"}`}>
          {problems.length ? (
            <p><span className="font-bold">Not ready to ship:</span> {problems.join(" and ")}. Fix those above first.</p>
          ) : live.length === 0 ? (
            <p>No cards to ship on this order.</p>
          ) : (
            <p>
              <span className="font-bold">Every card is done.</span> Tick each one as it goes in the box ({tickedCount} of {live.length}), or tap Confirm all present.
            </p>
          )}
        </div>
      )}
    </div>
  );
}
