"use client";

import { useEffect, useMemo, useRef, useState, useTransition, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { ArrowRight, CircleAlert, CircleCheck, LoaderCircle, PackageCheck, TriangleAlert } from "lucide-react";
import { AdminLink } from "@/components/admin-ui/admin-link";
import * as api from "@/components/intake/scan/api";
import type { ToneLine } from "@/lib/intake/tracking/bag-home";
import { deskPagePath } from "@/lib/intake/tracking/desk-codes";
import type { LocationRef } from "@/lib/intake/tracking/types";
import {
  BIN_BUTTON, IN_BIN_TEXT, alreadyText, bagStepTitle, bagSteps, chooseDesk, chunkedMoveOutcome, doneAllIds, doneAllLabel,
  doneAllQuestion, doneOutcome, moveAllLabel, moveAllState, moveChunks, openBagsLine,
  type BagStep, type DonePart, type MoveLine, type MovePart, type OpenBagState, type OpenDesk, type OpenGroup,
} from "../_lib/view";
import { storeDesk, useStoredDesk } from "./desk-choice";
import { OpenCardPanel, ToneNote, noteId, whereId, type CardNote } from "./open-card";

/**
 * The scan landing's working part: the one big "Move all N cards to my
 * desk" button (beside the person on a computer, under it on a phone), the
 * desk picker when there are several desks, and the cards, a panel each with
 * its own "Move to my desk" and "Done". Moves are POST
 * /api/admin/track/assign { locationCode: <desk>, cardIds } (the Scan and
 * Desk pages' call; at most 200 cards per request, so a bigger order goes in
 * several): the card's place changes, never its step, and no email goes out;
 * the first card out of its bag files the bag in the Open bags box ("Put the
 * bag in the Open bags box, under R."). Done is POST /api/admin/track/done:
 * one tap per card, "Mark all N done" per bag after a question; the card goes
 * back in its bag ("Done. Put it back in REYES's bag: Open bags box, under
 * R."). A bag whose every card is done shows ONE big step, "Bag finished: put
 * it in the Ready to ship bin", whose button records it (POST
 * /api/admin/track/bag-ready). The cards show their new state at once and the
 * page's data reloads (router.refresh, also after a failure, so a desk
 * switched off meanwhile drops out of the picker); a refused card or a failed
 * request shows the server's own words.
 */

type Props = {
  /** The person: name, order, bag, due date, how many done, where the bag is (made on the server); above the button on a phone. */
  person: ReactNode;
  /** The order's bags, the customer's notes and the links; under the button on a phone, under the person on a computer. */
  personMore: ReactNode;
  groups: OpenGroup[];
  /** The bags on this page (the scanned one, or every bag of the order) and where each is. */
  bags: OpenBagState[];
  /** Switched-on desks, LOC-DESK first. */
  desks: OpenDesk[];
  defaultDeskId: string | null;
  /** Why there is no desk (it couldn't be made or read). */
  deskProblem: string | null;
};

/** What the box at the top says after "Move all" or "Mark all N done". */
type Feedback = {
  tone: "ok" | "warn" | "error";
  title: string;
  /** What to do next: "Put the bag in the Open bags box, under R." */
  next: string;
  failedTitle: string | null;
  failed: MoveLine[];
  /** The order's line: "Order completed. Pat Collector emailed." */
  notes: ToneLine[];
  /** It was a move: offer "Open my desk". */
  moved: boolean;
};

type Pending = { kind: "move" | "done" | "bin"; ids: ReadonlySet<string>; all: boolean };

const focusRing = "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary";
const bigButton = `inline-flex min-h-14 w-full items-center justify-center gap-2 rounded-2xl px-5 text-lg font-black transition-colors disabled:opacity-60 ${focusRing}`;
const smallButton = `inline-flex min-h-11 items-center justify-center gap-1.5 rounded-xl px-4 text-sm font-bold transition-colors disabled:opacity-60 ${focusRing}`;

const deskRef = (d: OpenDesk): LocationRef => ({ id: d.id, code: d.code, name: d.name, kind: "other", station: null, serial: null, stage: null });
const NONE_PLACED: ReadonlyMap<string, LocationRef> = new Map();
const NONE: ReadonlySet<string> = new Set();
const addAll = (s: ReadonlySet<string>, ids: readonly string[]) => new Set([...s, ...ids]);

export function OpenBoard({ person, personMore, groups, bags, desks, defaultDeskId, deskProblem }: Props) {
  const router = useRouter();
  const [refreshing, startTransition] = useTransition();
  const stored = useStoredDesk();
  const desk = chooseDesk(desks, stored, defaultDeskId);
  const deskId = desk?.id ?? null;

  // What this page just did (cards on the desk, cards done, bags in the bin), shown until the server's data
  // says it. Each action starts a refresh right after it lands; `refreshing` (the transition's pending flag)
  // stays on until every refresh started so far has committed its data, so when it goes off, every change
  // has been overtaken by a refresh started after it, never by an older one.
  const [placed, setPlaced] = useState<ReadonlyMap<string, LocationRef>>(NONE_PLACED);
  const [finished, setFinished] = useState<ReadonlySet<string>>(NONE);
  const [binned, setBinned] = useState<ReadonlySet<string>>(NONE);
  const [wasRefreshing, setWasRefreshing] = useState(refreshing);
  if (wasRefreshing !== refreshing) {
    setWasRefreshing(refreshing);
    if (!refreshing) {
      if (placed.size) setPlaced(NONE_PLACED);
      if (finished.size) setFinished(NONE);
      if (binned.size) setBinned(NONE);
    }
  }
  const [pending, setPending] = useState<Pending | null>(null);
  const [feedback, setFeedback] = useState<Feedback | null>(null);
  const [cardNotes, setCardNotes] = useState<Record<string, CardNote>>({});
  const [binErrors, setBinErrors] = useState<Record<string, string>>({});
  const [confirmGroup, setConfirmGroup] = useState<string | null>(null);
  const running = useRef(false);
  const feedbackBox = useRef<HTMLDivElement>(null);

  const shown = useMemo(() => {
    if (!placed.size && !finished.size) return groups;
    return groups.map((g) => ({
      ...g,
      cards: g.cards.map((c) => {
        if (finished.has(c.id)) return { ...c, state: "done" as const, location: null, stepLabel: "Done" };
        return placed.has(c.id) ? { ...c, location: placed.get(c.id)! } : c;
      }),
    }));
  }, [groups, placed, finished]);
  const cards = useMemo(() => shown.flatMap((g) => g.cards), [shown]);
  const state = moveAllState(cards, deskId);
  const steps = bagSteps(bags, cards, binned);
  const busy = pending !== null;
  const firstId = cards[0]?.id;

  // What "Move all" or "Mark all done" did: keyboard and screen reader land on it (the button may be gone)
  useEffect(() => {
    if (feedback) feedbackBox.current?.focus({ preventScroll: false });
  }, [feedback]);

  function pickDesk(code: string) {
    storeDesk(code);
    setFeedback(null);
  }

  function clearNotes(ids: readonly string[]) {
    setCardNotes((n) => {
      const next = { ...n };
      for (const id of ids) delete next[id];
      return next;
    });
  }

  /** One action at a time (a double tap sends nothing twice). */
  function start(p: Pending): boolean {
    if (running.current) return false;
    running.current = true;
    setPending(p);
    if (p.all) setFeedback(null);
    clearNotes([...p.ids]);
    return true;
  }

  function stop() {
    running.current = false;
    setPending(null);
    // Also after a failure: a desk switched off or gone meanwhile drops out, and the picker falls back
    startTransition(() => router.refresh());
  }

  /** Focus the card's own line once its button is gone. */
  function focusCard(id: string, target: "where" | "note") {
    requestAnimationFrame(() => document.getElementById(target === "note" ? noteId(id) : whereId(id))?.focus({ preventScroll: true }));
  }

  async function move(ids: string[], all: boolean) {
    if (!desk || !ids.length || !start({ kind: "move", ids: new Set(ids), all })) return;
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
      parts.push({ ok: true, results: res.data.results, bags: res.data.bags });
      sent += chunk.length;
    }
    const out = chunkedMoveOutcome(parts);
    const next = openBagsLine(parts);
    if (out.movedIds.length) {
      const ref = deskRef(target);
      setPlaced((p) => {
        const at = new Map(p);
        for (const id of out.movedIds) at.set(id, ref);
        return at;
      });
    }
    if (all) {
      setFeedback({ ...out, next, notes: [], moved: true });
    } else if (out.failed.length) {
      setCardNotes((n) => ({ ...n, [ids[0]]: { tone: "error", text: out.failed.map((f) => f.message).join(" "), notes: [] } }));
    } else if (next) {
      // The first card out of its bag: where the bag goes now
      setCardNotes((n) => ({ ...n, [ids[0]]: { tone: "ok", text: `On your desk. ${next}`, notes: [] } }));
      focusCard(ids[0], "note");
    } else {
      // The button is gone with the move: keep keyboard focus on the card, which now says "On your desk"
      focusCard(ids[0], "where");
    }
    stop();
  }

  async function finish(ids: string[], all: boolean) {
    if (!ids.length || !start({ kind: "done", ids: new Set(ids), all })) return;
    setConfirmGroup(null);
    const parts: DonePart[] = [];
    let sent = 0;
    for (const chunk of moveChunks(ids)) {
      const res = await api.done({ cardIds: chunk });
      if (!res.ok) {
        parts.push({ ok: false, error: res.error, count: ids.length - sent });
        break;
      }
      parts.push({ ok: true, res: res.data });
      sent += chunk.length;
    }
    const out = doneOutcome(parts);
    if (out.doneIds.length) setFinished((f) => addAll(f, out.doneIds));
    if (all) {
      setFeedback({ ...out, next: "", moved: false });
    } else {
      const text = out.tone === "error" ? out.failed.map((f) => f.message).join(" ") : out.title;
      setCardNotes((n) => ({ ...n, [ids[0]]: { tone: out.tone === "error" ? "error" : "ok", text, notes: out.notes } }));
      focusCard(ids[0], "note");
    }
    stop();
  }

  async function toBin(step: BagStep) {
    if (!start({ kind: "bin", ids: new Set([step.id]), all: false })) return;
    setBinErrors((e) => {
      const next = { ...e };
      delete next[step.id];
      return next;
    });
    const res = await api.bagReady({ bagId: step.id });
    if (res.ok) setBinned((b) => addAll(b, [step.id]));
    else setBinErrors((e) => ({ ...e, [step.id]: res.error }));
    stop();
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
  const movedSome = !!feedback?.moved && feedback.tone !== "error";
  const several = steps.length > 1;
  // A finished bag still to put in the bin is the page's one big step: "Move all" steps back
  const binFirst = steps.some((s) => !s.inBin);

  return (
    <>
      {/* Phone: the person, the button, then the rest (the button is on the first screen even for an
          order with several bags and a long note); computer: the person's two parts as one card, the
          button panel beside them */}
      <div className="grid gap-4 [grid-template-areas:'top'_'move'_'more'] lg:grid-cols-[minmax(0,1fr)_24rem] lg:items-start lg:gap-y-0 lg:[grid-template-areas:'top_move'_'more_move']">
        <div className="min-w-0 [grid-area:top] lg:self-stretch [&>section]:h-full">{person}</div>

        <section aria-labelledby="move-h" className="[grid-area:move] flex flex-col gap-3 rounded-2xl border border-border bg-white p-4 sm:p-5">
          <h2 id="move-h" className="sr-only">What to do now</h2>

          {/* What the last "Move all" / "Mark all done" did (put the cards back first), then a finished bag's step */}
          {feedback && <FeedbackBox feedback={feedback} boxRef={feedbackBox} />}

          {steps.map((step) => (
            <BagStepBox
              key={step.id}
              step={step}
              title={bagStepTitle(step, several)}
              saving={pending?.kind === "bin" && pending.ids.has(step.id)}
              busy={busy}
              error={binErrors[step.id] ?? null}
              onBin={() => void toBin(step)}
            />
          ))}

          {desk && desks.length > 1 && (
            <label className="flex items-center gap-3">
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
            state.kind !== "nothing" && (
              <div role="status" className="rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-950">
                {deskProblem && <p className="mb-1 font-semibold break-words">{deskProblem}</p>}
                <p>No desk to put cards on. Add a desk or switch one on in Places.</p>
                <AdminLink href="/admin/receiving/locations" className={`mt-1 inline-flex min-h-11 items-center font-bold text-primary hover:underline ${focusRing}`}>
                  Places
                </AdminLink>
              </div>
            )
          ) : (
            <>
              {movedSome && state.kind !== "move" && openDeskLink(true)}

              {state.kind === "move" && (
                <div>
                  <button
                    type="button"
                    onClick={() => void move(state.ids, true)}
                    disabled={busy}
                    className={`${bigButton} ${binFirst ? "border-2 border-primary bg-white text-primary hover:bg-primary/5" : "bg-primary text-primary-foreground hover:bg-primary/90"}`}
                  >
                    {pending?.kind === "move" && pending.all && <LoaderCircle className="size-5 animate-spin motion-reduce:animate-none" strokeWidth={1.75} aria-hidden="true" />}
                    {pending?.kind === "move" && pending.all ? "Moving…" : moveAllLabel(state.ids.length)}
                  </button>
                  {state.alreadyOnDesk > 0 && <p className="mt-2 text-center text-sm font-semibold text-green-800">{alreadyText(state.alreadyOnDesk)}</p>}
                  {movedSome && <div className="mt-3">{openDeskLink(false)}</div>}
                </div>
              )}

              {state.kind === "all_on_desk" && !movedSome && (
                <>
                  <p role="status" className="flex items-center justify-center gap-2 font-heading text-2xl font-black text-green-800">
                    <CircleCheck className="size-6" strokeWidth={1.75} aria-hidden="true" />
                    All on your desk
                  </p>
                  {openDeskLink(true)}
                </>
              )}
            </>
          )}

          {state.kind === "nothing" && !feedback && !steps.length && (
            <p role="status" className="text-center text-base font-semibold text-muted-foreground">{state.text}</p>
          )}

          {refreshing && (
            <p className="flex items-center justify-center gap-1.5 text-xs text-muted-foreground">
              <LoaderCircle className="size-3.5 animate-spin motion-reduce:animate-none" strokeWidth={1.75} aria-hidden="true" />
              Updating
            </p>
          )}
        </section>

        <div className="min-w-0 [grid-area:more]">{personMore}</div>
      </div>

      <div className="mt-6 flex flex-col gap-6">
        {shown.map((g) => {
          const doneIds = doneAllIds(g.cards);
          const asking = confirmGroup === g.key && !!doneIds;
          return (
            <section key={g.key} aria-labelledby={`open-group-${g.key}`}>
              <div className="mb-3 flex flex-wrap items-end justify-between gap-x-4 gap-y-2">
                <div className="min-w-0">
                  <h2 id={`open-group-${g.key}`} className="font-heading text-xl font-black text-foreground break-words">{g.title}</h2>
                  {g.subtitle && (
                    <p className={`text-sm font-semibold ${g.overdue ? "text-red-700" : "text-muted-foreground"}`}>
                      {g.subtitle}
                      {g.overdue && <span className="ml-2 rounded-full bg-red-600 px-2 py-0.5 text-xs font-bold text-white">Overdue</span>}
                    </p>
                  )}
                </div>
                {doneIds && !asking && (
                  <button
                    type="button"
                    onClick={() => setConfirmGroup(g.key)}
                    disabled={busy}
                    className={`${smallButton} w-full border-2 border-green-700 bg-white text-green-800 hover:bg-green-50 sm:w-auto`}
                  >
                    <PackageCheck className="size-4" strokeWidth={1.75} aria-hidden="true" />
                    {doneAllLabel(doneIds.length)}
                  </button>
                )}
              </div>
              {asking && doneIds && (
                <div role="group" aria-label={doneAllQuestion(doneIds.length)} className="mb-3 rounded-xl border-2 border-green-600 bg-green-50 p-3 sm:p-4">
                  <p className="font-heading text-xl font-black text-green-950">{doneAllQuestion(doneIds.length)}</p>
                  <p className="mt-0.5 text-sm text-green-900">Each goes back in its bag.</p>
                  <div className="mt-3 grid grid-cols-2 gap-2 sm:flex">
                    <button
                      type="button"
                      onClick={() => void finish(doneIds, true)}
                      disabled={busy}
                      className={`${smallButton} bg-green-700 text-white hover:bg-green-800`}
                    >
                      {pending?.kind === "done" && pending.all ? (
                        <>
                          <LoaderCircle className="size-4 animate-spin motion-reduce:animate-none" strokeWidth={1.75} aria-hidden="true" />
                          Saving…
                        </>
                      ) : `Yes, mark ${doneIds.length} done`}
                    </button>
                    <button type="button" onClick={() => setConfirmGroup(null)} disabled={busy} className={`${smallButton} border border-border bg-white text-foreground hover:border-primary/50`}>
                      Cancel
                    </button>
                  </div>
                </div>
              )}
              <ul aria-label="Cards" className="grid grid-cols-1 gap-4 md:grid-cols-2">
                {g.cards.map((c) => (
                  <OpenCardPanel
                    key={c.id}
                    card={c}
                    deskId={deskId}
                    pending={pending?.ids.has(c.id) && pending.kind !== "bin" ? pending.kind : null}
                    busy={busy}
                    note={cardNotes[c.id] ?? null}
                    eager={c.id === firstId}
                    onMove={() => void move([c.id], false)}
                    onDone={() => void finish([c.id], false)}
                  />
                ))}
              </ul>
            </section>
          );
        })}
      </div>
    </>
  );
}

/** "Bag finished: put it in the Ready to ship bin" and the button that records it; once there, a green line. */
function BagStepBox({ step, title, saving, busy, error, onBin }: {
  step: BagStep;
  title: string;
  saving: boolean;
  busy: boolean;
  error: string | null;
  onBin: () => void;
}) {
  return (
    <div className={`rounded-2xl border-2 p-4 ${step.inBin ? "border-green-300 bg-green-50" : "border-green-700 bg-green-50"}`}>
      {step.inBin ? (
        <p role="status" className="flex items-center gap-2 font-heading text-2xl font-black leading-tight text-green-900">
          <CircleCheck className="size-6 shrink-0" strokeWidth={1.75} aria-hidden="true" />
          <span className="min-w-0 break-words">{IN_BIN_TEXT}</span>
        </p>
      ) : (
        <h3 className="font-heading text-2xl font-black leading-tight text-green-950 break-words">{title}</h3>
      )}
      <p className="mt-1 text-sm font-semibold text-green-900">
        <span className="font-mono">{step.code}</span> · {step.total} of {step.total} done
      </p>
      {!step.inBin && (
        <button type="button" onClick={onBin} disabled={busy} className={`${bigButton} mt-3 bg-green-700 text-white hover:bg-green-800`}>
          {saving && <LoaderCircle className="size-5 animate-spin motion-reduce:animate-none" strokeWidth={1.75} aria-hidden="true" />}
          {saving ? "Saving…" : BIN_BUTTON}
        </button>
      )}
      {error && <p role="alert" className="mt-2 rounded-lg border border-red-300 bg-red-50 px-3 py-2 text-sm font-semibold text-red-800 break-words">{error}</p>}
    </div>
  );
}

function FeedbackBox({ feedback, boxRef }: { feedback: Feedback; boxRef: React.RefObject<HTMLDivElement | null> }) {
  const tone = feedback.tone === "ok"
    ? { box: "border-green-300 bg-green-50 text-green-950", Icon: CircleCheck }
    : feedback.tone === "warn"
      ? { box: "border-amber-300 bg-amber-50 text-amber-950", Icon: TriangleAlert }
      : { box: "border-red-300 bg-red-50 text-red-950", Icon: CircleAlert };
  const { Icon } = tone;
  return (
    <div ref={boxRef} tabIndex={-1} role={feedback.tone === "error" ? "alert" : "status"} className={`rounded-xl border px-4 py-3 outline-none ${tone.box}`}>
      <p className="flex items-start gap-2 font-heading text-xl font-black leading-tight">
        <Icon className="mt-0.5 size-6 shrink-0" strokeWidth={1.75} aria-hidden="true" />
        <span className="min-w-0 break-words">{feedback.title}</span>
      </p>
      {feedback.next && <p className="mt-1.5 text-base font-bold break-words">{feedback.next}</p>}
      {feedback.notes.map((n) => <ToneNote key={n.text} line={n} />)}
      {feedback.failedTitle && <p className="mt-1 text-sm font-bold">{feedback.failedTitle}</p>}
      {feedback.failed.length > 0 && (
        <ul className="mt-1 max-h-48 overflow-y-auto overscroll-contain text-sm">
          {feedback.failed.map((f) => (
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
