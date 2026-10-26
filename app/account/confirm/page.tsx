"use client";

import { Suspense, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { AuthCard, BUTTON_CN, FIELD_CN, LABEL_CN } from "../auth-card";

// The confirm-email link lands here. Confirming takes a button press (not the
// page load), so email scanners that open links can't use up the token. If
// the email was signed up more than once before being confirmed, the owner
// chooses their password next (the confirm route has locked out the old one).
function Confirm() {
  const router = useRouter();
  const tokenHash = useSearchParams().get("token_hash") ?? "";
  const [state, setState] = useState<"idle" | "working" | "error" | "choose">("idle");
  const [error, setError] = useState("");
  const [password, setPassword] = useState("");
  const [again, setAgain] = useState("");
  const [saving, setSaving] = useState(false);

  async function confirm() {
    setState("working");
    const res = await fetch("/api/account/auth/confirm", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token_hash: tokenHash }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      setError(data.error ?? "Something went wrong. Please try again.");
      setState("error");
      return;
    }
    if (data.choosePassword) {
      setState("choose");
      return;
    }
    router.push("/account");
    router.refresh();
  }

  async function choose(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    if (password !== again) return setError("The two passwords don't match.");
    setSaving(true);
    const res = await fetch("/api/account/auth/choose-password", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password }),
    });
    const data = await res.json().catch(() => ({}));
    setSaving(false);
    if (!res.ok) return setError(data.error ?? "Something went wrong. Please try again.");
    router.push("/account");
    router.refresh();
  }

  if (state === "choose") {
    return (
      <AuthCard title="Choose your password">
        <form onSubmit={choose} className="flex flex-col gap-4">
          <p className="text-sm text-muted-foreground leading-relaxed">
            Your email is confirmed. This email was used to sign up more than once, so to keep your account yours, choose your password now.
          </p>
          <div>
            <label htmlFor="choose-password" className={LABEL_CN}>New password</label>
            <input id="choose-password" type="password" autoComplete="new-password" required minLength={8} value={password} onChange={(e) => setPassword(e.target.value)} placeholder="At least 8 characters" className={FIELD_CN} />
          </div>
          <div>
            <label htmlFor="choose-password-again" className={LABEL_CN}>Confirm new password</label>
            <input id="choose-password-again" type="password" autoComplete="new-password" required minLength={8} value={again} onChange={(e) => setAgain(e.target.value)} className={FIELD_CN} />
          </div>
          {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
          <button type="submit" disabled={saving} className={BUTTON_CN}>
            {saving ? "Saving…" : "Save password"}
          </button>
        </form>
      </AuthCard>
    );
  }

  return (
    <AuthCard title="Confirm your email">
      {!tokenHash ? (
        <p className="text-sm text-muted-foreground">This link is incomplete. Open the link from your email again, or <Link href="/account/login" className="font-semibold text-primary hover:underline">sign in</Link> to get a new one.</p>
      ) : (
        <>
          <p className="text-sm text-muted-foreground mb-6">One tap and your account is ready, with every order placed under this email.</p>
          <button type="button" onClick={confirm} disabled={state === "working"} className={BUTTON_CN}>
            {state === "working" ? "Confirming…" : "Confirm my email"}
          </button>
          {state === "error" && (
            <p role="alert" className="mt-4 text-sm text-red-700">
              {error} <Link href="/account/login" className="font-semibold underline">Sign in</Link>
            </p>
          )}
        </>
      )}
    </AuthCard>
  );
}

export default function ConfirmPage() {
  return <Suspense><Confirm /></Suspense>;
}
