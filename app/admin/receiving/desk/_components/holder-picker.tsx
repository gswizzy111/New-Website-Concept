"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { ChevronDown, LoaderCircle, RotateCcw, X } from "lucide-react";
import { fillText } from "@/components/intake/scan/format";
import type { CapacityConflict, LocationsResponse, StationType, TrackLocationWithCount } from "@/lib/intake/tracking/types";
import { holderFromText, holderGroups, isTakenHolder, oneEachText, takenText } from "../_lib/holders";
import { deskButtons } from "./desk-card-panel";

/**
 * "Put in holder": a sheet (full width at the bottom of a phone, a dialog on
 * a computer) listing the holders, grouped by station type, the ones with
 * room first. Every holder but a desk takes one card (owner, Nov 26 2026):
 * one that has a card folds away under "Full", greyed with its card's ID
 * ("Has CD-2549-03"), and can't be picked; for 2+ cards only desks are
 * listed. A desk at a limit set on it is listed under "Full" too, and
 * picking it asks "Add anyway?". The box takes a typed or scanned holder
 * ("clamp 7", a slot's QR through a handheld scanner) and narrows the list
 * as you type; a holder the server refuses (it has a card now) shows the
 * server's sentence and the list is read again. The places come from GET
 * /api/admin/track/locations each time it opens, so the counts are fresh.
 */

export type Holder = { code: string; name: string | null };
export type PickResult = { ok: true } | { ok: false; error: string; conflict?: CapacityConflict };

type Props = {
  /** The cards to put away; the sheet is open while this is set. */
  cardIds: string[] | null;
  /** "CD-2549-03 Charizard" or "3 cards" */
  what: string;
  /** The desk they're on (left out of the list). */
  deskId: string;
  onPick: (holder: Holder, force: boolean) => Promise<PickResult>;
  onClose: () => void;
};

type Loaded = { locations: TrackLocationWithCount[]; stations: StationType[] };
type ListState = { status: "loading" } | { status: "error"; error: string } | ({ status: "ready" } & Loaded);

const focusRing = "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary";
const TIMEOUT_MS = 20_000;

async function loadHolders(): Promise<Loaded | { error: string }> {
  const abort = new AbortController();
  const timer = setTimeout(() => abort.abort(), TIMEOUT_MS);
  try {
    const res = await fetch("/api/admin/track/locations", { cache: "no-store", signal: abort.signal });
    const body = (await res.json().catch(() => null)) as (LocationsResponse & { error?: string }) | null;
    if (res.ok && body?.locations) return { locations: body.locations, stations: body.stations ?? [] };
    if (res.status === 401) return { error: "You're signed out. Sign in again, then try again." };
    return { error: body?.error ?? `Couldn't load the holders (${res.status}).` };
  } catch {
    return { error: abort.signal.aborted ? "No answer from the server. Check the connection, then try again." : "No connection. Try again." };
  } finally {
    clearTimeout(timer);
  }
}

/** "DESK already holds Charizard. Add anyway?" (a desk with a limit set; the server's sentence when it names no card). */
function conflictText(name: string, conflict: CapacityConflict): string {
  const names = conflict.occupants.map((c) => c.name ?? c.code ?? "a card");
  if (!names.length) return conflict.error;
  const shown = names.length > 3 ? `${names.slice(0, 3).join(", ")} and ${names.length - 3} more` : names.join(names.length === 2 ? " and " : ", ");
  return `${name} already holds ${shown}. Add anyway?`;
}

export function HolderPicker({ cardIds, what, deskId, onPick, onClose }: Props) {
  const dialog = useRef<HTMLDialogElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const open = cardIds !== null;
  const need = cardIds?.length ?? 1;
  const [list, setList] = useState<ListState>({ status: "loading" });
  const [query, setQuery] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [conflict, setConflict] = useState<{ holder: Holder; text: string; conflict: CapacityConflict } | null>(null);

  async function reload() {
    setList({ status: "loading" });
    const got = await loadHolders();
    setList("error" in got ? { status: "error", error: got.error } : { status: "ready", ...got });
  }

  /** After a refused pick (a holder that has a card now): the list again, the old one kept until it's back. */
  async function refreshQuietly() {
    const got = await loadHolders();
    if (!("error" in got)) setList((l) => (l.status === "ready" ? { status: "ready", ...got } : l));
  }

  // Open: show the sheet, start fresh and load the holders; closed: put it away
  useEffect(() => {
    const d = dialog.current;
    if (!d) return;
    if (!open) {
      if (d.open) d.close();
      return;
    }
    if (d.open) return;
    d.showModal();
    // A computer (a mouse, maybe a handheld scanner) starts in the box. A phone starts on the heading:
    // showModal() alone would focus the first field, and the phone's keyboard would cover the list
    if (window.matchMedia("(pointer: fine)").matches) input.current?.focus();
    else heading.current?.focus({ preventScroll: true });
    let live = true;
    loadHolders().then((got) => {
      if (live) setList("error" in got ? { status: "error", error: got.error } : { status: "ready", ...got });
    });
    return () => {
      live = false;
    };
  }, [open]);

  function reset() {
    setQuery("");
    setProblem(null);
    setConflict(null);
    setBusy(null);
    setList({ status: "loading" });
  }

  const groups = useMemo(
    () => (list.status === "ready" ? holderGroups(list.locations, list.stations, { excludeId: deskId, need, query }) : []),
    [list, deskId, need, query],
  );

  async function pick(holder: Holder, force = false) {
    if (busy) return;
    setProblem(null);
    setConflict(null);
    setBusy(holder.name ?? holder.code);
    const res = await onPick(holder, force);
    setBusy(null);
    if (res.ok) return; // the board closes the sheet
    if (res.conflict) setConflict({ holder, text: conflictText(holder.name ?? holder.code, res.conflict), conflict: res.conflict });
    else {
      setProblem(res.error);
      // "CLAMP 07 already has a card (…)": the list shows it as full now
      void refreshQuietly();
    }
  }

  function submit(e: React.FormEvent) {
    e.preventDefault();
    const choice = holderFromText(query, list.status === "ready" ? list.locations : [], deskId);
    if (!choice) {
      setProblem("Type or scan a holder, like clamp 7. Or tap one below.");
      return;
    }
    if (!choice.ok) {
      setProblem(choice.error);
      return;
    }
    void pick({ code: choice.code, name: choice.name });
  }

  const titleId = "holder-picker-title";
  return (
    <dialog
      ref={dialog}
      aria-labelledby={titleId}
      onClose={() => {
        reset();
        onClose();
      }}
      className="fixed inset-x-0 bottom-0 top-auto m-0 w-full max-w-none overflow-hidden rounded-t-2xl bg-white p-0 text-foreground shadow-2xl backdrop:bg-black/50 sm:inset-0 sm:m-auto sm:max-w-2xl sm:rounded-2xl"
    >
      {open && (
        <div className="flex max-h-[88dvh] flex-col sm:max-h-[85dvh]">
          <div className="flex items-start gap-2 border-b border-border px-4 pt-3 pb-3">
            <div className="min-w-0 flex-1">
              <h2 ref={heading} id={titleId} tabIndex={-1} className="font-heading text-xl font-black leading-tight break-words outline-none">Put {what} in…</h2>
              <p className="text-sm text-muted-foreground">Tap a holder, or type or scan one (clamp 7).</p>
            </div>
            <button type="button" onClick={() => dialog.current?.close()} className={`${deskButtons.secondary} shrink-0`}>
              <X className="size-4" strokeWidth={1.75} aria-hidden="true" />
              Close
            </button>
          </div>

          <form onSubmit={submit} className="flex gap-2 px-4 pt-3">
            <label htmlFor="holder-picker-box" className="sr-only">Holder</label>
            <input
              ref={input}
              id="holder-picker-box"
              value={query}
              onChange={(e) => {
                setQuery(e.target.value);
                setProblem(null);
              }}
              placeholder="clamp 7, heat press 2…"
              autoComplete="off"
              autoCapitalize="off"
              spellCheck={false}
              enterKeyHint="go"
              className={`min-h-11 min-w-0 flex-1 rounded-xl border border-border bg-white px-3 text-base ${focusRing}`}
            />
            <button type="submit" disabled={!!busy} className={deskButtons.primary}>Put in</button>
          </form>

          <div aria-live="polite" className="px-4">
            {busy && (
              <p className="mt-3 flex items-center gap-2 text-sm font-semibold text-foreground">
                <LoaderCircle className="size-4 animate-spin motion-reduce:animate-none" strokeWidth={1.75} aria-hidden="true" />
                Putting {what} in {busy}…
              </p>
            )}
            {problem && <p role="alert" className="mt-3 rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm font-semibold text-red-800">{problem}</p>}
            {conflict && (
              <div role="alert" className="mt-3 rounded-xl border border-amber-300 bg-amber-50 p-3 text-amber-950">
                <p className="font-bold">{conflict.text}</p>
                {conflict.conflict.occupants.length > 0 && (
                  <p className="mt-0.5 text-sm">
                    In it now: <span className="font-mono font-bold">{conflict.conflict.occupants.map((c) => c.code ?? c.name).join(", ")}</span>
                    {` · holds ${conflict.conflict.capacity === 1 ? "1 card" : `${conflict.conflict.capacity} cards`}`}
                  </p>
                )}
                <div className="mt-2 grid grid-cols-2 gap-2">
                  <button type="button" onClick={() => void pick(conflict.holder, true)} disabled={!!busy} className={`${deskButtons.primary} bg-amber-500 text-gray-950 hover:bg-amber-400`}>
                    Add anyway
                  </button>
                  <button type="button" onClick={() => setConflict(null)} disabled={!!busy} className={deskButtons.secondary}>
                    Pick another
                  </button>
                </div>
              </div>
            )}
          </div>

          <div className="mt-3 min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 pb-[max(1rem,env(safe-area-inset-bottom))]">
            {list.status === "loading" && (
              <p className="flex items-center gap-2 py-6 text-sm text-muted-foreground">
                <LoaderCircle className="size-4 animate-spin motion-reduce:animate-none" strokeWidth={1.75} aria-hidden="true" />
                Loading holders…
              </p>
            )}
            {list.status === "error" && (
              <div role="alert" className="py-4 text-sm">
                <p className="font-semibold text-red-800">{list.error}</p>
                <button type="button" onClick={() => void reload()} className={`${deskButtons.secondary} mt-2`}>
                  <RotateCcw className="size-4" strokeWidth={1.75} aria-hidden="true" />
                  Try again
                </button>
              </div>
            )}
            {list.status === "ready" && need > 1 && (
              <p className="pb-1 text-sm font-semibold text-foreground">{oneEachText(need)}</p>
            )}
            {list.status === "ready" && groups.length === 0 && (
              <p className="py-6 text-sm text-muted-foreground">
                {query.trim() ? "No holder matches. Press Put in to try that code anyway." : need > 1 ? "No other desk to put them on." : "No holders yet. Add slots on the Places page."}
              </p>
            )}
            {list.status === "ready" && groups.map((g) => (
              <section key={g.key} aria-labelledby={`holders-${g.key}`} className="pt-3 first:pt-0">
                <h3 id={`holders-${g.key}`} className="flex flex-wrap items-baseline gap-x-2 text-sm font-black text-foreground">
                  {g.title}
                  {g.step && g.step.toLowerCase() !== g.title.toLowerCase() && <span className="font-semibold text-muted-foreground">· {g.step}</span>}
                  <span className="text-xs font-semibold text-muted-foreground">{g.free.length ? `${g.free.length} with room` : "all full"}</span>
                </h3>
                {g.free.length > 0 && <HolderList holders={g.free} busy={!!busy} onPick={(h) => void pick(h)} />}
                {g.full.length > 0 && (
                  <details className="group/full mt-1.5" open={!!query.trim() || g.free.length === 0}>
                    <summary className={`inline-flex min-h-11 cursor-pointer list-none items-center gap-1 rounded-lg px-1 text-sm font-bold text-muted-foreground hover:text-foreground [&::-webkit-details-marker]:hidden ${focusRing}`}>
                      <ChevronDown className="size-4 transition-transform group-open/full:rotate-180 motion-reduce:transition-none" strokeWidth={1.75} aria-hidden="true" />
                      Full ({g.full.length})
                    </summary>
                    <HolderList holders={g.full} full busy={!!busy} onPick={(h) => void pick(h)} />
                  </details>
                )}
              </section>
            ))}
          </div>
        </div>
      )}
    </dialog>
  );
}

function HolderList({ holders, full = false, busy, onPick }: { holders: TrackLocationWithCount[]; full?: boolean; busy: boolean; onPick: (h: Holder) => void }) {
  return (
    <ul className="mt-1.5 grid grid-cols-2 gap-2 sm:grid-cols-3">
      {holders.map((l) => (
        <li key={l.id} className="min-w-0">
          {full && isTakenHolder(l) ? (
            // A one-card holder with a card in it: not offered (the server would refuse a second card)
            <div className="flex min-h-11 w-full flex-col items-start justify-center rounded-xl border border-border bg-secondary px-3 py-1.5 text-left">
              <span className="w-full truncate text-sm font-black text-muted-foreground">
                {l.name}
                <span className="sr-only"> is full</span>
              </span>
              <span className="w-full truncate font-mono text-xs font-semibold text-muted-foreground">{takenText(l)}</span>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => onPick({ code: l.code, name: l.name })}
              disabled={busy}
              className={`flex min-h-11 w-full flex-col items-start justify-center rounded-xl border px-3 py-1.5 text-left transition-colors disabled:opacity-50 ${full ? "border-dashed border-amber-300 bg-amber-50/60 hover:border-amber-500" : "border-border bg-white hover:border-primary/60 hover:bg-primary/5"} ${focusRing}`}
            >
              <span className="w-full truncate text-sm font-black text-foreground">{l.name}</span>
              <span className={`text-xs font-semibold ${full ? "text-amber-900" : "text-muted-foreground"}`}>{fillText(l.capacity, l.cardCount)}</span>
            </button>
          )}
        </li>
      ))}
    </ul>
  );
}
