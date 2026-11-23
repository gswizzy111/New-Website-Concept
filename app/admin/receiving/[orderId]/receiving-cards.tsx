"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { AdminLink } from "@/components/admin-ui/admin-link";
import { CardPhotoCapture, EnlargeablePhoto, captureButtonId } from "@/components/intake/card-photo-capture";
import type { WorkspaceCard } from "./types";
import { UNPAID_CONFIRM, type PaymentState } from "../_components/payment";

const TIER_OPTIONS = [
  { value: "prep", label: "Prep" },
  { value: "regular", label: "Bronze restoration" },
  { value: "expedited", label: "Silver restoration" },
  { value: "premium", label: "Gold restoration" },
  { value: "ultra_premium", label: "Platinum restoration" },
  { value: "elite", label: "Diamond restoration" },
  { value: "fast_pass", label: "Fast Pass restoration" },
] as const;

const EARLIEST_DAY = "2020-01-01";

/** "Card 3" (or the name when the card has no number yet) for messages and screen readers. */
function cardLabel(c: WorkspaceCard) {
  return c.seq ? `Card ${c.seq}, ${c.name}` : c.name;
}

/** "Nov 15, 2026" for a stored day. */
function dayText(day: string | null) {
  if (!day) return "—";
  return new Date(`${day}T12:00:00Z`).toLocaleDateString("en-US", { timeZone: "UTC", month: "short", day: "numeric", year: "numeric" });
}

/**
 * The order's cards on the receiving workspace: tick the ones that arrived,
 * photograph them, then "Receive selected cards" (with the date they arrived,
 * today by default, earlier for historical entries). Each card also has its
 * tier, info corrections and "Mark not received" for a mistake.
 */
export function ReceivingCards({ orderId, orderStatus, today, defaultReceivedOn, cards, maxPhotos, canReceive: schemaReady, payment }: {
  orderId: string;
  /** orders.status: receiving only moves Awaiting Cards on, so others are explained after receiving */
  orderStatus: string;
  /** Paid, not paid (receiving asks to confirm) or refunded (no receiving) */
  payment: PaymentState;
  /** Today in New York, YYYY-MM-DD */
  today: string;
  /** The "Received on" date to start from: today, or the order's real earlier received day (marked received before Receiving existed) */
  defaultReceivedOn?: string;
  cards: WorkspaceCard[];
  maxPhotos: number;
  /** False when the intake database update isn't applied yet */
  canReceive: boolean;
}) {
  const router = useRouter();
  // A refunded order can't be received at all
  const canReceive = schemaReady && payment !== "refunded";
  // A card already in a bag (historical setup, no received date yet) is here: its bag's date is entered instead
  const receivable = cards.filter((c) => !c.refunded && !c.receivedAt && !c.bagId);
  const [selected, setSelected] = useState<Set<string>>(() => new Set());
  const [receivedOn, setReceivedOn] = useState(defaultReceivedOn && defaultReceivedOn <= today ? defaultReceivedOn : today);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ kind: "ok" | "error"; text: string } | null>(null);

  // Only cards that can still be received stay selected (after a refresh, say)
  const chosen = receivable.filter((c) => selected.has(c.id));
  const allChosen = receivable.length > 0 && chosen.length === receivable.length;

  function toggle(id: string, on: boolean) {
    setSelected((s) => {
      const next = new Set(s);
      if (on) next.add(id);
      else next.delete(id);
      return next;
    });
  }

  async function receive() {
    setMessage(null);
    if (!chosen.length) return;
    const noTier = chosen.filter((c) => !c.tier);
    if (noTier.length) {
      setMessage({ kind: "error", text: `Pick a tier first for ${noTier.map(cardLabel).join("; ")}.` });
      return;
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(receivedOn) || receivedOn > today || receivedOn < EARLIEST_DAY) {
      setMessage({ kind: "error", text: "Enter the day the cards arrived (today or earlier)." });
      return;
    }
    if (payment === "unpaid" && !confirm(UNPAID_CONFIRM)) return;
    setBusy(true);
    const res = await fetch(`/api/admin/intake/orders/${orderId}/receive`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ cardIds: chosen.map((c) => c.id), receivedOn, ...(payment === "unpaid" ? { allowUnpaid: true } : {}) }),
    }).catch(() => null);
    const data = res ? await res.json().catch(() => ({})) : {};
    setBusy(false);
    if (!res || !res.ok) {
      setMessage({ kind: "error", text: data.error ?? (res ? `Couldn't receive the cards (${res.status}).` : "Network error. Reload the page to see whether the cards were received.") });
      if (res?.status === 409 && !data.unpaid) router.refresh(); // someone else changed the order meanwhile
      return;
    }
    setSelected(new Set());
    const received = Array.isArray(data.receivedCardIds) ? data.receivedCardIds.length : chosen.length;
    if (!received) {
      // A second tap, or another device got there first
      setMessage({ kind: "ok", text: "Those cards were already received. Nothing changed." });
      router.refresh();
      return;
    }
    const summary = typeof data.summary === "string" && data.summary ? data.summary : `Received ${received} card${received === 1 ? "" : "s"}`;
    const status = data.orderStatusChanged
      ? data.emailFailed
        ? " The order is now Cards Received, but the customer email didn't send."
        : " The order is now Cards Received and the customer was emailed."
      : orderStatus === "awaiting_payment"
        ? " The order's status wasn't changed (it is still Awaiting Payment)."
        : "";
    setMessage({ kind: "ok", text: `${summary}.${status}`.replace(/\.\.(\s|$)/, ".$1") });
    // Bags, Card IDs and due dates appear at once
    router.refresh();
  }

  const active = cards.filter((c) => !c.refunded);
  const nextButton = (i: number) => {
    const next = active.slice(i + 1).find((c) => c.receivingPhotos.length < maxPhotos);
    return next ? captureButtonId(next.id) : undefined;
  };

  return (
    <div className="flex flex-col gap-3">
      {receivable.length > 0 && canReceive && (
        <label className="flex items-center gap-3 min-h-11 px-1 text-sm font-bold text-foreground cursor-pointer select-none w-fit">
          <input
            type="checkbox"
            checked={allChosen}
            onChange={(e) => setSelected(e.target.checked ? new Set(receivable.map((c) => c.id)) : new Set())}
            className="w-6 h-6 accent-primary"
          />
          Select all {receivable.length} not received
        </label>
      )}

      <ol className="flex flex-col gap-3">
        {cards.map((c) => (
          <CardRow
            key={c.id}
            card={c}
            orderId={orderId}
            checked={selected.has(c.id)}
            onCheck={(on) => toggle(c.id, on)}
            canReceive={canReceive}
            canPhoto={schemaReady}
            maxPhotos={maxPhotos}
            nextButtonId={c.refunded ? undefined : nextButton(active.indexOf(c))}
            lastReceived={!!c.receivedAt && active.filter((x) => x.receivedAt).length === 1}
          />
        ))}
      </ol>

      {/* Stays in view while scrolling the cards; the result of the last receive shows here too */}
      {((receivable.length > 0 && canReceive) || message) && (
        <div className="sticky bottom-0 z-10 -mx-4 sm:mx-0 border-t sm:border border-border bg-white/95 backdrop-blur sm:rounded-xl px-4 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] shadow-[0_-4px_16px_rgba(0,0,0,0.06)] flex flex-col gap-2">
          {message && (
            <div role={message.kind === "error" ? "alert" : "status"} className={`flex items-start justify-between gap-2 rounded-lg pl-3 text-sm font-semibold ${message.kind === "error" ? "bg-red-50 text-red-700 border border-red-200" : "bg-green-50 text-green-800 border border-green-200"}`}>
              <p className="py-2">{message.text}</p>
              <button type="button" onClick={() => setMessage(null)} className="shrink-0 min-h-11 min-w-11 text-lg leading-none" aria-label="Dismiss message">×</button>
            </div>
          )}
          {receivable.length > 0 && canReceive && (
            <div className="flex flex-col sm:flex-row sm:items-end gap-3">
              <label className="flex flex-col gap-1 text-xs font-bold uppercase tracking-widest text-muted-foreground">
                Received on
                <input
                  type="date"
                  value={receivedOn}
                  min={EARLIEST_DAY}
                  max={today}
                  onChange={(e) => setReceivedOn(e.target.value)}
                  className="h-11 px-3 rounded-lg border border-border bg-white text-base sm:text-sm font-semibold text-foreground normal-case tracking-normal"
                />
              </label>
              <button
                type="button"
                onClick={receive}
                disabled={busy || chosen.length === 0}
                className="flex-1 min-h-12 px-5 rounded-lg bg-primary text-primary-foreground text-base font-black hover:bg-primary/90 disabled:opacity-50 transition-colors"
              >
                {busy ? "Receiving…" : chosen.length ? `Receive selected cards (${chosen.length})` : "Receive selected cards"}
              </button>
              {payment === "unpaid" && (
                <p className="text-xs font-black text-red-700 sm:self-center">Not paid: you&apos;ll be asked to confirm.</p>
              )}
              {receivedOn !== today && (
                <p className="text-xs font-semibold text-amber-700 sm:self-center">Backdated: due dates count from {dayText(receivedOn)}.</p>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function CardRow({ card: c, orderId, checked, onCheck, canReceive, canPhoto, maxPhotos, nextButtonId, lastReceived = false }: {
  card: WorkspaceCard; orderId: string; checked: boolean; onCheck: (on: boolean) => void;
  canReceive: boolean; canPhoto: boolean; maxPhotos: number; nextButtonId?: string;
  /** The order's only received card: undoing it doesn't change the order's status */
  lastReceived?: boolean;
}) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const label = cardLabel(c);
  const receivable = !c.refunded && !c.receivedAt && !c.bagId;

  async function unreceive() {
    const statusNote = lastReceived ? " It's the only card received, but the order keeps its status: set it back on the order page if no cards are here." : "";
    if (!confirm(`Mark ${label} as not received? It comes out of its bag ${c.bagCode ?? ""} and goes back to waiting.${statusNote}`)) return;
    setBusy(true);
    setError("");
    const res = await fetch(`/api/admin/intake/orders/${orderId}/unreceive`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ cardId: c.id }),
    }).catch(() => null);
    const data = res ? await res.json().catch(() => ({})) : {};
    setBusy(false);
    if (!res || !res.ok) setError(data.error ?? "Couldn't undo receiving.");
    else router.refresh();
  }

  async function setTier(tier: string) {
    if (!tier) return;
    const name = TIER_OPTIONS.find((o) => o.value === tier)?.label ?? tier;
    if (c.tier && !confirm(`Switch ${label} to ${name}? The price and payment stay the same, and the customer isn't emailed.`)) return;
    setBusy(true);
    setError("");
    const res = await fetch(`/api/admin/cards/${c.id}/tier`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ tier }),
    }).catch(() => null);
    const data = res ? await res.json().catch(() => ({})) : {};
    setBusy(false);
    if (!res || !res.ok) setError(data.error ?? "Couldn't change the tier.");
    else router.refresh();
  }

  const statusChip = c.refunded
    ? { text: "Refunded", cls: "bg-gray-100 text-gray-500" }
    : c.receivedAt
      ? { text: `Received ${dayText(c.receivedOn)}`, cls: "bg-green-100 text-green-700" }
      : c.bagId
        ? c.receivedOn
          ? { text: `Received ${dayText(c.receivedOn)}`, cls: "bg-green-100 text-green-700" }
          : { text: "In a bag, received date missing", cls: "bg-red-100 text-red-700" }
      : c.awaitingArrival
        ? { text: "On the way", cls: "bg-amber-100 text-amber-700" }
        : { text: "Not received", cls: "bg-gray-100 text-gray-600" };

  return (
    <li id={`card-${c.id}`} className={`scroll-mt-24 rounded-xl border bg-white p-4 transition-colors ${checked ? "border-primary ring-1 ring-primary/40" : "border-border"} ${c.refunded ? "opacity-60" : ""}`}>
      <div className="flex items-start gap-3">
        {receivable && canReceive ? (
          <label className="flex flex-col items-center gap-0.5 shrink-0 cursor-pointer select-none min-w-11 pt-0.5">
            <input type="checkbox" checked={checked} onChange={(e) => onCheck(e.target.checked)} className="w-7 h-7 accent-primary" aria-label={`Arrived: ${label}`} />
            <span className="text-[10px] font-bold uppercase tracking-wide text-muted-foreground">Arrived</span>
          </label>
        ) : (
          <span className="shrink-0 min-w-11 flex justify-center pt-1" aria-hidden="true">
            <span className={`w-7 h-7 rounded-md flex items-center justify-center ${c.receivedAt || c.bagId ? "bg-green-600 text-white" : "bg-gray-100"}`}>
              {(c.receivedAt || c.bagId) && (
                <svg viewBox="0 0 10 8" fill="none" className="w-3.5 h-3.5"><path d="M1 4l3 3 5-6" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" /></svg>
              )}
            </span>
          </span>
        )}

        <div className="flex-1 min-w-0">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <span className="font-heading font-black text-foreground">{c.seq ? `Card ${c.seq}` : "Card"}</span>
            <span className={`text-xs font-bold ${c.code ? "text-foreground" : "text-muted-foreground"}`}>{c.code ?? "No ID yet"}</span>
            <span className={`text-xs font-bold px-2 py-0.5 rounded-full ${statusChip.cls}`}>{statusChip.text}</span>
            {c.completed && <span className="text-xs font-bold px-2 py-0.5 rounded-full bg-green-100 text-green-700">Done</span>}
          </div>
          <p className="mt-1 font-semibold text-foreground break-words">{c.name}</p>
          <p className="text-sm text-muted-foreground">
            {[c.set, c.number ? `#${c.number}` : null, c.year].filter(Boolean).join(" · ") || "No set or number given"}
          </p>

          {/* Tier */}
          <div className="mt-2 flex flex-wrap items-center gap-2">
            {!c.refunded && !c.bagId ? (
              <label className="flex items-center gap-2 text-xs font-bold text-muted-foreground">
                Tier
                <select
                  value={c.tier ?? ""}
                  onChange={(e) => setTier(e.target.value)}
                  disabled={busy}
                  className={`h-11 rounded-lg border px-2 text-sm font-semibold text-foreground bg-white disabled:opacity-50 ${c.missingTier ? "border-red-400 ring-1 ring-red-200" : "border-border"}`}
                >
                  {!c.tier && <option value="">Pick a tier…</option>}
                  {TIER_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                </select>
                {c.tier && !c.ownTier && <span className="font-medium">(the order&apos;s tier)</span>}
              </label>
            ) : (
              <span className="text-xs font-bold px-2 py-1 rounded-full bg-secondary text-foreground">{c.tierName}</span>
            )}
            {c.missingTier && !c.refunded && <span className="text-xs font-bold px-2 py-0.5 rounded-full bg-red-100 text-red-700">Missing tier</span>}
          </div>

          {(c.notes || c.knownDefects) && (
            <div className="mt-2 rounded-lg bg-amber-50 border border-amber-200 px-3 py-2 text-sm text-amber-900">
              {c.notes && <p><span className="font-bold">Customer note:</span> {c.notes}</p>}
              {c.knownDefects && <p><span className="font-bold">Known defects:</span> {c.knownDefects}</p>}
            </div>
          )}

          {/* Photos: the customer's (read only) and receiving photos (separate) */}
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            <div>
              <p className="text-[11px] font-bold uppercase tracking-widest text-muted-foreground mb-1.5">Customer photos</p>
              {c.customerPhotos.length || c.referencePhoto ? (
                <div className="flex flex-wrap gap-2">
                  {c.customerPhotos.map((p, i) => (
                    <EnlargeablePhoto key={p.url} url={p.url} thumb={p.thumb} alt={`Customer photo ${i + 1} of ${label}`} />
                  ))}
                  {c.referencePhoto && (
                    <div className="flex flex-col items-center gap-0.5">
                      <EnlargeablePhoto url={c.referencePhoto} alt={`Reference photo from the card catalog (not the customer's card) for ${label}`} caption="Reference photo from the card catalog, not the customer's card" />
                      <span className="text-[9px] font-bold uppercase tracking-wide text-muted-foreground leading-none">Reference</span>
                    </div>
                  )}
                </div>
              ) : (
                <p className="text-xs text-muted-foreground">None uploaded.</p>
              )}
            </div>
            {!c.refunded && (
              <div>
                <p className="text-[11px] font-bold uppercase tracking-widest text-muted-foreground mb-1.5">
                  Receiving photos {c.missingImage && <span className="ml-1 normal-case tracking-normal px-2 py-0.5 rounded-full bg-red-100 text-red-700">Missing image</span>}
                </p>
                {canPhoto ? (
                  <CardPhotoCapture cardId={c.id} cardLabel={label} photos={c.receivingPhotos} thumbs={c.receivingThumbs} max={maxPhotos} nextButtonId={nextButtonId} />
                ) : (
                  <p className="text-xs text-muted-foreground">Available once the intake database update is applied.</p>
                )}
              </div>
            )}
          </div>

          {/* Where the card is now */}
          {(c.bagId || c.receivedAt) && (
            <dl className="mt-3 grid grid-cols-2 sm:grid-cols-4 gap-x-4 gap-y-1 text-sm">
              <div><dt className="text-[11px] font-bold uppercase tracking-widest text-muted-foreground">Received</dt><dd className="font-semibold text-foreground">{dayText(c.receivedOn)}{c.receivedBy ? <span className="block text-xs font-normal text-muted-foreground">by {c.receivedBy}</span> : null}</dd></div>
              <div><dt className="text-[11px] font-bold uppercase tracking-widest text-muted-foreground">Bag</dt><dd>{c.bagId ? <AdminLink href={`/admin/receiving/bag/${c.bagId}`} className="font-bold text-primary hover:underline">{c.bagCode}</AdminLink> : <span className="text-muted-foreground">—</span>}</dd></div>
              <div><dt className="text-[11px] font-bold uppercase tracking-widest text-muted-foreground">Step</dt><dd className="font-semibold text-foreground">{c.round > 1 ? `Round ${c.round}: ` : ""}{c.stageLabel}</dd></div>
              <div><dt className="text-[11px] font-bold uppercase tracking-widest text-muted-foreground">Card page</dt><dd><AdminLink href={`/admin/receiving/card/${c.id}`} className="font-bold text-primary hover:underline">Open</AdminLink></dd></div>
            </dl>
          )}

          <div className="mt-3 flex flex-wrap gap-2">
            {!c.refunded && (
              <button type="button" onClick={() => setEditing((e) => !e)} className="min-h-11 px-3 rounded-lg border border-border bg-white text-sm font-bold text-foreground hover:border-primary/50" aria-expanded={editing}>
                {editing ? "Close" : "Correct card info"}
              </button>
            )}
            {c.receivedAt && !c.started && !c.refunded && canPhoto && (
              <button type="button" onClick={unreceive} disabled={busy} className="min-h-11 px-3 rounded-lg border border-border bg-white text-sm font-bold text-red-600 hover:border-red-300 disabled:opacity-50">
                Mark not received
              </button>
            )}
          </div>
          {editing && <CardInfoEditor card={c} onDone={() => setEditing(false)} />}
          {error && <p role="alert" className="mt-2 text-sm font-semibold text-red-600">{error}</p>}
        </div>
      </div>
    </li>
  );
}

/** Correct the card's name, set, number and year (PATCH /api/admin/cards/[id], which keeps the customer's original). */
function CardInfoEditor({ card, onDone }: { card: WorkspaceCard; onDone: () => void }) {
  const router = useRouter();
  const [name, setName] = useState(card.name);
  const [set, setSet] = useState(card.set ?? "");
  const [number, setNumber] = useState(card.number ?? "");
  const [year, setYear] = useState(card.year ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) {
      setError("The card needs a name.");
      return;
    }
    setBusy(true);
    setError("");
    const res = await fetch(`/api/admin/cards/${card.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        card_name: name.trim(),
        card_set: set.trim() || null,
        card_number: number.trim() || null,
        card_year: year.trim() || null,
      }),
    }).catch(() => null);
    const data = res ? await res.json().catch(() => ({})) : {};
    setBusy(false);
    if (!res || !res.ok) {
      setError(data.error ?? "Couldn't save.");
      return;
    }
    onDone();
    router.refresh();
  }

  const field = "h-11 px-3 rounded-lg border border-border bg-white text-base sm:text-sm w-full";
  return (
    <form onSubmit={save} className="mt-3 rounded-xl border border-border bg-secondary/30 p-3 grid gap-2 sm:grid-cols-2">
      <label className="flex flex-col gap-1 text-xs font-bold text-muted-foreground sm:col-span-2">Card name<input value={name} onChange={(e) => setName(e.target.value)} className={field} maxLength={200} required /></label>
      <label className="flex flex-col gap-1 text-xs font-bold text-muted-foreground">Set<input value={set} onChange={(e) => setSet(e.target.value)} className={field} maxLength={200} /></label>
      <label className="flex flex-col gap-1 text-xs font-bold text-muted-foreground">Card number<input value={number} onChange={(e) => setNumber(e.target.value)} className={field} maxLength={40} /></label>
      <label className="flex flex-col gap-1 text-xs font-bold text-muted-foreground">Year<input value={year} onChange={(e) => setYear(e.target.value)} className={field} maxLength={20} inputMode="numeric" /></label>
      <div className="flex items-end gap-2">
        <button type="submit" disabled={busy} className="min-h-11 px-4 rounded-lg bg-primary text-primary-foreground text-sm font-bold disabled:opacity-50">{busy ? "Saving…" : "Save"}</button>
        <button type="button" onClick={onDone} className="min-h-11 px-4 rounded-lg border border-border bg-white text-sm font-bold">Cancel</button>
      </div>
      <p className="text-xs text-muted-foreground sm:col-span-2">The customer&apos;s original details stay saved on the order page.</p>
      {error && <p role="alert" className="text-sm font-semibold text-red-600 sm:col-span-2">{error}</p>}
    </form>
  );
}
