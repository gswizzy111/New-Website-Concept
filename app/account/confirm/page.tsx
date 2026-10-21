"use client";

import { Suspense, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { AuthCard, BUTTON_CN } from "../auth-card";

// The confirm-email link lands here. Confirming takes a button press (not the
// page load), so email scanners that open links can't use up the token.
function Confirm() {
  const router = useRouter();
  const tokenHash = useSearchParams().get("token_hash") ?? "";
  const [state, setState] = useState<"idle" | "working" | "error">("idle");
  const [error, setError] = useState("");

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
    router.push("/account");
    router.refresh();
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
