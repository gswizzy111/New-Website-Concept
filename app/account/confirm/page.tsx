"use client";

import { Suspense, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { AuthCard, BUTTON_CN, FIELD_CN, LABEL_CN } from "../auth-card";

// The confirm-email link lands here. Confirming takes a button press (not the
// page load), so email scanners that open links can't use up the token.
// Links for an email that was signed up more than once with different
// passwords (check=1) ask for the account's password, or a new password,
// first, so nobody else's password keeps working once the owner confirms.
// If the route says the email is confirmed but a password still has to be
// chosen (choosePassword, or a refused new password), the page asks for one.
function Confirm() {
  const router = useRouter();
  const params = useSearchParams();
  const tokenHash = params.get("token_hash") ?? "";
  const uid = params.get("uid") ?? "";
  const check = params.get("check") === "1" && !!uid;

  const [mode, setMode] = useState<"password" | "new">("password");
  const [password, setPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [again, setAgain] = useState("");
  const [working, setWorking] = useState(false);
  const [error, setError] = useState("");
  // The link was used and the email confirmed, but the new password was refused
  const [confirmed, setConfirmed] = useState(false);

  async function submit(body: Record<string, unknown>) {
    setWorking(true);
    setError("");
    try {
      const res = await fetch("/api/account/auth/confirm", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json().catch(() => ({}));
      if (data.choosePassword) {
        setConfirmed(true);
        setMode("new");
        return;
      }
      if (res.ok) {
        router.push("/account");
        router.refresh();
        return;
      }
      if (data.confirmed) {
        setConfirmed(true);
        setMode("new");
      }
      setError(data.error ?? "Something went wrong. Please try again.");
    } catch {
      setError("We couldn't reach the server. Check your connection and try again.");
    } finally {
      setWorking(false);
    }
  }

  function confirmPlain() {
    submit({ token_hash: tokenHash });
  }

  function confirmWithPassword(e: React.FormEvent) {
    e.preventDefault();
    submit({ token_hash: tokenHash, uid, password });
  }

  function confirmWithNew(e: React.FormEvent) {
    e.preventDefault();
    if (newPassword !== again) return setError("The two passwords don't match.");
    submit(confirmed ? { finish: true, new_password: newPassword } : { token_hash: tokenHash, uid, new_password: newPassword });
  }

  const errorLine = error && (
    <p role="alert" className="text-sm text-red-700">
      {error}
      {/expired|already used|incomplete|doesn't match/i.test(error) && <> <Link href="/account/login" className="font-semibold underline">Sign in</Link></>}
    </p>
  );

  if (!tokenHash) {
    return (
      <AuthCard title="Confirm your email">
        <p className="text-sm text-muted-foreground">This link is incomplete. Open the link from your email again, or <Link href="/account/login" className="font-semibold text-primary hover:underline">sign in</Link> to get a new one.</p>
      </AuthCard>
    );
  }

  if (!check && !confirmed) {
    return (
      <AuthCard title="Confirm your email">
        <p className="text-sm text-muted-foreground mb-6">One tap and your account is ready, with every order placed under this email.</p>
        <button type="button" onClick={confirmPlain} disabled={working} className={BUTTON_CN}>
          {working ? "Confirming…" : "Confirm my email"}
        </button>
        {error && <div className="mt-4">{errorLine}</div>}
      </AuthCard>
    );
  }

  return (
    <AuthCard title={mode === "new" ? "Choose your password" : "Confirm your email"}>
      {mode === "password" ? (
        <form onSubmit={confirmWithPassword} className="flex flex-col gap-4">
          <p className="text-sm text-muted-foreground leading-relaxed">
            This email address was used to sign up more than once. To keep the account yours, enter its password to confirm.
          </p>
          <div>
            <label htmlFor="confirm-password" className={LABEL_CN}>Password</label>
            <input id="confirm-password" type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} className={FIELD_CN} />
          </div>
          {errorLine}
          <button type="submit" disabled={working} className={BUTTON_CN}>
            {working ? "Confirming…" : "Confirm my email"}
          </button>
          <button type="button" onClick={() => { setMode("new"); setError(""); }} className="text-center text-sm font-semibold text-primary hover:underline">
            Don&apos;t know it, or didn&apos;t sign up? Choose a new password
          </button>
        </form>
      ) : (
        <form onSubmit={confirmWithNew} className="flex flex-col gap-4">
          <p className="text-sm text-muted-foreground leading-relaxed">
            {confirmed
              ? "Your email is confirmed. Choose a password to finish."
              : "Choose a new password for this account. It replaces any password chosen before, and signs out anyone else."}
          </p>
          <div>
            <label htmlFor="new-password" className={LABEL_CN}>New password</label>
            <input id="new-password" type="password" autoComplete="new-password" required minLength={8} value={newPassword} onChange={(e) => setNewPassword(e.target.value)} placeholder="At least 8 characters" className={FIELD_CN} />
          </div>
          <div>
            <label htmlFor="new-password-again" className={LABEL_CN}>Confirm new password</label>
            <input id="new-password-again" type="password" autoComplete="new-password" required minLength={8} value={again} onChange={(e) => setAgain(e.target.value)} className={FIELD_CN} />
          </div>
          {errorLine}
          <button type="submit" disabled={working} className={BUTTON_CN}>
            {working ? "Saving…" : confirmed ? "Save password" : "Confirm and save password"}
          </button>
          {!confirmed && (
            <button type="button" onClick={() => { setMode("password"); setError(""); }} className="text-center text-sm font-semibold text-primary hover:underline">
              I know the password
            </button>
          )}
        </form>
      )}
    </AuthCard>
  );
}

export default function ConfirmPage() {
  return <Suspense><Confirm /></Suspense>;
}
