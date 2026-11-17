"use client";

import { useState, useEffect, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Check } from "lucide-react";
import { FIELD_LABEL, PORTAL_BUTTON, PortalCard } from "@/components/account/portal";

// The same minimum as admin passwords (ADMIN_PASSWORD_MIN in lib/admin-password.ts)
const MIN = 10;

function SetupForm() {
  const searchParams = useSearchParams();
  const token = searchParams.get("token") ?? "";
  const router = useRouter();
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [done, setDone] = useState(false);

  useEffect(() => {
    if (!token) setError("Missing invite token. Use the link from your invitation email.");
  }, [token]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    if (password.length < MIN) { setError(`Password must be at least ${MIN} characters.`); return; }
    if (password !== confirm) { setError("Passwords don't match."); return; }
    setLoading(true);
    const res = await fetch("/api/accountant/setup", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token, password }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      setError(data.error ?? "Something went wrong. Please try again.");
      setLoading(false);
      return;
    }
    setDone(true);
    setTimeout(() => router.push("/admin/login"), 2500);
  }

  if (done) {
    return (
      <div className="text-center">
        <span aria-hidden className="mx-auto mb-4 grid size-14 place-items-center rounded-full bg-success-tint text-success">
          <Check className="size-7" strokeWidth={2.5} />
        </span>
        <h2 className="mb-2 font-heading text-[1.75rem] leading-none font-black text-ink">Password set!</h2>
        <p className="text-sm text-ink-soft">Redirecting you to the login page…</p>
      </div>
    );
  }

  return (
    <>
      <h1 className="mb-2 font-heading text-[2.25rem] leading-[0.95] font-black text-ink">Set your password</h1>
      <p className="mb-6 text-sm text-ink-soft">You&apos;re setting up accountant access to The Card Doc admin.</p>
      <form onSubmit={handleSubmit} className="flex flex-col gap-4">
        <div>
          <label htmlFor="acct-password" className={FIELD_LABEL}>New Password</label>
          <input
            id="acct-password"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder={`At least ${MIN} characters`}
            className="w-full h-11 min-w-0 rounded-[12px] border-[1.5px] border-input bg-white px-3.5 text-base outline-none transition-[border-color] placeholder:text-muted-foreground hover:border-ink-soft focus-visible:border-cobalt focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-cobalt md:text-[15px]"
            required
            autoFocus
          />
        </div>
        <div>
          <label htmlFor="acct-confirm" className={FIELD_LABEL}>Confirm Password</label>
          <input
            id="acct-confirm"
            type="password"
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            placeholder="Repeat your password"
            className="w-full h-11 min-w-0 rounded-[12px] border-[1.5px] border-input bg-white px-3.5 text-base outline-none transition-[border-color] placeholder:text-muted-foreground hover:border-ink-soft focus-visible:border-cobalt focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-cobalt md:text-[15px]"
            required
          />
        </div>
        {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
        <button
          type="submit"
          disabled={loading || !token}
          className={PORTAL_BUTTON}
        >
          {loading ? "Saving…" : "Set Password & Continue →"}
        </button>
      </form>
    </>
  );
}

export default function AccountantSetupPage() {
  return (
    <PortalCard width="max-w-sm">
      <Suspense fallback={<p className="text-sm text-ink-soft">Loading…</p>}>
        <SetupForm />
      </Suspense>
    </PortalCard>
  );
}
