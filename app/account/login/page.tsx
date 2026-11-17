"use client";

import { useState, useEffect } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { Suspense } from "react";
import { CheckEmail, type ConfirmSent } from "./check-email";
import { PIXEL_FIELD } from "@/components/ui/input";
import { BrandLogo } from "@/components/brand";
import { FIELD_LABEL, PORTAL_BUTTON, PORTAL_LINK } from "@/components/account/portal";
import { cn } from "@/lib/utils";

function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  // Only paths on this site after signing in: a single leading slash, and no
  // backslashes or control characters (browsers drop tabs and newlines, so
  // "/<tab>/evil.example" would otherwise become "//evil.example")
  const rawNext = searchParams.get("next");
  const next = rawNext && /^\/(?!\/)/.test(rawNext) && !/[\\\u0000-\u001f\u007f]/.test(rawNext) ? rawNext : "/account";
  const unconfirmed = searchParams.get("unconfirmed") === "1";

  const [tab, setTab] = useState<"login" | "signup">(searchParams.get("tab") === "signup" ? "signup" : "login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  // The confirm email is on its way (after signing up, or signing in unconfirmed)
  const [confirm, setConfirm] = useState<ConfirmSent | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setLoading(true);

    const url = tab === "login"
      ? "/api/account/auth/login"
      : "/api/account/auth/signup";
    const body = tab === "login"
      ? { email, password }
      : { email, password, name };

    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

    const data = await res.json().catch(() => ({}));
    setLoading(false);

    if (data.confirmationSent || data.code === "EMAIL_NOT_CONFIRMED") {
      setConfirm({
        email: email.trim(),
        password,
        sent: !!data.confirmationSent,
        alreadySent: !!data.alreadySent,
        sentFrom: data.sentFrom,
        subject: data.subject,
        message: data.error,
      });
      return;
    }
    if (!res.ok) {
      setError(data.error ?? "Something went wrong. Please try again.");
      return;
    }

    router.push(next);
    router.refresh();
  }

  return (
    <div className="surface-chalk relative flex min-h-screen items-center justify-center overflow-hidden px-4 py-14">
      <span aria-hidden className="pointer-events-none absolute -top-40 -right-40 size-[520px] rounded-full bg-cobalt-wash" />
      <span aria-hidden className="pointer-events-none absolute -bottom-48 -left-32 size-[420px] rounded-full bg-sun-tint" />
      <div className="relative w-full max-w-md">
        <div className="mb-7 flex flex-col items-center gap-3 text-center">
          <Link href="/" className="inline-flex min-h-11 items-center rounded-[14px] focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-cobalt">
            <BrandLogo size={46} wordmarkClassName="text-[1.6rem]" />
          </Link>
          <p className="label-caps text-[15px] text-ink-soft">Customer portal</p>
          {/* The check-email view has its own heading */}
          {!confirm && <h1 className="sr-only">{tab === "login" ? "Sign in" : "Create an account"}</h1>}
        </div>

        {unconfirmed && !confirm && (
          <div role="status" className="mb-4 rounded-[14px] bg-sun-tint px-4 py-3 text-sm text-ink shadow-[inset_0_0_0_1px_var(--sun-deep)]">
            Please confirm your email to open your account. Sign in and we&apos;ll send you a new confirmation link.
          </div>
        )}

        {confirm ? (
          <CheckEmail
            info={confirm}
            onConfirmed={() => { router.push(next); router.refresh(); }}
            onStartOver={() => { setConfirm(null); setTab("signup"); setEmail(""); setPassword(""); setError(""); }}
            onBack={() => { setConfirm(null); setTab("login"); setPassword(""); setError(""); }}
          />
        ) : (
        <div className="overflow-hidden rounded-[22px] bg-white shadow-[0_0_0_1px_var(--line),var(--pop-shadow)]">
          {/* Tabs */}
          <div className="m-2 grid grid-cols-2 gap-1 rounded-full bg-chalk p-1">
            {(["login", "signup"] as const).map((t) => (
              <button
                key={t}
                type="button"
                aria-pressed={tab === t}
                onClick={() => { setTab(t); setError(""); }}
                className={cn(
                  "min-h-11 rounded-full text-[15px] font-bold transition-[background-color,color,box-shadow] duration-200",
                  tab === t ? "bg-white text-ink shadow-[0_1px_2px_rgba(8,12,40,0.12),0_4px_10px_-6px_rgba(8,12,40,0.35)]" : "text-ink-soft hover:text-ink"
                )}
              >
                {t === "login" ? "Sign In" : "Create Account"}
              </button>
            ))}
          </div>

          <form onSubmit={handleSubmit} className="flex flex-col gap-4 px-6 pt-4 pb-7 sm:px-8">
            {tab === "signup" && (
              <div>
                <label htmlFor="login-name" className={FIELD_LABEL}>Full Name</label>
                <input
                  id="login-name"
                  type="text"
                  autoComplete="name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  required
                  placeholder="Jane Smith"
                  className={PIXEL_FIELD}
                />
              </div>
            )}

            <div>
              <label htmlFor="login-email" className={FIELD_LABEL}>Email</label>
              <input
                id="login-email"
                type="email"
                autoComplete="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                placeholder="you@example.com"
                className={PIXEL_FIELD}
              />
            </div>

            <div>
              <label htmlFor="login-password" className={FIELD_LABEL}>Password</label>
              <input
                id="login-password"
                type="password"
                autoComplete={tab === "signup" ? "new-password" : "current-password"}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                minLength={tab === "signup" ? 8 : 1}
                placeholder={tab === "signup" ? "At least 8 characters" : ""}
                className={PIXEL_FIELD}
              />
            </div>

            {error && (
              <div role="alert" className="rounded-[14px] bg-red-50 px-4 py-3 text-sm text-destructive shadow-[inset_0_0_0_1px_color-mix(in_srgb,var(--danger)_30%,transparent)]">
                {error}
              </div>
            )}

            <button
              type="submit"
              disabled={loading}
              className={PORTAL_BUTTON}
            >
              {loading
                ? "Please wait…"
                : tab === "login"
                  ? "Sign In"
                  : "Create Account"}
            </button>

            {tab === "login" && (
              <p className="text-sm text-center">
                <Link href="/account/forgot-password" className={PORTAL_LINK}>Forgot your password?</Link>
              </p>
            )}

            {tab === "signup" && (
              <p className="text-center text-xs leading-relaxed text-ink-soft">
                Use the same email you used when placing your order so your orders appear automatically.
              </p>
            )}
          </form>
        </div>
        )}
      </div>
    </div>
  );
}

export default function LoginPage() {
  return (
    <Suspense>
      <LoginForm />
    </Suspense>
  );
}
