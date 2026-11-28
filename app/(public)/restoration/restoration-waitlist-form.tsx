"use client";

import { useId, useState } from "react";
import { SMS_WAITLIST_CONSENT_TEXT } from "@/lib/sms/consent-text";
import { consentParts, waitlistSmsProblem } from "@/lib/sms-public";

export function RestorationWaitlistForm({ onSuccess }: { onSuccess?: () => void } = {}) {
  const [form, setForm] = useState({ name: "", email: "", phone: "" });
  // Unchecked until the customer ticks it (10DLC opt-in)
  const [smsOptIn, setSmsOptIn] = useState(false);
  const [status, setStatus] = useState<"idle" | "loading" | "success" | "error">("idle");
  const [error, setError] = useState("");
  const smsId = useId();

  // The text box shows once a phone is typed, and stays while it is ticked
  const showSms = form.phone.trim() !== "" || smsOptIn;

  function handleChange(e: React.ChangeEvent<HTMLInputElement>) {
    setForm((p) => ({ ...p, [e.target.name]: e.target.value }));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const smsProblem = waitlistSmsProblem(form.phone, smsOptIn);
    if (smsProblem) { setError(smsProblem); setStatus("error"); return; }
    setStatus("loading");
    setError("");
    try {
      const res = await fetch("/api/restoration-waitlist", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...form, smsOptIn }),
      });
      const data = await res.json();
      if (!res.ok) { setError(data.error ?? "Something went wrong."); setStatus("error"); return; }
      setStatus("success");
      if (onSuccess) setTimeout(onSuccess, 1800);
    } catch {
      setError("Network error. Please try again.");
      setStatus("error");
    }
  }

  if (status === "success") {
    return (
      <div role="status" className="relative mx-auto max-w-md rounded-2xl bg-success-tint px-6 py-5 text-center shadow-[inset_0_0_0_1.5px_color-mix(in_srgb,var(--success)_35%,transparent)]">
        <p className="caps mb-1 font-display text-[28px] font-black leading-none text-ink">You&apos;re on the list!</p>
        <p className="text-sm text-ink">We&apos;ll reach out as soon as we&apos;re accepting restorations again.</p>
      </div>
    );
  }

  const inp = "h-12 w-full rounded-[12px] border-[1.5px] border-input bg-white px-3.5 text-base text-ink outline-hidden transition-[border-color] placeholder:text-ink-soft hover:border-ink-soft focus-visible:border-cobalt focus-visible:outline-2 focus-visible:outline-solid focus-visible:outline-offset-1 focus-visible:outline-cobalt";

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-3 max-w-md mx-auto">
      <input name="name" required autoComplete="name" aria-label="Full name" placeholder="Full name *" value={form.name} onChange={handleChange} className={inp} />
      <input name="email" type="email" required autoComplete="email" aria-label="Email address" placeholder="Email address *" value={form.email} onChange={handleChange} className={inp} />
      <input
        name="phone"
        type="tel"
        autoComplete="tel"
        aria-label={smsOptIn ? "Phone number (needed for texts)" : "Phone number (optional)"}
        placeholder="Phone number (optional)"
        required={smsOptIn}
        value={form.phone}
        onChange={handleChange}
        className={inp}
      />
      {showSms && (
        <label
          htmlFor={smsId}
          className="-mx-2 flex min-h-11 animate-[fade-in_220ms_ease-out_both] cursor-pointer items-start gap-3 rounded-[10px] px-2 py-2 text-left text-[14px] leading-[1.5] text-ink transition-colors duration-150 hover:bg-chalk motion-reduce:animate-none"
        >
          <input
            id={smsId}
            type="checkbox"
            className="mt-0.5 shrink-0"
            checked={smsOptIn}
            onChange={(e) => setSmsOptIn(e.target.checked)}
          />
          <span>
            {consentParts(SMS_WAITLIST_CONSENT_TEXT).map((p, i) =>
              p.href ? (
                // A new tab, so the half-filled form stays as it is
                <a
                  key={i}
                  href={p.href}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="font-bold text-cobalt underline decoration-2 underline-offset-2 hover:text-ink"
                >
                  {p.text}
                  <span className="sr-only"> (opens in a new tab)</span>
                </a>
              ) : (
                <span key={i}>{p.text}</span>
              )
            )}
          </span>
        </label>
      )}
      {error && <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm font-semibold text-red-700">{error}</p>}
      <button
        type="submit"
        disabled={status === "loading"}
        className="btn btn-sun btn-lg mt-1 w-full disabled:opacity-60"
      >
        {status === "loading" ? "Submitting…" : "Notify Me When Open"}
      </button>
    </form>
  );
}
