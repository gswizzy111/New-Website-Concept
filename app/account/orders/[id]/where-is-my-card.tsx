"use client";

import { useState } from "react";

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

export function WhereIsMyCard({
  orderId,
  email,
  askedAt: initialAskedAt,
  lastReply,
}: {
  orderId: string;
  email: string;
  // When the customer's unanswered question was sent, if there is one.
  askedAt: string | null;
  // Our most recent emailed answer for this order.
  lastReply: { body: string; at: string } | null;
}) {
  const [askedAt, setAskedAt] = useState(initialAskedAt);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");

  async function ask() {
    setError("");
    setSending(true);
    try {
      const res = await fetch(`/api/account/orders/${orderId}/inquiry`, { method: "POST" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error ?? "Something went wrong. Please try again.");
      } else {
        setAskedAt(data.askedAt ?? new Date().toISOString());
      }
    } catch {
      setError("Network error. Please try again.");
    }
    setSending(false);
  }

  return (
    <div className="bg-white rounded-xl border border-border p-5">
      <h2 className="font-heading font-black text-sm uppercase tracking-wide text-muted-foreground mb-3">Card Update</h2>

      {lastReply && (
        <div className="mb-4 p-4 bg-secondary/40 rounded-lg">
          <p className="rx-label text-rx mb-2">Latest update · {formatDate(lastReply.at)}</p>
          <p className="text-sm text-foreground whitespace-pre-wrap">{lastReply.body}</p>
        </div>
      )}

      {askedAt ? (
        <div role="status" className="rounded-lg border border-rx/30 bg-rx-soft px-4 py-3">
          <p className="text-sm font-bold text-foreground">Question sent {formatDate(askedAt)}</p>
          <p className="text-xs text-muted-foreground mt-1">
            We&apos;ll email an update to <span className="font-semibold text-foreground [overflow-wrap:anywhere]">{email}</span>. We reply within 1 business day.
          </p>
        </div>
      ) : (
        <>
          <p className="text-xs text-muted-foreground mb-3">
            Wondering how your card is doing? Ask us and we&apos;ll email you an update.
          </p>
          <button
            type="button"
            onClick={ask}
            disabled={sending}
            className="w-full h-11 bg-primary text-primary-foreground text-sm font-bold rounded-lg hover:bg-primary/90 transition-colors disabled:opacity-60"
          >
            {sending ? "Sending..." : "Where's my card?"}
          </button>
          {error && <p role="alert" className="text-xs text-red-700 mt-2">{error}</p>}
        </>
      )}
    </div>
  );
}
