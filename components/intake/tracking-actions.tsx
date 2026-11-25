"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { DONE_TARGET, pickerChips, pickerNeedsConfirm, pickerOutcome, pickerRequest, type PickerCard } from "@/lib/intake/step-picker";

// The buttons of the card, bag and Completed pages and the Bags board
// (/admin/receiving/card, /bag, /completed, /bags). Each one saves, then
// refreshes the page's server data.

async function post(url: string, body: unknown, method = "POST") {
  const res = await fetch(url, {
    method,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body ?? {}),
  });
  const data = await res.json().catch(() => ({}));
  return { ok: res.ok, data };
}

const focusRing = "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary";

const CHIP_TONE = {
  current: "bg-purple-600 border-purple-600 text-white",
  currentDone: "bg-green-600 border-green-600 text-white",
  reached: "bg-purple-50 border-purple-200 text-purple-900 hover:border-purple-400",
  open: "bg-white border-border text-foreground hover:border-primary/50",
  done: "bg-white border-green-300 text-green-800 hover:border-green-500",
} as const;

/**
 * The step picker: all 8 steps and Done as buttons in order, the current one
 * highlighted; one tap puts the cards at that step, in any order (skip ahead,
 * go back; POST /api/admin/intake/stages with `toStage`). `cards`: the cards
 * it sets, each with the step the page shows (a card someone else moved
 * meanwhile is left alone and reported). Done for several cards asks once
 * more. `collapsed`: behind a disclosure whose summary reads that text
 * (bag rows, groups, the Bags board). `reached`: one card's steps reached
 * this round, marked with a check.
 */
export function StepPicker({
  orderId,
  cards,
  label,
  reached = [],
  disabled = false,
  collapsed,
}: {
  orderId: string;
  cards: PickerCard[];
  /** Accessible name of the group, e.g. "Step for Charizard", "Step for every card in this bag". */
  label: string;
  reached?: string[];
  disabled?: boolean;
  collapsed?: string;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState("");
  const [outcome, setOutcome] = useState<{ tone: "ok" | "warn"; text: string } | null>(null);
  const chips = pickerChips(cards, reached);
  const several = cards.length > 1;
  const open = cards.filter((c) => !c.completed).length;

  // Done for several cards waits for "Yes, mark done" (a second tap on Done doesn't count)
  async function pick(target: string, confirmed = false) {
    setError("");
    setOutcome(null);
    if (pickerNeedsConfirm(target, cards) && !confirmed) {
      setConfirming(true);
      return;
    }
    setConfirming(false);
    const body = pickerRequest(orderId, cards, target);
    if (!body) return;
    setBusy(target);
    try {
      const { ok, data } = await post("/api/admin/intake/stages", body);
      if (!ok) {
        setError(data.error ?? "Nothing was changed. Try again.");
        return;
      }
      setOutcome(pickerOutcome(target, body.cardIds.length, data));
      router.refresh();
    } catch {
      setError("Network error. Reload to check what was saved.");
    } finally {
      setBusy(null);
    }
  }

  const picker = (
    <div>
      <div className="flex flex-col gap-2">
        <div role="group" aria-label={label} aria-busy={busy !== null} className="grid grid-cols-3 gap-1.5">
          {chips.map((c) => {
            const isDone = c.target === DONE_TARGET;
            const tone = c.current ? (isDone ? CHIP_TONE.currentDone : CHIP_TONE.current) : c.reached ? CHIP_TONE.reached : isDone ? CHIP_TONE.done : CHIP_TONE.open;
            return (
              <button
                key={c.target}
                type="button"
                onClick={() => pick(c.target)}
                aria-pressed={c.current}
                disabled={disabled || c.current || busy !== null || (isDone ? open === 0 : false)}
                className={`min-h-11 rounded-lg border px-2 py-1 flex items-center gap-1 text-left text-xs sm:text-[13px] leading-tight font-bold transition-colors disabled:cursor-default ${tone} ${
                  !c.current && (disabled || busy !== null) ? "opacity-50" : ""
                } ${focusRing}`}
              >
                {/* The step's number (a check once reached this round): narrow, so two-word names fit on a phone */}
                <span
                  aria-hidden
                  className={`w-3.5 shrink-0 text-center text-[11px] font-black tabular-nums ${
                    c.current ? "text-white/85" : c.reached ? "text-purple-600" : isDone ? "text-green-700" : "text-muted-foreground"
                  }`}
                >
                  {isDone || c.reached ? "✓" : c.number}
                </span>
                <span className="min-w-0 [overflow-wrap:anywhere]">
                  {busy === c.target ? "Saving…" : c.label}
                  {c.reached && <span className="sr-only"> (done this round)</span>}
                  {several && c.count > 0 && <span className="sr-only">{`, ${c.count} card${c.count === 1 ? "" : "s"} here`}</span>}
                </span>
                {several && c.count > 0 && (
                  <span aria-hidden className={`ml-auto shrink-0 text-[11px] font-black tabular-nums ${c.current ? "text-white/90" : "text-muted-foreground"}`}>
                    {c.count}
                  </span>
                )}
              </button>
            );
          })}
        </div>
        {confirming && (
          <div className="flex flex-col gap-2 rounded-lg border border-green-200 bg-green-50 p-3">
            <p className="text-sm text-green-900">Mark all {open} cards done?</p>
            <div className="flex gap-2">
              <button type="button" onClick={() => pick(DONE_TARGET, true)} disabled={busy !== null} className={`min-h-11 flex-1 rounded-lg bg-green-600 text-white text-sm font-bold hover:bg-green-700 disabled:opacity-50 ${focusRing}`}>
                {busy ? "Saving…" : "Yes, mark done"}
              </button>
              <button type="button" onClick={() => setConfirming(false)} disabled={busy !== null} className={`min-h-11 px-4 rounded-lg border border-border bg-white text-sm font-bold ${focusRing}`}>
                Cancel
              </button>
            </div>
          </div>
        )}
      </div>
      {error && <p role="alert" className="mt-2 text-sm text-red-600">{error}</p>}
      {/* Always in the page, so the line after a tap is read out */}
      <p role="status" className={outcome ? `mt-2 text-sm ${outcome.tone === "warn" ? "text-amber-700" : "text-muted-foreground"}` : "sr-only"}>{outcome?.text ?? ""}</p>
    </div>
  );

  if (!collapsed) return picker;
  return (
    <details className="group rounded-lg border border-border bg-white" onToggle={() => { setOutcome(null); setConfirming(false); }}>
      <summary className={`min-h-11 px-3 flex items-center gap-2 text-sm font-bold text-primary cursor-pointer select-none hover:bg-primary/5 rounded-lg list-none [&::-webkit-details-marker]:hidden ${focusRing}`}>
        <span aria-hidden className="text-xs transition-transform motion-reduce:transition-none group-open:rotate-90">▶</span>
        {collapsed}
      </summary>
      <div className="px-2 pb-2">{picker}</div>
    </details>
  );
}

/** Changes a bag's due date; a reason is required and kept with the change (PATCH /api/admin/intake/bags/[id]). */
export function DueDateEditor({ bagId, dueDate }: { bagId: string; dueDate: string | null }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [day, setDay] = useState(dueDate ?? "");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (!day || !reason.trim()) {
      setError("Pick the new date and say why it changed.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      const { ok, data } = await post(`/api/admin/intake/bags/${bagId}`, { dueDate: day, reason: reason.trim() }, "PATCH");
      if (!ok) {
        setError(data.error ?? "The due date wasn't saved. Try again.");
        return;
      }
      setOpen(false);
      setReason("");
      router.refresh();
    } catch {
      setError("Network error. Reload to check what was saved.");
    } finally {
      setBusy(false);
    }
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => { setOpen(true); setDay(dueDate ?? ""); setError(""); }}
        className="min-h-11 px-3 rounded-lg border border-border bg-white text-sm font-bold text-foreground hover:border-primary/40 transition-colors"
      >
        Change due date
      </button>
    );
  }

  return (
    <form onSubmit={save} className="flex flex-col gap-2 rounded-lg border border-border bg-secondary/40 p-3">
      <label className="text-xs font-bold text-muted-foreground" htmlFor={`due-${bagId}`}>New due date</label>
      <input
        id={`due-${bagId}`}
        type="date"
        value={day}
        onChange={(e) => setDay(e.target.value)}
        required
        className="min-h-11 rounded-lg border border-border bg-white px-3 text-base"
      />
      <label className="text-xs font-bold text-muted-foreground" htmlFor={`reason-${bagId}`}>Reason (required)</label>
      <textarea
        id={`reason-${bagId}`}
        value={reason}
        onChange={(e) => setReason(e.target.value)}
        required
        maxLength={500}
        rows={2}
        placeholder="e.g. Customer agreed to a later date"
        className="rounded-lg border border-border bg-white px-3 py-2 text-base"
      />
      {error && <p role="alert" className="text-sm text-red-600">{error}</p>}
      <div className="flex gap-2">
        <button type="submit" disabled={busy} className="min-h-11 flex-1 rounded-lg bg-primary text-primary-foreground text-sm font-bold disabled:opacity-50">
          {busy ? "Saving…" : "Save due date"}
        </button>
        <button type="button" onClick={() => setOpen(false)} disabled={busy} className="min-h-11 px-4 rounded-lg border border-border bg-white text-sm font-bold">
          Cancel
        </button>
      </div>
    </form>
  );
}

/** Dismisses the "bag completed" alert: the given bags, or every one ("Mark all seen"). */
export function MarkSeenButton({ bagIds, label = "Mark all seen" }: { bagIds?: string[]; label?: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function mark() {
    setBusy(true);
    setError("");
    try {
      const { ok, data } = await post("/api/admin/intake/completed/seen", bagIds ? { bagIds } : {});
      if (!ok) {
        setError(data.error ?? "Couldn't mark them seen.");
        return;
      }
      router.refresh();
    } catch {
      setError("Network error. Try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <span className="inline-flex flex-col">
      <button
        type="button"
        onClick={mark}
        disabled={busy}
        className="min-h-11 px-3 rounded-lg border border-border bg-white text-sm font-bold text-foreground hover:border-primary/40 transition-colors disabled:opacity-50"
      >
        {busy ? "Saving…" : label}
      </button>
      {error && <span role="alert" className="mt-1 text-xs text-red-600">{error}</span>}
    </span>
  );
}

/**
 * "Mark order completed", offered once every card of the order is done.
 * Goes through the order status route (POST /api/admin/orders/[id]/status),
 * which emails the customer, so it asks once more first. Never automatic.
 */
export function MarkOrderCompletedButton({ orderId, orderNumber }: { orderId: string; orderNumber: string | null }) {
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  async function complete() {
    setBusy(true);
    setError("");
    try {
      const { ok, data } = await post(`/api/admin/orders/${orderId}/status`, { status: "completed" });
      if (!ok) {
        setError(data.error ?? "The order wasn't marked completed. Try again.");
        return;
      }
      setConfirming(false);
      if (data.emailFailed) setNotice("Order completed, but the email to the customer failed.");
      router.refresh();
    } catch {
      setError("Network error. Reload to check whether it saved.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-2">
      {confirming ? (
        <div className="flex flex-col gap-2 rounded-lg border border-green-200 bg-green-50 p-3">
          <p className="text-sm text-green-900">
            Mark order {orderNumber ? `#${orderNumber}` : ""} completed? The customer is emailed that their cards are finished.
          </p>
          <div className="flex gap-2">
            <button type="button" onClick={complete} disabled={busy} className="min-h-11 flex-1 rounded-lg bg-green-600 text-white text-sm font-bold hover:bg-green-700 disabled:opacity-50">
              {busy ? "Saving…" : "Yes, mark completed"}
            </button>
            <button type="button" onClick={() => setConfirming(false)} disabled={busy} className="min-h-11 px-4 rounded-lg border border-border bg-white text-sm font-bold">
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => { setConfirming(true); setError(""); }}
          className="min-h-11 px-4 rounded-lg bg-green-600 text-white text-sm font-bold hover:bg-green-700 transition-colors"
        >
          Mark order completed
        </button>
      )}
      {error && <p role="alert" className="text-sm text-red-600">{error}</p>}
      {notice && <p role="status" className="text-sm text-amber-700">{notice}</p>}
    </div>
  );
}
