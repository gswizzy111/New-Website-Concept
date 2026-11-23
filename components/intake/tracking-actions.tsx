"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { STAGES, adminStageLabel } from "@/lib/restoration-stages";

// The buttons of the card, bag and Completed pages (/admin/receiving/card,
// /bag, /completed). Each one saves, then refreshes the page's server data.

const count = (x: unknown) => (Array.isArray(x) ? x.length : Number(x) || 0);

async function post(url: string, body: unknown, method = "POST") {
  const res = await fetch(url, {
    method,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body ?? {}),
  });
  const data = await res.json().catch(() => ({}));
  return { ok: res.ok, data };
}

/**
 * Moves cards that are at `fromStage` (null = not started) to the next step,
 * or marks them done from Final Dry (POST /api/admin/intake/stages). Cards
 * that are at another step by now are left alone and reported.
 */
export function AdvanceButton({
  orderId,
  cardIds,
  fromStage,
  label,
  size = "big",
}: {
  orderId: string;
  cardIds: string[];
  fromStage: string | null;
  label: string;
  size?: "big" | "small";
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  async function advance() {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const { ok, data } = await post("/api/admin/intake/stages", { orderId, cardIds, fromStage });
      if (!ok) {
        setError(data.error ?? "Nothing was moved. Try again.");
        return;
      }
      const skipped = count(data.skipped);
      const notes = [
        skipped > 0 ? `${skipped} card${skipped === 1 ? " was" : "s were"} already at a different step and ${skipped === 1 ? "was" : "were"} left as ${skipped === 1 ? "it was" : "they were"}.` : "",
        data.emailed === false ? "Saved, but the customer email didn't send." : "",
      ].filter(Boolean);
      if (notes.length) setNotice(notes.join(" "));
      router.refresh();
    } catch {
      setError("Network error. Reload to check what was saved.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className={size === "big" ? "w-full" : ""}>
      <button
        type="button"
        onClick={advance}
        disabled={busy || cardIds.length === 0}
        className={
          size === "big"
            ? "w-full min-h-14 px-5 rounded-xl bg-primary text-primary-foreground text-lg font-black hover:bg-primary/90 active:scale-[0.99] transition disabled:opacity-50"
            : "min-h-11 px-3 rounded-lg border border-primary/40 text-primary text-sm font-bold hover:bg-primary/5 transition-colors disabled:opacity-50"
        }
      >
        {busy ? "Saving…" : label}
      </button>
      {error && <p role="alert" className="mt-2 text-sm text-red-600">{error}</p>}
      {notice && <p role="status" className="mt-2 text-sm text-amber-700">{notice}</p>}
    </div>
  );
}

/**
 * "Set a different step": a correction through the order page's existing
 * stage route (POST /api/admin/orders/[id]/stage), which also emails the
 * customer, exactly as the order page's stage buttons do.
 */
export function StageCorrection({ orderId, cardId, currentStage }: { orderId: string; cardId: string; currentStage: string | null }) {
  const router = useRouter();
  const [stage, setStage] = useState(currentStage ?? STAGES[0]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function save() {
    setBusy(true);
    setError("");
    try {
      const { ok, data } = await post(`/api/admin/orders/${orderId}/stage`, { stage, card_id: cardId });
      if (!ok) {
        setError(data.error ?? "The step wasn't saved. Try again.");
        return;
      }
      router.refresh();
    } catch {
      setError("Network error. Reload to check what was saved.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <details className="group rounded-lg border border-border bg-white">
      <summary className="min-h-11 px-3 flex items-center text-sm font-semibold text-muted-foreground cursor-pointer select-none hover:text-foreground">
        Set a different step
      </summary>
      <div className="px-3 pb-3 flex flex-col gap-2">
        <p className="text-xs text-muted-foreground">For corrections. The customer is emailed, as with the stage buttons on the order page.</p>
        <div className="flex flex-col sm:flex-row gap-2">
          <label className="sr-only" htmlFor={`stage-${cardId}`}>Step</label>
          <select
            id={`stage-${cardId}`}
            value={stage}
            onChange={(e) => setStage(e.target.value)}
            className="min-h-11 flex-1 rounded-lg border border-border bg-white px-3 text-sm"
          >
            {STAGES.map((s, i) => (
              <option key={s} value={s}>{`${i + 1}. ${adminStageLabel(s)}`}</option>
            ))}
          </select>
          <button
            type="button"
            onClick={save}
            disabled={busy || stage === currentStage}
            className="min-h-11 px-4 rounded-lg bg-foreground text-background text-sm font-bold disabled:opacity-50"
          >
            {busy ? "Saving…" : "Save step"}
          </button>
        </div>
        {error && <p role="alert" className="text-sm text-red-600">{error}</p>}
      </div>
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
