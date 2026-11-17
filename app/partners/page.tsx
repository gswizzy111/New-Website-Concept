"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { FIELD_LABEL, PORTAL_BUTTON, PortalCard } from "@/components/account/portal";

export default function PartnerLoginPage() {
  const [passcode, setPasscode] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const router = useRouter();

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError("");
    try {
      const res = await fetch("/api/partners/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ passcode }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Invalid passcode");
      router.push("/partners/dashboard");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Invalid passcode");
      setLoading(false);
    }
  }

  return (
    <PortalCard width="max-w-sm">
        <h1 className="mb-1 font-heading text-[2.25rem] leading-[0.95] font-black text-ink">Partner Portal</h1>
        <p className="mb-6 text-sm text-ink-soft">The Card Doc</p>
        <form onSubmit={handleLogin} className="flex flex-col gap-4">
          <div>
            <label htmlFor="partner-passcode" className={FIELD_LABEL}>
              Passcode
            </label>
            <input
              id="partner-passcode"
              type="password"
              value={passcode}
              onChange={(e) => setPasscode(e.target.value)}
              placeholder="Enter your passcode"
              className="w-full h-11 min-w-0 rounded-[12px] border-[1.5px] border-input bg-white px-3.5 text-base outline-none transition-[border-color] placeholder:text-muted-foreground hover:border-ink-soft focus-visible:border-cobalt focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-cobalt md:text-[15px]"
              required
            />
          </div>
          {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
          <button
            type="submit"
            disabled={loading}
            className={PORTAL_BUTTON}
          >
            {loading ? "Signing in..." : "Sign In"}
          </button>
        </form>
    </PortalCard>
  );
}
