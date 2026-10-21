"use client";

import { useEffect, useRef } from "react";
import type { AccountProfile } from "@/lib/account-profile";

/**
 * Checkout prefill: when the customer is signed in, calls `apply` once with
 * their saved details (Settings, else their latest order). Callers fill only
 * the fields that are still empty. Signed out, nothing happens.
 */
export function useAccountPrefill(apply: (profile: AccountProfile) => void) {
  const applyRef = useRef(apply);
  useEffect(() => { applyRef.current = apply; });
  useEffect(() => {
    let cancelled = false;
    fetch("/api/account/profile", { credentials: "same-origin" })
      .then((r) => (r.status === 200 ? r.json() : null))
      .then((p: AccountProfile | null) => { if (!cancelled && p) applyRef.current(p); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, []);
}
