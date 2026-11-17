"use client";

import { useState } from "react";

export function RestorationWaitlistForm({ onSuccess }: { onSuccess?: () => void } = {}) {
  const [form, setForm] = useState({ name: "", email: "", phone: "" });
  const [status, setStatus] = useState<"idle" | "loading" | "success" | "error">("idle");
  const [error, setError] = useState("");

  function handleChange(e: React.ChangeEvent<HTMLInputElement>) {
    setForm((p) => ({ ...p, [e.target.name]: e.target.value }));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setStatus("loading");
    setError("");
    try {
      const res = await fetch("/api/restoration-waitlist", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
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

  const inp = "h-12 w-full rounded-[12px] border-[1.5px] border-input bg-white px-3.5 text-base text-ink outline-none transition-[border-color] placeholder:text-ink-soft hover:border-ink-soft focus-visible:border-cobalt focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-cobalt";

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-3 max-w-md mx-auto">
      <input name="name" required autoComplete="name" aria-label="Full name" placeholder="Full name *" value={form.name} onChange={handleChange} className={inp} />
      <input name="email" type="email" required autoComplete="email" aria-label="Email address" placeholder="Email address *" value={form.email} onChange={handleChange} className={inp} />
      <input name="phone" type="tel" autoComplete="tel" aria-label="Phone number (optional)" placeholder="Phone number (optional)" value={form.phone} onChange={handleChange} className={inp} />
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
