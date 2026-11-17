"use client";

import { useState } from "react";
import { PANEL, PANEL_LABEL } from "./portal";
import { cta } from "@/components/brand";

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

/**
 * "Request an update" on an order page in the customer's account: our latest
 * emailed answer, then either the pending request, the date they can ask
 * again (once a week), or the button.
 */
export function UpdateRequestPanel({
  endpoint,
  email,
  askedAt: initialAskedAt,
  nextAllowedAt: initialNextAllowedAt,
  lastReply,
  subject = "order",
}: {
  endpoint: string;
  email: string;
  askedAt: string | null;
  nextAllowedAt: string | null;
  lastReply: { body: string; at: string } | null;
  subject?: string;
}) {
  const [askedAt, setAskedAt] = useState(initialAskedAt);
  const [nextAllowedAt, setNextAllowedAt] = useState(initialNextAllowedAt);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");

  async function ask() {
    setError("");
    setSending(true);
    try {
      const res = await fetch(endpoint, { method: "POST" });
      const data = await res.json().catch(() => ({}));
      if (data.nextAllowedAt) setNextAllowedAt(data.nextAllowedAt);
      if (!res.ok) setError(data.error ?? "Something went wrong. Please try again.");
      else setAskedAt(data.askedAt ?? new Date().toISOString());
    } catch {
      setError("Network error. Please try again.");
    }
    setSending(false);
  }

  return (
    <div id="update" className={`${PANEL} scroll-mt-24`}>
      <h2 className={`${PANEL_LABEL} mb-3`}>Request an Update</h2>

      {lastReply && (
        <div className="mb-4 rounded-[14px] bg-sun-tint p-4">
          <p className="label-caps mb-2 text-[14px] text-ink">Latest update · {formatDate(lastReply.at)}</p>
          <p className="text-sm text-foreground whitespace-pre-wrap">{lastReply.body}</p>
        </div>
      )}

      {askedAt ? (
        <div role="status" className="rounded-[14px] bg-cobalt-wash px-4 py-3">
          <p className="text-sm font-bold text-foreground">Update requested {formatDate(askedAt)}</p>
          <p className="text-xs text-muted-foreground mt-1">
            We&apos;ll email an update to <span className="font-semibold text-foreground [overflow-wrap:anywhere]">{email}</span>. We reply within 1 business day.
          </p>
        </div>
      ) : nextAllowedAt ? (
        <div role="status" className="rounded-[14px] bg-chalk px-4 py-3">
          <p className="text-sm font-bold text-foreground">You can request another update on {formatDate(nextAllowedAt)}</p>
          <p className="text-xs text-muted-foreground mt-1">Updates can be requested once a week per order.</p>
        </div>
      ) : (
        <>
          <p className="text-xs text-muted-foreground mb-3">
            Wondering how your {subject}{" "}is doing? Request an update and we&apos;ll email you. You can do this once a week.
          </p>
          <button
            type="button"
            onClick={ask}
            disabled={sending}
            className={cta({ tone: "ink", size: "sm", className: "w-full" })}
          >
            {sending ? "Sending..." : "Request an update"}
          </button>
        </>
      )}
      {error && <p role="alert" className="text-xs text-destructive mt-2">{error}</p>}
    </div>
  );
}
