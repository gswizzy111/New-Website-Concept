"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { AddressAutocomplete } from "@/components/ui/address-autocomplete";
import { KIT_US_STATES } from "@/lib/shipping-address";
import { BUTTON_CN, FIELD_CN, LABEL_CN } from "../auth-card";

type Profile = { name: string; phone: string; street1: string; street2: string; city: string; state: string; zip: string };

function Saved({ ok, error }: { ok: boolean; error: string }) {
  if (error) return <p role="alert" className="text-sm text-red-700">{error}</p>;
  if (ok) return <p role="status" className="text-sm font-semibold text-green-700">Saved.</p>;
  return null;
}

/** Name, phone and default shipping address (used to prefill checkout). */
export function ProfileForm({ email, initial }: { email: string; initial: Profile }) {
  const router = useRouter();
  const [f, setF] = useState(initial);
  const [saving, setSaving] = useState(false);
  const [ok, setOk] = useState(false);
  const [error, setError] = useState("");
  const set = (k: keyof Profile, v: string) => { setOk(false); setF((p) => ({ ...p, [k]: v })); };

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setSaving(true);
    const hasAddress = !!f.street1.trim();
    const res = await fetch("/api/account/profile", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: f.name,
        phone: f.phone,
        address: hasAddress ? { street1: f.street1, street2: f.street2, city: f.city, state: f.state, zip: f.zip } : null,
      }),
    });
    const data = await res.json().catch(() => ({}));
    setSaving(false);
    if (!res.ok) return setError(data.error ?? "Something went wrong. Please try again.");
    setOk(true);
    router.refresh();
  }

  return (
    <form onSubmit={save} className="bg-white rounded-xl border border-border p-6 flex flex-col gap-4">
      <h2 className="font-heading font-black text-lg text-foreground">Your details</h2>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div>
          <label htmlFor="p-name" className={LABEL_CN}>Full name</label>
          <input id="p-name" autoComplete="name" required value={f.name} onChange={(e) => set("name", e.target.value)} className={FIELD_CN} />
        </div>
        <div>
          <label htmlFor="p-phone" className={LABEL_CN}>Phone</label>
          <input id="p-phone" type="tel" autoComplete="tel" value={f.phone} onChange={(e) => set("phone", e.target.value)} placeholder="(555) 000-0000" className={FIELD_CN} />
        </div>
        <div className="sm:col-span-2">
          <p className={LABEL_CN}>Email</p>
          <p className="text-sm text-foreground [overflow-wrap:anywhere]">{email}</p>
        </div>
      </div>

      <h3 className="font-heading font-bold text-base text-foreground mt-2">Default shipping address</h3>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div className="sm:col-span-2">
          <label htmlFor="p-street1" className={LABEL_CN}>Street address</label>
          <AddressAutocomplete
            id="p-street1"
            value={f.street1}
            onChange={(v) => set("street1", v)}
            onPlaceSelect={(a) => { setOk(false); setF((p) => ({ ...p, street1: a.street1, city: a.city, state: a.state, zip: a.zip })); }}
            className={FIELD_CN}
            placeholder="123 Main St"
          />
        </div>
        <div className="sm:col-span-2">
          <label htmlFor="p-street2" className={LABEL_CN}>Apt / Suite</label>
          <input id="p-street2" autoComplete="address-line2" value={f.street2} onChange={(e) => set("street2", e.target.value)} className={FIELD_CN} />
        </div>
        <div>
          <label htmlFor="p-city" className={LABEL_CN}>City</label>
          <input id="p-city" autoComplete="address-level2" value={f.city} onChange={(e) => set("city", e.target.value)} className={FIELD_CN} />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label htmlFor="p-state" className={LABEL_CN}>State</label>
            <select id="p-state" autoComplete="address-level1" value={f.state} onChange={(e) => set("state", e.target.value)} className={FIELD_CN}>
              <option value="">State</option>
              {KIT_US_STATES.map((s) => <option key={s.value} value={s.value}>{s.value}</option>)}
            </select>
          </div>
          <div>
            <label htmlFor="p-zip" className={LABEL_CN}>ZIP</label>
            <input id="p-zip" autoComplete="postal-code" inputMode="numeric" value={f.zip} onChange={(e) => set("zip", e.target.value)} className={FIELD_CN} />
          </div>
        </div>
      </div>
      <Saved ok={ok} error={error} />
      <button type="submit" disabled={saving} className={`${BUTTON_CN} sm:w-auto sm:px-8 sm:self-start`}>{saving ? "Saving…" : "Save details"}</button>
    </form>
  );
}

export function PasswordForm() {
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [saving, setSaving] = useState(false);
  const [ok, setOk] = useState(false);
  const [error, setError] = useState("");

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setOk(false);
    if (next.length < 8) return setError("New password must be at least 8 characters.");
    setSaving(true);
    const res = await fetch("/api/account/password", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ current_password: current, new_password: next }),
    });
    const data = await res.json().catch(() => ({}));
    setSaving(false);
    if (!res.ok) return setError(data.error ?? "Something went wrong. Please try again.");
    setOk(true);
    setCurrent("");
    setNext("");
  }

  return (
    <form onSubmit={save} className="bg-white rounded-xl border border-border p-6 flex flex-col gap-4">
      <h2 className="font-heading font-black text-lg text-foreground">Change password</h2>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div>
          <label htmlFor="pw-current" className={LABEL_CN}>Current password</label>
          <input id="pw-current" type="password" autoComplete="current-password" required value={current} onChange={(e) => setCurrent(e.target.value)} className={FIELD_CN} />
        </div>
        <div>
          <label htmlFor="pw-new" className={LABEL_CN}>New password</label>
          <input id="pw-new" type="password" autoComplete="new-password" required minLength={8} value={next} onChange={(e) => setNext(e.target.value)} placeholder="At least 8 characters" className={FIELD_CN} />
        </div>
      </div>
      <Saved ok={ok} error={error} />
      <button type="submit" disabled={saving} className={`${BUTTON_CN} sm:w-auto sm:px-8 sm:self-start`}>{saving ? "Saving…" : "Change password"}</button>
    </form>
  );
}
