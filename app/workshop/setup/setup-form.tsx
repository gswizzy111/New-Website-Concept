"use client";

import { useState, Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { WORKSHOP_HOME } from "@/lib/workshop-access";
import { ADMIN_SIGNED_IN_MESSAGE } from "./messages";

const MIN = 10; // ADMIN_PASSWORD_MIN in lib/admin-password.ts

/** The one-time link a new worker gets from the admin's Team page (lib/workshop-users.ts). */
function SetupForm() {
  const token = useSearchParams().get("token") ?? "";
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [done, setDone] = useState<{ username: string; signedIn: boolean } | null>(null);
  const [adminHere, setAdminHere] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    if (password.length < MIN) { setError(`Use at least ${MIN} characters.`); return; }
    if (password !== confirm) { setError("Passwords don't match."); return; }
    setLoading(true);
    const res = await fetch("/api/workshop/setup", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token, password }),
    }).catch(() => null);
    const data = res ? await res.json().catch(() => ({})) : {};
    // An admin opened the link in their own signed-in browser: nothing was set
    if (res?.status === 409 && data.adminSignedIn) {
      setAdminHere(true);
      setLoading(false);
      return;
    }
    if (!res || !res.ok) {
      setError(data.error ?? "Something went wrong. Please try again.");
      setLoading(false);
      return;
    }
    setDone({ username: data.username ?? "", signedIn: data.signedIn === true });
    setTimeout(() => { window.location.href = data.signedIn ? WORKSHOP_HOME : "/admin/login"; }, 2500);
  }

  if (adminHere) return <AdminSignedIn />;

  if (done) {
    return (
      <div className="text-center">
        <div className="text-4xl mb-4">✓</div>
        <h2 className="font-bold text-xl text-foreground mb-2">Password set!</h2>
        <p className="text-sm text-muted-foreground">
          {done.signedIn ? "Taking you to the Scan page." : "Taking you to sign in."} Next time, sign in on the <strong>Admin</strong> tab with your username{done.username ? <> <strong>{done.username}</strong></> : null}.
        </p>
      </div>
    );
  }

  return (
    <>
      <h1 className="font-heading font-black text-2xl text-foreground mb-1">Set your password</h1>
      <p className="text-sm text-muted-foreground mb-6">You&apos;re setting up your workshop login for The Card Doc.</p>
      <form onSubmit={handleSubmit} className="flex flex-col gap-4">
        <div>
          <label htmlFor="pw" className="block text-xs font-semibold text-muted-foreground mb-1.5">New Password</label>
          <input
            id="pw"
            type="password"
            autoComplete="new-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder={`At least ${MIN} characters`}
            className="w-full h-11 px-4 rounded-lg border border-border text-base sm:text-sm focus:outline-none focus:ring-2 focus:ring-primary/40"
            required
            autoFocus
          />
        </div>
        <div>
          <label htmlFor="pw2" className="block text-xs font-semibold text-muted-foreground mb-1.5">Confirm Password</label>
          <input
            id="pw2"
            type="password"
            autoComplete="new-password"
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            placeholder="Repeat your password"
            className="w-full h-11 px-4 rounded-lg border border-border text-base sm:text-sm focus:outline-none focus:ring-2 focus:ring-primary/40"
            required
          />
        </div>
        {(error || !token) && (
          <p role="alert" className="text-sm text-red-500">{error || "Missing setup token. Use the whole link you were given."}</p>
        )}
        <button
          type="submit"
          disabled={loading || !token}
          className="h-11 bg-primary text-white font-bold rounded-lg hover:bg-primary/90 transition-colors disabled:opacity-50"
        >
          {loading ? "Saving…" : "Set Password & Continue →"}
        </button>
      </form>
    </>
  );
}

/** The setup link opened where a full admin is signed in: their session is kept and nothing is set. */
export function AdminSignedIn() {
  return (
    <div role="status">
      <h1 className="font-heading font-black text-2xl text-foreground mb-2">This link is for the worker</h1>
      <p className="text-sm text-foreground">{ADMIN_SIGNED_IN_MESSAGE}</p>
    </div>
  );
}

export function WorkshopSetup() {
  return (
    <Suspense fallback={<p className="text-sm text-muted-foreground">Loading…</p>}>
      <SetupForm />
    </Suspense>
  );
}
