"use client";

import { Check } from "lucide-react";
import { useState } from "react";

export function WaitlistForm() {
  const [email, setEmail] = useState("");
  const [status, setStatus] = useState<"idle" | "loading" | "success" | "error">("idle");
  const [error, setError] = useState("");

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!email.trim()) return;
    setStatus("loading");
    setError("");
    try {
      const res = await fetch("/api/waitlist", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: email.trim() }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Something went wrong.");
        setStatus("error");
      } else {
        setStatus("success");
      }
    } catch {
      setError("Network error. Please try again.");
      setStatus("error");
    }
  }

  if (status === "success") {
    return (
      <p role="status" className="mt-8 inline-flex items-center gap-2.5 rounded-full bg-success-tint px-5 py-3 text-base font-semibold text-ink">
        <Check className="h-4 w-4 shrink-0" strokeWidth={3} />You&apos;re on the list — we&apos;ll email you when we&apos;re back.
      </p>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="mt-10 flex flex-col items-center gap-3">
      <p className="label-caps mb-1 text-[15px] text-on-dark-muted">
        Get notified when we&apos;re back
      </p>
      <div className="flex w-full max-w-[420px] gap-3">
        <input
          type="email"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="your@email.com"
          aria-label="Email address"
          autoComplete="email"
          className="h-12 min-w-0 flex-1 rounded-full border-[1.5px] border-line-dark bg-ink-2 px-5 text-base text-white outline-none transition-[border-color] placeholder:text-on-dark-muted hover:border-on-dark-muted focus-visible:border-sun focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sun"
        />
        <button
          type="submit"
          disabled={status === "loading"}
          className="btn btn-sun shrink-0 disabled:opacity-60"
        >
          {status === "loading" ? "..." : "Notify Me"}
        </button>
      </div>
      {error && <p role="alert" className="text-sm font-semibold text-sun">{error}</p>}
    </form>
  );
}
