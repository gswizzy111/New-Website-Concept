"use client";

import { Suspense, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";

type SubResult = {
  found: boolean;
  id?: string;
  status?: string;
  created_at?: string;
  cancelled_at?: string;
};

const LINK_EXPIRED = "This link has expired or was already used. Enter your email to get a new one.";

/**
 * Shows a Kit Club subscription and cancels it, only for someone who proved
 * the inbox: the one-time link this page emails (?token=...), or a signed-in
 * account with the same email. Typing an email only sends that link.
 */
function ManageSubscription() {
  const token = useSearchParams().get("token") ?? "";
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
    <div className="min-h-screen bg-secondary/30 flex items-center justify-center px-4 py-16">
      <div className="bg-white rounded-lg border border-border p-8 max-w-md w-full">
        <Link href="/" className="text-sm text-muted-foreground hover:text-primary block mb-6">← Back to home</Link>

        <h1 className="font-heading font-extrabold text-2xl text-foreground mb-1">Manage Your Subscription</h1>
        <p className="text-sm text-muted-foreground mb-6">Enter the email you used to subscribe. We&apos;ll email you a link to manage it.</p>

        <form onSubmit={handleLookup} className="flex gap-2 mb-6">
          <label htmlFor="manage-email" className="sr-only">Email</label>
          <input
            id="manage-email"
            type="email"
            autoComplete="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="your@email.com"
            required
            className="flex-1 min-w-0 px-3 py-2 rounded-lg border border-border text-sm focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary"
          />
          <button
            type="submit"
            disabled={loading}
            className="px-4 py-2 bg-primary text-primary-foreground rounded-lg text-sm font-semibold hover:opacity-90 disabled:opacity-40 transition-opacity"
          >
            {loading ? "…" : "Send link"}
          </button>
        </form>

        {sentTo && (
          <div role="status" className="mb-4 rounded-lg border border-green-200 bg-green-50 px-4 py-3 text-sm text-green-800 leading-relaxed">
            If there&apos;s a subscription for <span className="font-semibold [overflow-wrap:anywhere]">{sentTo}</span>, we just emailed it a link to manage it. The link expires in 1 hour. Not there in a minute? Check your Spam, Junk and Promotions folders.
          </div>
        )}

        {lookupError && (
          <p role="alert" className="text-sm text-red-600 mb-4">{lookupError}</p>
        )}

        {checking && token && (
          <p className="text-sm text-muted-foreground">Loading…</p>
        )}

        {result?.found && (
          <div className="border border-border rounded-lg p-5 space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="font-bold text-foreground">Monthly Kit Club</p>
                <p className="text-xs text-muted-foreground mt-0.5">$62.99 / month</p>
              </div>
              <span className={`text-xs font-bold px-2.5 py-1 rounded-full ${
                result.status === "active"
                  ? "bg-green-100 text-green-800"
                  : "bg-gray-100 text-gray-600"
              }`}>
                {result.status === "active" ? "Active" : "Cancelled"}
              </span>
            </div>

            {result.created_at && (
              <p className="text-sm text-muted-foreground">
                Subscribed on <span className="font-medium text-foreground">{formatDate(result.created_at)}</span>
              </p>
            )}

            {result.cancelled_at && (
              <p className="text-sm text-muted-foreground">
                Cancelled on <span className="font-medium text-foreground">{formatDate(result.cancelled_at)}</span>
              </p>
            )}

            {cancelled && (
              <div className="bg-green-50 border border-green-200 rounded-lg px-4 py-3 text-sm text-green-800 font-medium">
                Your subscription has been cancelled. You won&apos;t be charged again.
              </div>
            )}

            {result.status === "active" && !cancelled && (
              <div className="pt-2 border-t border-border space-y-2">
                {cancelError && <p className="text-sm text-red-600">{cancelError}</p>}
                <button
                  onClick={handleCancel}
                  disabled={cancelling}
                  className="w-full py-2.5 px-4 rounded-lg border border-red-300 text-red-600 text-sm font-semibold hover:bg-red-50 disabled:opacity-40 transition-colors"
                >
                  {cancelling ? "Cancelling…" : "Cancel my subscription"}
                </button>
                <p className="text-xs text-muted-foreground text-center">
                  Cancellation is immediate. No refunds for the current billing period.
                </p>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

export default function ManageSubscriptionPage() {
  return (
    <Suspense>
      <ManageSubscription />
    </Suspense>
  );
}
