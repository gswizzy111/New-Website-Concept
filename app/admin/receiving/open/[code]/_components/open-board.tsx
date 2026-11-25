"use client";

import { useEffect, useMemo, useRef, useState, useTransition, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { ArrowRight, CircleAlert, CircleCheck, LoaderCircle, TriangleAlert } from "lucide-react";
import { AdminLink } from "@/components/admin-ui/admin-link";
import * as api from "@/components/intake/scan/api";
import { deskPagePath } from "@/lib/intake/tracking/desk-codes";
import type { LocationRef } from "@/lib/intake/tracking/types";
import {
  alreadyText, chooseDesk, chunkedMoveOutcome, moveAllLabel, moveAllState, moveChunks,
  type MoveOutcome, type MovePart, type OpenDesk, type OpenGroup,
} from "../_lib/view";
import { storeDesk, useStoredDesk } from "./desk-choice";
import { OpenCardPanel, whereId } from "./open-card";

/**
 * The scan landing's working part: the one big "Move all N cards to my
 * desk" button (beside the person on a computer, under it on a phone), the
 * desk picker when there are several desks, and the cards, a panel each with
 * its own "Move to my desk". Every move is POST /api/admin/track/assign
 * { locationCode: <desk>, cardIds } (the Scan and Desk pages' call; at most
 * 200 cards per request, so a bigger order goes in several): the card's place
 * changes, never its step, and no email goes out. The cards show on the desk
 * at once and the page's data reloads (router.refresh, also after a failed
 * move, so a desk switched off meanwhile drops out of the picker) so "Where it
 * is now" comes from the server; a refused card or a failed request shows the
 * server's own words.
 */

type Props = {
  /** The person: name, order, bag, due date, card count (made on the server); above the button on a phone. */
  person: ReactNode;
  /** The order's bags, the customer's notes and the links; under the button on a phone, under the person on a computer. */
  personMore: ReactNode;
  groups: OpenGroup[];
  /** Switched-on desks, LOC-DESK first. */
  desks: OpenDesk[];
  defaultDeskId: string | null;
  /** Why there is no desk (it couldn't be made or read). */
  deskProblem: string | null;
};

const focusRing = "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary";
const bigButton = `inline-flex min-h-14 w-full items-center justify-center gap-2 rounded-2xl px-5 text-lg font-black transition-colors disabled:opacity-60 ${focusRing}`;

const deskRef = (d: OpenDesk): LocationRef => ({ id: d.id, code: d.code, name: d.name, kind: "other", station: null, serial: null, stage: null });
const NONE_PLACED: ReadonlyMap<string, LocationRef> = new Map();

export function OpenBoard({ person, personMore, groups, desks, defaultDeskId, deskProblem }: Props) {
  const router = useRouter();
  const [refreshing, startTransition] = useTransition();
  const stored = useStoredDesk();
  const desk = chooseDesk(desks, stored, defaultDeskId);
  const deskId = desk?.id ?? null;

  // Cards this page moved (every move adds to it), shown on the desk until the server's data says where
  // they are. Each move starts a refresh right after it lands; `refreshing` (the transition's pending
  // flag) stays on until every refresh started so far has committed its data, so when it goes off,
  // every placement has been overtaken by a refresh started after it, never by an older one.
  const [placed, setPlaced] = useState<ReadonlyMap<string, LocationRef>>(NONE_PLACED);
  const [wasRefreshing, setWasRefreshing] = useState(refreshing);
  if (wasRefreshing !== refreshing) {
    setWasRefreshing(refreshing);
    if (!refreshing && placed.size) setPlaced(NONE_PLACED);
  }
  const [moving, setMoving] = useState<{ ids: Set<string>; all: boolean } | null>(null);
  const [outcome, setOutcome] = useState<MoveOutcome | null>(null);
  const [cardErrors, setCardErrors] = useState<Record<string, string>>({});
  const running = useRef(false);
  const outcomeBox = useRef<HTMLDivElement>(null);

  const shown = useMemo(() => {
    if (!placed.size) return groups;
    return groups.map((g) => ({ ...g, cards: g.cards.map((c) => (placed.has(c.id) ? { ...c, location: placed.get(c.id)! } : c)) }));
  }, [groups, placed]);
  const cards = useMemo(() => shown.flatMap((g) => g.cards), [shown]);
  const state = moveAllState(cards, deskId);
  const busy = moving !== null;
  const firstId = cards[0]?.id;

  // What a move of every card did: keyboard and screen reader land on it (the button may be gone)
  useEffect(() => {
    if (outcome) outcomeBox.current?.focus({ preventScroll: false });
  }, [outcome]);

  function pickDesk(code: string) {
    storeDesk(code);
    setOutcome(null);
  }

  /** One move at a time (a double tap sends nothing twice). */
  async function move(ids: string[], all: boolean) {
    if (running.current || !desk || !ids.length) return;
    running.current = true;
    setMoving({ ids: new Set(ids), all });
    if (all) setOutcome(null);
    setCardErrors((e) => {
      const next = { ...e };
      for (const id of ids) delete next[id];
      return next;
    });
    const target = desk;
    // At most 200 cards per request (the route's limit); a request refused as a whole (desk switched
    // off, signed out) would refuse the rest too, so they count as not moved with its message
    const parts: MovePart[] = [];
    let sent = 0;
    for (const chunk of moveChunks(ids)) {
      const res = await api.assign({ locationCode: target.code, cardIds: chunk });
      if (!res.ok) {
        parts.push({ ok: false, error: res.error, count: ids.length - sent });
        break;
      }
      parts.push({ ok: true, results: res.data.results });
      sent += chunk.length;
    }
    running.current = false;
    setMoving(null);

    const out = chunkedMoveOutcome(parts);
    if (out.movedIds.length) {
      const ref = deskRef(target);
      setPlaced((p) => {
        const at = new Map(p);
        for (const id of out.movedIds) at.set(id, ref);
        return at;
      });
    }
    if (all) {
      setOutcome(out);
    } else if (out.failed.length) {
      setCardErrors((e) => ({ ...e, [ids[0]]: out.failed.map((f) => f.message).join(" ") }));
    } else {
      // The button is gone with the move: keep keyboard focus on the card, which now says "On your desk"
      requestAnimationFrame(() => document.getElementById(whereId(ids[0]))?.focus({ preventScroll: true }));
    }
    // Also after a failure: a desk switched off or gone meanwhile drops out, and the picker falls back
    startTransition(() => router.refresh());
  }

  // "Open my desk": the big button once nothing is left to move; a quieter one under "Move all" when some still are
  const openDeskLink = (primary: boolean) => desk && (
    <AdminLink
      href={deskPagePath(desk.code)}
      className={`${bigButton} ${primary ? "bg-primary text-primary-foreground hover:bg-primary/90" : "border-2 border-primary bg-white text-primary hover:bg-primary/5"}`}
    >
      Open my desk
      <ArrowRight className="size-5" strokeWidth={1.75} aria-hidden="true" />
    </AdminLink>
  );
  const showOkOutcome = !!outcome && outcome.movedIds.length > 0;

  return (
    <>
      {/* Phone: the person, the button, then the rest (the button is on the first screen even for an
          order with several bags and a long note); computer: the person's two parts as one card, the
          button panel beside them */}
      <div className="grid gap-4 [grid-template-areas:'top'_'move'_'more'] lg:grid-cols-[minmax(0,1fr)_24rem] lg:items-start lg:gap-y-0 lg:[grid-template-areas:'top_move'_'more_move']">
        <div className="min-w-0 [grid-area:top] lg:self-stretch [&>section]:h-full">{person}</div>

        <section aria-labelledby="move-h" className="[grid-area:move] rounded-2xl border border-border bg-white p-4 sm:p-5">
          <h2 id="move-h" className="sr-only">Move to my desk</h2>

          {desk && desks.length > 1 && (
            <label className="mb-3 flex items-center gap-3">
              <span className="text-sm font-bold text-foreground">Desk</span>
              <select
                value={desk.code}
                onChange={(e) => pickDesk(e.target.value)}
                disabled={busy}
                className={`min-h-11 min-w-0 flex-1 rounded-xl border border-border bg-white px-3 text-base font-bold text-foreground ${focusRing}`}
              >
                {desks.map((d) => <option key={d.id} value={d.code}>{d.name}</option>)}
              </select>
            </label>
          )}

          {!desk ? (
            <div role="status" className="rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-950">
              {deskProblem && <p className="mb-1 font-semibold break-words">{deskProblem}</p>}
              <p>No desk to put cards on. Add a desk or switch one on in Places.</p>
              <AdminLink href="/admin/receiving/locations" className={`mt-1 inline-flex min-h-11 items-center font-bold text-primary hover:underline ${focusRing}`}>
                Places
              </AdminLink>
            </div>
          ) : (
            <div className="flex flex-col gap-3">
              {outcome && (
                <OutcomeBox outcome={outcome} boxRef={outcomeBox} />
              )}
              {showOkOutcome && state.kind !== "move" && openDeskLink(true)}

              {state.kind === "move" && (
                <div>
                  <button
                    type="button"
                    onClick={() => void move(state.ids, true)}
                    disabled={busy}
                    className={`${bigButton} bg-primary text-primary-foreground hover:bg-primary/90`}
                  >
                    {moving?.all && <LoaderCircle className="size-5 animate-spin motion-reduce:animate-none" strokeWidth={1.75} aria-hidden="true" />}
                    {moving?.all ? "Moving…" : moveAllLabel(state.ids.length)}
                  </button>
                  {state.alreadyOnDesk > 0 && <p className="mt-2 text-center text-sm font-semibold text-green-800">{alreadyText(state.alreadyOnDesk)}</p>}
                  {showOkOutcome && <div className="mt-3">{openDeskLink(false)}</div>}
                </div>
              )}

              {state.kind === "all_on_desk" && !showOkOutcome && (
                <>
                  <p role="status" className="flex items-center justify-center gap-2 font-heading text-2xl font-black text-green-800">
                    <CircleCheck className="size-6" strokeWidth={1.75} aria-hidden="true" />
                    All on your desk
                  </p>
                  {openDeskLink(true)}
                </>
              )}

              {state.kind === "nothing" && !outcome && (
                <p role="status" className="text-center text-base font-semibold text-muted-foreground">{state.text}</p>
              )}
            </div>
          )}

          {refreshing && (
            <p className="mt-3 flex items-center justify-center gap-1.5 text-xs text-muted-foreground">
              <LoaderCircle className="size-3.5 animate-spin motion-reduce:animate-none" strokeWidth={1.75} aria-hidden="true" />
              Updating
            </p>
          )}
        </section>

        <div className="min-w-0 [grid-area:more]">{personMore}</div>
      </div>

      <div className="mt-6 flex flex-col gap-6">
        {shown.map((g) => (
          <section key={g.key} aria-labelledby={`open-group-${g.key}`}>
            <div className="mb-3">
              <h2 id={`open-group-${g.key}`} className="font-heading text-xl font-black text-foreground break-words">{g.title}</h2>
              {g.subtitle && (
                <p className={`text-sm font-semibold ${g.overdue ? "text-red-700" : "text-muted-foreground"}`}>
                  {g.subtitle}
                  {g.overdue && <span className="ml-2 rounded-full bg-red-600 px-2 py-0.5 text-xs font-bold text-white">Overdue</span>}
                </p>
              )}
            </div>
            <ul aria-label="Cards" className="grid grid-cols-1 gap-4 md:grid-cols-2">
              {g.cards.map((c) => (
                <OpenCardPanel
                  key={c.id}
                  card={c}
                  deskId={deskId}
                  moving={!!moving?.ids.has(c.id)}
                  busy={busy}
                  error={cardErrors[c.id] ?? null}
                  eager={c.id === firstId}
                  onMove={() => void move([c.id], false)}
                />
              ))}
            </ul>
          </section>
        ))}
      </div>
    </>
  );
}

function OutcomeBox({ outcome, boxRef }: { outcome: MoveOutcome; boxRef: React.RefObject<HTMLDivElement | null> }) {
  const tone = outcome.tone === "ok"
    ? { box: "border-green-300 bg-green-50 text-green-950", Icon: CircleCheck }
    : outcome.tone === "warn"
      ? { box: "border-amber-300 bg-amber-50 text-amber-950", Icon: TriangleAlert }
      : { box: "border-red-300 bg-red-50 text-red-950", Icon: CircleAlert };
  const { Icon } = tone;
  return (
    <div ref={boxRef} tabIndex={-1} role={outcome.tone === "error" ? "alert" : "status"} className={`rounded-xl border px-4 py-3 outline-none ${tone.box}`}>
      <p className="flex items-center gap-2 font-heading text-2xl font-black leading-tight">
        <Icon className="size-6 shrink-0" strokeWidth={1.75} aria-hidden="true" />
        {outcome.title}
      </p>
      {outcome.failedTitle && <p className="mt-1 text-sm font-bold">{outcome.failedTitle}</p>}
      {outcome.failed.length > 0 && (
        <ul className="mt-1 max-h-48 overflow-y-auto overscroll-contain text-sm">
          {outcome.failed.map((f) => (
            <li key={f.key} className="py-0.5 break-words">
              {f.label && <span className="mr-1.5 font-mono font-bold">{f.label}</span>}
              {f.message}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
