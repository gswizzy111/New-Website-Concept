"use client";

import { useState } from "react";
import Link from "next/link";
import { MailCheck, MailMinus } from "lucide-react";

const ORDER_EMAILS = "Order emails, like confirmations and shipping updates, still arrive.";

export function UnsubscribePanel({ token, email, alreadyUnsubscribed }: { token: string; email: string; alreadyUnsubscribed: boolean }) {
  const [done, setDone] = useState(alreadyUnsubscribed);
  const [working, setWorking] = useState(false);
  const [error, setError] = useState("");

  async function unsubscribe() {
    setWorking(true);
    setError("");
    try {
      const res = await fetch("/api/email/unsubscribe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error ?? "We couldn't unsubscribe you just now. Please try again in a minute.");
        return;
      }
      setDone(true);
    } catch {
      setError("We couldn't reach the server. Check your connection and try again.");
    } finally {
      setWorking(false);
    }
  }

  const Icon = done ? MailCheck : MailMinus;

  return (
    <div aria-live="polite">
      <span className="flex h-12 w-12 items-center justify-center rounded-md bg-rx-soft text-rx mb-6">
        <Icon className="h-6 w-6" strokeWidth={1.75} aria-hidden />
      </span>
      <h1 className="font-heading text-3xl md:text-4xl font-extrabold tracking-[-0.015em] text-ink mb-4">
        {done ? "You're unsubscribed" : "Unsubscribe from marketing emails"}
      </h1>
      <p className="text-lg text-muted-foreground leading-relaxed mb-8">
        {done ? (
          <>
            <span className="font-semibold text-ink break-all">{email}</span> won&apos;t get marketing emails from The Card Doc anymore. {ORDER_EMAILS}
          </>
        ) : (
          <>
            Stop marketing emails from The Card Doc to <span className="font-semibold text-ink break-all">{email}</span>. {ORDER_EMAILS}
          </>
        )}
      </p>
      {done ? (
        <Link
          href="/"
          className="inline-flex h-11 items-center rounded-md bg-rx px-6 text-[15px] font-semibold text-primary-foreground hover:bg-rx/90 transition-colors"
        >
          Back to home
        </Link>
      ) : (
        <button
          type="button"
          onClick={unsubscribe}
          disabled={working}
          className="btn-depth inline-flex h-11 items-center rounded-md bg-rx px-6 text-[15px] font-semibold text-primary-foreground hover:bg-rx/90 transition-colors disabled:opacity-60"
        >
          {working ? "Unsubscribing…" : "Unsubscribe"}
        </button>
      )}
      {error && <p role="alert" className="mt-4 text-sm text-red-700">{error}</p>}
    </div>
  );
}
