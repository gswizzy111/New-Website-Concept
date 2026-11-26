"use client";

import { useEffect, useMemo, useRef, useState, useTransition, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { ArrowRight, CircleAlert, CircleCheck, LoaderCircle, PackageCheck, RotateCcw, TriangleAlert, X } from "lucide-react";
import { AdminLink } from "@/components/admin-ui/admin-link";
import * as api from "@/components/intake/scan/api";
import type { TrackActionResponse } from "@/lib/intake/tracking/types";
import { failedOutcome, outcomeOf, settledIds, type Outcome } from "../_lib/outcome";
import type { DeskPanelCard } from "../_lib/view";
import { DeskCardPanel, deskButtons } from "./desk-card-panel";
import { HolderPicker, type Holder, type PickResult } from "./holder-picker";

/**
 * The cards on one desk as a grid of panels (one column on a phone, two or
 * three on a computer) with multi-select. Every action goes through the
 * tracking API the Scan page uses (components/intake/scan/api.ts):
 *   Put in holder   POST /api/admin/track/assign  (one card per holder: a holder that has a card, or
 *                   several cards at once, is refused with the server's sentence; a desk with a
 *                   limit set that is full asks "Add anyway?")
 *   Done            POST /api/admin/track/done
 *   Take out        POST /api/admin/track/release (Undo puts them back on the desk)
 * After each one the page's data reloads (router.refresh) and the dock at
 * the bottom says what happened, card by card.
 */

type Props = {
  desk: { id: string; code: string; name: string };
  cards: DeskPanelCard[];
  /** When the server read the cards (Date.now()): "2 h on the desk" starts from it, so the page hydrates as rendered. */
  serverNow: number;
  /** What an empty desk shows (made on the server). */
  empty: ReactNode;
};

/** Reload when the page comes back into view (cards moved from a phone meanwhile), at most this often. */
const REFRESH_ON_SHOW_MS = 15_000;

function plural(n: number, word: string) {
  return `${n} ${word}${n === 1 ? "" : "s"}`;
}

export function DeskBoard({ desk, cards, serverNow, empty }: Props) {
  const router = useRouter();
  const [refreshing, startTransition] = useTransition();
  const [picked, setPicked] = useState<Set<string>>(() => new Set());
  const [picker, setPicker] = useState<{ ids: string[]; what: string } | null>(null);
  const [confirmDone, setConfirmDone] = useState<{ ids: string[]; bulk: boolean } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  const [tick, setTick] = useState<number | null>(null);
  const dock = useRef<HTMLDivElement>(null);
  const running = useRef(false);
  const now = tick ?? serverNow;

  // "2 h on the desk" moves on once a minute
  useEffect(() => {
    const t = setInterval(() => setTick(Date.now()), 60_000);
    return () => clearInterval(t);
  }, []);

  // Back on this tab after scanning on a phone: show what's on the desk now
  useEffect(() => {
    let last = Date.now();
    const onShow = () => {
      if (document.visibilityState !== "visible" || Date.now() - last < REFRESH_ON_SHOW_MS) return;
      last = Date.now();
      startTransition(() => router.refresh());
    };
    document.addEventListener("visibilitychange", onShow);
    return () => document.removeEventListener("visibilitychange", onShow);
  }, [router]);

  // Picked cards still on the desk (a refresh drops the ones that left)
  const selected = useMemo(() => cards.filter((c) => picked.has(c.id)), [cards, picked]);
  const allPicked = cards.length > 0 && selected.length === cards.length;

  function toggle(id: string) {
    setPicked((s) => {
      const next = new Set(s);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function whatOf(ids: string[]): string {
    if (ids.length !== 1) return plural(ids.length, "card");
    const c = cards.find((x) => x.id === ids[0]);
    return c?.code ?? c?.name ?? "the card";
  }

  /** Show what happened, drop the settled cards from the selection, reload the desk. `title` replaces the API's sentence when every card went. */
  function settle(res: TrackActionResponse, undo?: string[], title?: string) {
    const done = new Set(settledIds(res));
    setPicked((s) => new Set([...s].filter((id) => !done.has(id))));
    const base = outcomeOf(res);
    const out = title && base.tone === "ok" ? { ...base, title } : base;
    setOutcome(undo && done.size ? { ...out, undo: { cardIds: undo.filter((id) => done.has(id)) } } : out);
    startTransition(() => router.refresh());
    // The pressed button may be gone with its card: keep keyboard focus on the page
    requestAnimationFrame(() => dock.current?.focus({ preventScroll: true }));
  }

  /** One request at a time (a double tap sends nothing twice). */
  async function run<T>(label: string, work: () => Promise<T>): Promise<T | null> {
    if (running.current) return null;
    running.current = true;
    setBusy(label);
    try {
      return await work();
    } finally {
      running.current = false;
      setBusy(null);
    }
  }

  async function putIn(holder: Holder, force: boolean): Promise<PickResult> {
    const ids = picker?.ids ?? [];
    if (!ids.length) return { ok: false, error: "Pick at least one card." };
    const res = await run(`Putting ${whatOf(ids)} in ${holder.name ?? holder.code}…`, () => api.assign({ locationCode: holder.code, cardIds: ids, force }));
    if (!res) return { ok: false, error: "Still saving the last change. Try again in a moment." };
    if (!res.ok) return { ok: false, error: res.error, conflict: res.conflict };
    setPicker(null);
    settle(res.data);
    return { ok: true };
  }

  async function markDone(ids: string[]) {
    const res = await run(`Marking ${whatOf(ids)} done…`, () => api.done({ cardIds: ids }));
    if (!res) return;
    setConfirmDone(null);
    if (res.ok) settle(res.data);
    else setOutcome(failedOutcome(res.error));
  }

  async function takeOut(ids: string[]) {
    const what = whatOf(ids);
    const res = await run(`Taking ${what} off the desk…`, () => api.release({ cardIds: ids }));
    if (!res) return;
    // The API's sentence ("Taken out of its slot.") is the Scan page's; here it came off a desk
    if (res.ok) settle(res.data, ids, `${what} taken off ${desk.name}. ${ids.length === 1 ? "It's" : "They're"} in no holder now.`);
    else setOutcome(failedOutcome(res.error));
  }

  async function undo(ids: string[]) {
    // Back where they were; force: a desk has no limit, but one set on it mustn't block the undo
    const res = await run("Putting them back on the desk…", () => api.assign({ locationCode: desk.code, cardIds: ids, force: true }));
    if (!res) return;
    if (res.ok) settle(res.data);
    else setOutcome(failedOutcome(res.error));
  }

  const isBusy = busy !== null;
  const bulkConfirm = confirmDone?.bulk ? confirmDone : null;
  const showBar = selected.length > 0;

  return (
    <div>
      {cards.length > 0 && (
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <p className="text-sm text-muted-foreground">
            {plural(cards.length, "card")} · newest on the desk first
            {refreshing && <span className="ml-2 inline-flex items-center gap-1"><LoaderCircle className="size-3.5 animate-spin motion-reduce:animate-none" strokeWidth={1.75} aria-hidden="true" />Updating</span>}
          </p>
          <button
            type="button"
            onClick={() => setPicked(allPicked ? new Set() : new Set(cards.map((c) => c.id)))}
            className={deskButtons.secondary}
            aria-pressed={allPicked}
          >
            {allPicked ? "Clear selection" : `Select all ${cards.length}`}
          </button>
        </div>
      )}

      {cards.length === 0 ? (
        empty
      ) : (
        <ul className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3" aria-label={`Cards on ${desk.name}`}>
          {cards.map((card, i) => (
            <DeskCardPanel
              key={card.id}
              card={card}
              now={now}
              eager={i === 0}
              selected={picked.has(card.id)}
              busy={isBusy}
              confirmingDone={!!confirmDone && !confirmDone.bulk && confirmDone.ids[0] === card.id}
              onToggle={() => toggle(card.id)}
              onPut={() => setPicker({ ids: [card.id], what: whatOf([card.id]) })}
              onDone={() => setConfirmDone({ ids: [card.id], bulk: false })}
              onConfirmDone={() => void markDone([card.id])}
              onCancelDone={() => setConfirmDone(null)}
              onTakeOut={() => void takeOut([card.id])}
            />
          ))}
        </ul>
      )}

      {/* The dock: what just happened, and what to do with the picked cards. Sticks to the bottom of the screen while the list scrolls. */}
      <div className="sticky bottom-0 z-20 mt-4 flex flex-col gap-2 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
        <div ref={dock} tabIndex={-1} aria-live="polite" className="outline-none">
          {busy && (
            <p className="flex items-center gap-2 rounded-2xl border border-border bg-white/95 px-4 py-3 text-sm font-semibold text-foreground shadow-lg backdrop-blur">
              <LoaderCircle className="size-4 shrink-0 animate-spin motion-reduce:animate-none" strokeWidth={1.75} aria-hidden="true" />
              {busy}
            </p>
          )}
          {!busy && outcome && <OutcomeCard outcome={outcome} onUndo={(ids) => void undo(ids)} onClose={() => setOutcome(null)} />}
        </div>

        {showBar && (
          <div role="group" aria-label="Picked cards" className="rounded-2xl border border-primary/30 bg-white/95 p-3 shadow-lg backdrop-blur">
            {bulkConfirm ? (
              <>
                <p className="text-sm font-bold text-foreground">Mark {plural(bulkConfirm.ids.length, "card")} done? Then put each back in its bag.</p>
                <div className="mt-2 grid grid-cols-2 gap-2 sm:flex">
                  <button type="button" onClick={() => void markDone(bulkConfirm.ids)} disabled={isBusy} className={`${deskButtons.primary} bg-green-700 hover:bg-green-800`}>
                    <PackageCheck className="size-4" strokeWidth={1.75} aria-hidden="true" />
                    Mark {plural(bulkConfirm.ids.length, "card")} done
                  </button>
                  <button type="button" onClick={() => setConfirmDone(null)} disabled={isBusy} className={deskButtons.secondary}>Cancel</button>
                </div>
              </>
            ) : (
              <div className="flex flex-wrap items-center gap-2">
                <p className="mr-auto text-sm font-bold text-foreground">{selected.length} picked</p>
                <div className="grid w-full grid-cols-2 gap-2 sm:flex sm:w-auto">
                  <button
                    type="button"
                    onClick={() => setPicker({ ids: selected.map((c) => c.id), what: whatOf(selected.map((c) => c.id)) })}
                    disabled={isBusy}
                    className={deskButtons.primary}
                  >
                    Put selected in…
                  </button>
                  <button
                    type="button"
                    onClick={() => setConfirmDone({ ids: selected.map((c) => c.id), bulk: true })}
                    disabled={isBusy}
                    className={deskButtons.done}
                  >
                    <PackageCheck className="size-4" strokeWidth={1.75} aria-hidden="true" />
                    Done for selected
                  </button>
                  <button type="button" onClick={() => setPicked(new Set())} className={`${deskButtons.quiet} col-span-2 sm:col-span-1`}>
                    Clear
                  </button>
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      <HolderPicker
        cardIds={picker?.ids ?? null}
        what={picker?.what ?? ""}
        deskId={desk.id}
        onPick={putIn}
        onClose={() => setPicker(null)}
      />
    </div>
  );
}

function OutcomeCard({ outcome, onUndo, onClose }: { outcome: Outcome; onUndo: (ids: string[]) => void; onClose: () => void }) {
  const tone = outcome.tone === "ok"
    ? { box: "border-green-300 bg-green-50 text-green-950", Icon: CircleCheck }
    : outcome.tone === "warn"
      ? { box: "border-amber-300 bg-amber-50 text-amber-950", Icon: TriangleAlert }
      : { box: "border-red-300 bg-red-50 text-red-950", Icon: CircleAlert };
  const { Icon } = tone;
  return (
    <div className={`rounded-2xl border px-4 py-3 shadow-lg ${tone.box}`}>
      <div className="flex items-start gap-2">
        <Icon className="mt-0.5 size-5 shrink-0" strokeWidth={1.75} aria-hidden="true" />
        <div className="min-w-0 flex-1">
          <p className="font-bold break-words">{outcome.title}</p>
          {outcome.notes.map((n) => <p key={n} className="text-sm">{n}</p>)}
          {/* The order completed (green), or why it didn't (amber) */}
          {outcome.orderNotes?.map((n) => (
            <p key={n.text} className={`mt-1.5 rounded-lg border px-2.5 py-1.5 text-sm font-bold ${n.tone === "ok" ? "border-green-300 bg-white text-green-900" : "border-amber-300 bg-amber-50 text-amber-950"}`}>{n.text}</p>
          ))}
          {outcome.bagLinks && outcome.bagLinks.length > 0 && (
            <div className="mt-2 flex flex-wrap gap-2">
              {outcome.bagLinks.map((l) => (
                <AdminLink key={l.key} href={l.href} className={deskButtons.secondary}>
                  {l.label}
                  <ArrowRight className="size-4" strokeWidth={1.75} aria-hidden="true" />
                </AdminLink>
              ))}
            </div>
          )}
        </div>
        <button type="button" onClick={onClose} className={`-m-1.5 inline-flex min-h-11 min-w-11 shrink-0 items-center justify-center rounded-lg hover:bg-black/5 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary`}>
          <X className="size-4" strokeWidth={1.75} aria-hidden="true" />
          <span className="sr-only">Close this message</span>
        </button>
      </div>
      {outcome.lines.length > 0 && (
        <ul className="mt-2 max-h-40 overflow-y-auto overscroll-contain border-t border-current/15 pt-2 text-sm">
          {outcome.lines.map((l) => (
            <li key={l.key} className="flex gap-2 py-0.5">
              <span className={`shrink-0 font-mono font-bold ${l.ok ? "" : "text-red-800"}`}>{l.label}</span>
              <span className="min-w-0 break-words">{l.message}</span>
            </li>
          ))}
        </ul>
      )}
      {outcome.undo && outcome.undo.cardIds.length > 0 && (
        <button type="button" onClick={() => onUndo(outcome.undo!.cardIds)} className={`${deskButtons.secondary} mt-2`}>
          <RotateCcw className="size-4" strokeWidth={1.75} aria-hidden="true" />
          Undo: back on the desk
        </button>
      )}
    </div>
  );
}
