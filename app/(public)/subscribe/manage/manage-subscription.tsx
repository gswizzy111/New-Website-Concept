"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { cn, formatCurrency } from "@/lib/utils";

// The field look: 48px tall, 12px corners, a 1.5px edge, cobalt focus.
const FIELD =
  "h-12 w-full min-w-0 rounded-[12px] border-[1.5px] border-input bg-white px-4 text-base text-ink outline-none transition-[border-color,box-shadow] duration-150 placeholder:text-ink-soft hover:border-ink-soft focus-visible:border-cobalt focus-visible:shadow-[0_0_0_4px_var(--cobalt-wash)] md:text-[15px]";

type SubResult = {
  found: boolean;
  id?: string;
  status?: string;
  created_at?: string;
  cancelled_at?: string;
  /** What this subscriber pays a month */
  price_cents?: number;
};

const LINK_EXPIRED = "This link has expired or was already used. Enter your email to get a new one.";

/**
 * Shows a Kit Club subscription and cancels it, only for someone who proved
 * the inbox: the one-time link this page emails (?token=...), or a signed-in
 * account with the same email. Typing an email only sends that link.
 */
export function ManageSubscription({ token }: { token: string }) {
  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(false);
  const [checking, setChecking] = useState(true);
  const [result, setResult] = useState<SubResult | null>(null);
  const [sentTo, setSentTo] = useState("");
  const [lookupError, setLookupError] = useState("");
  const [cancelling, setCancelling] = useState(false);
  const [cancelled, setCancelled] = useState(false);
  const [cancelError, setCancelError] = useState("");

  // Opened from the emailed link, or signed in: show the subscription
  useEffect(() => {
    let live = true;
    (async () => {
      try {
        const res = await fetch("/api/subscriptions/status", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(token ? { token } : {}),
        });
        const data = await res.json().catch(() => ({}));
        if (!live) return;
        if (data.code === "LINK_EXPIRED") setLookupError(LINK_EXPIRED);
        else if (!res.ok) { if (token) setLookupError("Something went wrong. Please try again."); }
        else if (data.found) setResult(data);
        else if (token) setLookupError("No subscription found for that email address.");
      } catch {
        if (live && token) setLookupError("Something went wrong. Please try again.");
      } finally {
        if (live) setChecking(false);
      }
    })();
    return () => { live = false; };
  }, [token]);

  async function handleLookup(e: React.FormEvent) {
    e.preventDefault();
    if (!email.trim()) return;
    setLoading(true);
    setLookupError("");
    setSentTo("");
    try {
      const res = await fetch("/api/subscriptions/lookup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: email.trim() }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) { setLookupError(data.error ?? "Something went wrong. Please try again."); return; }
      setSentTo(email.trim());
    } catch {
      setLookupError("Something went wrong. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  async function handleCancel() {
    if (!result?.id) return;
    if (!confirm("Are you sure you want to cancel your subscription? This will stop future billing immediately.")) return;
    setCancelling(true);
    setCancelError("");
    try {
      const res = await fetch("/api/subscriptions/cancel", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...(token ? { token } : {}), subscriptionId: result.id }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) { setCancelError(data.error ?? "Failed to cancel."); return; }
      setCancelled(true);
      setResult({ ...result, status: "cancelled" });
    } catch {
      setCancelError("Network error. Please try again.");
    } finally {
      setCancelling(false);
    }
  }

  function formatDate(iso: string) {
    return new Date(iso).toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" });
  }

  return (
    <div className="surface-chalk min-h-screen">
      <div className="wrap max-w-[44rem] py-14 md:py-24">
        <Link href="/" className="mb-8 inline-flex min-h-11 items-center gap-2 text-[15px] font-bold text-cobalt underline-offset-4 hover:underline">
          <ArrowLeft aria-hidden className="size-4" strokeWidth={2} />
          Back to home
        </Link>

        <h1 className="font-display text-[clamp(2.75rem,11vw,4rem)] leading-[0.9] font-black text-ink md:text-[clamp(4rem,6vw,5.25rem)]">
          Manage Your Subscription
        </h1>
        <p className="lead mt-5 text-ink-soft">Enter the email you used to subscribe. We&apos;ll email you a link to manage it.</p>

      <div className="panel mt-10 p-6 md:p-8">
        <form onSubmit={handleLookup} className="flex flex-col gap-3 sm:flex-row">
          <label htmlFor="manage-email" className="sr-only">Email</label>
          <input
            id="manage-email"
            type="email"
            autoComplete="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="your@email.com"
            required
            className={cn(FIELD, "sm:flex-1")}
          />
          <button
            type="submit"
            disabled={loading}
            className="btn btn-ink shrink-0 disabled:opacity-60"
          >
            {loading ? "…" : "Send link"}
          </button>
        </form>

        {sentTo && (
          <div role="status" className="mt-5 rounded-[14px] bg-success-tint px-4 py-3.5 text-[15px] leading-relaxed text-ink">
            If there&apos;s a subscription for <span className="font-bold [overflow-wrap:anywhere]">{sentTo}</span>, we just emailed it a link to manage it. The link expires in 1 hour. Not there in a minute? Check your Spam, Junk and Promotions folders.
          </div>
        )}

        {lookupError && (
          <p role="alert" className="mt-5 rounded-[12px] bg-[#fdecea] px-4 py-3 text-sm font-bold text-destructive">{lookupError}</p>
        )}

        {checking && token && (
          <p className="label-caps mt-5 text-[15px] text-ink-soft">Loading…</p>
        )}

        {result?.found && (
          <div className="mt-6 space-y-4 rounded-[18px] bg-chalk p-5 shadow-[inset_0_0_0_1px_var(--line)] md:p-6">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="caps font-display text-[28px] font-black leading-none text-ink">Monthly Kit Club</p>
                {typeof result.price_cents === "number" && (
                  <p className="mt-1.5 text-[15px] text-ink-soft tabular-nums">{formatCurrency(result.price_cents)} / month</p>
                )}
              </div>
              <span className={`inline-flex h-8 shrink-0 items-center gap-2 rounded-full px-3 text-[13px] font-bold text-ink ${
                result.status === "active"
                  ? "bg-success-tint"
                  : "bg-white shadow-[inset_0_0_0_1px_var(--line)]"
              }`}>
                <span aria-hidden className={`size-2 rounded-full ${result.status === "active" ? "bg-success" : "bg-ink-soft"}`} />
                {result.status === "active" ? "Active" : "Cancelled"}
              </span>
            </div>

            {result.created_at && (
              <p className="text-[15px] text-ink-soft">
                Subscribed on <span className="font-bold text-ink">{formatDate(result.created_at)}</span>
              </p>
            )}

            {result.cancelled_at && (
              <p className="text-[15px] text-ink-soft">
                Cancelled on <span className="font-bold text-ink">{formatDate(result.cancelled_at)}</span>
              </p>
            )}

            {cancelled && (
              <div className="rounded-[12px] bg-success-tint px-4 py-3 text-[15px] font-bold text-ink">
                Your subscription has been cancelled. You won&apos;t be charged again.
              </div>
            )}

            {result.status === "active" && !cancelled && (
              <div className="space-y-3 border-t border-line pt-5">
                {cancelError && <p className="rounded-[12px] bg-[#fdecea] px-4 py-3 text-sm font-bold text-destructive">{cancelError}</p>}
                <button
                  onClick={handleCancel}
                  disabled={cancelling}
                  className="inline-flex min-h-12 w-full items-center justify-center rounded-full bg-white px-6 text-[16px] font-bold text-destructive shadow-[inset_0_0_0_1.5px_currentColor] transition-colors duration-150 hover:bg-destructive hover:text-white disabled:opacity-60"
                >
                  {cancelling ? "Cancelling…" : "Cancel my subscription"}
                </button>
                <p className="text-center text-[13px] text-ink-soft">
                  Cancellation is immediate. No refunds for the current billing period.
                </p>
              </div>
            )}
          </div>
        )}
      </div>
      </div>
    </div>
  );
}
