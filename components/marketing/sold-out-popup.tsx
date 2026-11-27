"use client";

import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { Check, Loader2 } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cta } from "@/components/brand/button-class";
import { isValidEmail } from "@/lib/checkout-validation";

/**
 * Site-wide pop-up while restoration tiers are sold out (Admin > Store
 * Settings switch, /api/sold-out-waitlist): "join the waitlist?", then full
 * name and email. Shows once per visit; never again on this device after
 * joining. Signups go to their own list (sold_out_waitlist).
 */

const SEEN_KEY = "tcd-sold-out-popup-seen"; // sessionStorage: asked this visit
const JOINED_KEY = "tcd-sold-out-waitlist-joined"; // localStorage: joined on this device

// Pages where a pop-up would get in the way
const SKIP = [/^\/show-dropoffs/, /^\/checkout/, /\/success/, /^\/cart/, /^\/terms/, /^\/email\//, /^\/affiliates/, /^\/partner/, /^\/subscribe\/manage/];

function readFlag(store: "session" | "local", key: string): boolean {
  try {
    return (store === "session" ? sessionStorage : localStorage).getItem(key) === "1";
  } catch {
    return false;
  }
}
function setFlag(store: "session" | "local", key: string) {
  try {
    (store === "session" ? sessionStorage : localStorage).setItem(key, "1");
  } catch {
    // Storage blocked: it may ask again on the next page
  }
}

export function SoldOutPopup() {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const [step, setStep] = useState<"ask" | "form" | "done">("ask");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [honeypot, setHoneypot] = useState("");
  const [touched, setTouched] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (SKIP.some((re) => re.test(pathname))) return;
    if (readFlag("session", SEEN_KEY) || readFlag("local", JOINED_KEY)) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    fetch("/api/sold-out-waitlist")
      .then((r) => (r.ok ? r.json() : { on: false }))
      .then((d: { on?: boolean }) => {
        if (cancelled || !d.on) return;
        // Let the page draw first
        timer = setTimeout(() => {
          setFlag("session", SEEN_KEY);
          setOpen(true);
        }, 600);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [pathname]);

  const nameOk = name.trim().length >= 2;
  const emailOk = isValidEmail(email.trim());

  async function join(e: React.FormEvent) {
    e.preventDefault();
    setTouched(true);
    setError("");
    if (!nameOk || !emailOk) return;
    setSaving(true);
    try {
      const res = await fetch("/api/sold-out-waitlist", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: name.trim(), email: email.trim(), website: honeypot }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error ?? "We couldn't save that. Please try again.");
        return;
      }
      setFlag("local", JOINED_KEY);
      setStep("done");
    } catch {
      setError("No connection. Please try again.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="gap-0 p-0 sm:max-w-md" showCloseButton>
        <div className="surface-sun rounded-t-[22px] px-6 pt-7 pb-6 md:px-8">
          <p className="eyebrow mb-3 pr-10 text-cobalt-deep">Restoration Services</p>
          <DialogTitle className="pr-8 font-display text-[34px] font-black leading-[0.95] text-ink md:text-[38px]">
            {step === "done" ? "You're on the list!" : "All restoration tiers sold out, want to join the waitlist?"}
          </DialogTitle>
          <DialogDescription className="mt-3 text-[15px] leading-relaxed text-ink">
            {step === "done"
              ? "We'll email you as soon as we open slots."
              : "Leave your name and email and we'll let you know as soon as we open slots."}
          </DialogDescription>
        </div>

        <div className="px-6 pt-6 pb-7 md:px-8">
          {step === "ask" && (
            <div className="flex flex-col gap-2">
              <button type="button" onClick={() => setStep("form")} className={cta({ tone: "ink", size: "lg", className: "w-full justify-center" })}>
                Yes, join the waitlist
              </button>
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="flex min-h-11 w-full items-center justify-center rounded-full text-sm font-semibold text-ink-soft underline underline-offset-4 hover:text-ink"
              >
                No thanks, just browsing
              </button>
            </div>
          )}

          {step === "form" && (
            <form onSubmit={join} noValidate className="flex flex-col gap-4">
              <div aria-hidden className="absolute -left-[9999px] h-px w-px overflow-hidden">
                <label>
                  Website
                  <input tabIndex={-1} autoComplete="off" value={honeypot} onChange={(e) => setHoneypot(e.target.value)} />
                </label>
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="sow-name">Full name</Label>
                <Input
                  id="sow-name"
                  autoComplete="name"
                  value={name}
                  maxLength={120}
                  autoFocus
                  aria-invalid={touched && !nameOk}
                  onChange={(e) => setName(e.target.value)}
                />
                {touched && !nameOk && <p className="text-sm font-medium text-destructive">Enter your full name</p>}
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="sow-email">Email</Label>
                <Input
                  id="sow-email"
                  type="email"
                  inputMode="email"
                  autoComplete="email"
                  value={email}
                  maxLength={200}
                  aria-invalid={touched && !emailOk}
                  onChange={(e) => setEmail(e.target.value)}
                />
                {touched && !emailOk && <p className="text-sm font-medium text-destructive">Enter a valid email</p>}
              </div>
              {error && <p role="alert" className="text-sm font-medium text-destructive">{error}</p>}
              <button type="submit" disabled={saving} className={cta({ tone: "ink", size: "lg", className: "w-full justify-center disabled:opacity-70" })}>
                {saving ? <><Loader2 className="size-5 animate-spin" aria-hidden /> Saving…</> : "Notify me when slots open"}
              </button>
            </form>
          )}

          {step === "done" && (
            <div className="flex flex-col items-center gap-4 text-center">
              <span className="grid size-14 place-items-center rounded-full bg-success-tint text-success">
                <Check className="size-7" strokeWidth={2.5} aria-hidden />
              </span>
              <button type="button" onClick={() => setOpen(false)} className={cta({ tone: "outline", className: "w-full justify-center" })}>
                Keep browsing
              </button>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
