"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { US_STATES } from "@/lib/constants";
import { AddressAutocomplete } from "@/components/ui/address-autocomplete";
import { subscriptionDisclosures, subscriptionEnrollLabel } from "@/lib/subscription-terms";
import { MissingNote, Need, Req, revealMissing } from "@/components/checkout/required";
import { ArrowRight, CalendarClock, Package, Truck } from "lucide-react";

// The field look: 48px tall, 12px corners, a 1.5px edge, cobalt focus.
const FIELD =
  "h-12 w-full min-w-0 rounded-[12px] border-[1.5px] border-input bg-white px-4 text-base text-ink outline-none transition-[border-color,box-shadow] duration-150 placeholder:text-ink-soft hover:border-ink-soft focus-visible:border-cobalt focus-visible:shadow-[0_0_0_4px_var(--cobalt-wash)] md:text-[15px]";
const LABEL = "mb-2 block text-[15px] font-bold text-ink";

function formatPrice(cents: number) {
  return `$${(cents / 100).toFixed(2)}`;
}

export function SubscribeForm({ priceCents }: { priceCents: number }) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Enrolling is its own affirmative choice, never pre-checked (Terms Section 26)
  const [enroll, setEnroll] = useState(false);
  // Pressed subscribe with something missing: outline it in red
  const [showMissing, setShowMissing] = useState(false);

  const [form, setForm] = useState({
    name: "",
    email: "",
    phone: "",
    street1: "",
    street2: "",
    city: "",
    state: "",
    zip: "",
  });

  function handleChange(e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) {
    setForm((prev) => ({ ...prev, [e.target.name]: e.target.value }));
  }

  const miss = (v: string) => showMissing && !v.trim();
  const ready = !!(form.name.trim() && form.email.trim() && form.phone.trim() && form.street1.trim() && form.city.trim() && form.state && form.zip.trim() && enroll);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!ready) {
      setShowMissing(true);
      revealMissing();
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/subscribe/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...form, enroll }),
      });
      const data = await res.json();
      if (!res.ok) { setError(data.error ?? "Something went wrong. Please try again."); return; }
      if (data.url) router.push(data.url);
    } catch {
      setError("Network error. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  const priceLabel = formatPrice(priceCents);

  return (
    <div className="surface-chalk min-h-screen overflow-x-clip">
      <div className="wrap pt-12 pb-20 md:pt-20 md:pb-28">
        <div className="grid gap-x-16 gap-y-10 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.05fr)] lg:items-start">
          {/* The plan, as a product tile */}
          <div className="min-w-0 lg:sticky lg:top-[calc(var(--header-h)+32px)]">
            <h1 className="hero-in font-display text-[clamp(3.25rem,13vw,4.5rem)] leading-[0.88] font-black text-ink md:text-[clamp(4.5rem,7vw,6.75rem)]">
              Monthly Kit Club
            </h1>

            <div className="hero-in surface-ink relative isolate mt-9 overflow-hidden rounded-[22px] p-7 md:mt-12 md:p-10" style={{ ["--d" as string]: 160 }}>
              <p className="max-w-[30ch] text-[18px] font-medium leading-relaxed text-on-dark-muted md:text-[20px]">
                Get a fresh restoration kit delivered every month —{" "}
                <span className="mt-3 block font-display text-[64px] font-black leading-[0.85] whitespace-nowrap text-sun tabular-nums md:text-[84px]">
                  {priceLabel}/mo
                </span>
              </p>
              <ul className="mt-8 flex flex-col gap-3.5 border-t border-line-dark pt-7 text-[16px] font-bold text-white">
                <li className="flex items-center gap-3.5">
                  <span aria-hidden className="grid size-9 shrink-0 place-items-center rounded-full bg-sun text-ink"><Package className="size-[18px]" strokeWidth={2} /></span>
                  1 Restoration Kit every month
                </li>
                <li className="flex items-center gap-3.5">
                  <span aria-hidden className="grid size-9 shrink-0 place-items-center rounded-full bg-sun text-ink"><CalendarClock className="size-[18px]" strokeWidth={2} /></span>
                  Automatic billing — cancel anytime
                </li>
                <li className="flex items-center gap-3.5">
                  <span aria-hidden className="grid size-9 shrink-0 place-items-center rounded-full bg-sun text-ink"><Truck className="size-[18px]" strokeWidth={2} /></span>
                  Free US shipping included
                </li>
              </ul>
            </div>
          </div>

        {/* Form card */}
        <div className="panel min-w-0 p-6 md:p-10">
          <h2 className="caps mb-7 font-display text-[32px] font-black leading-none text-ink md:text-[40px]">Your shipping details</h2>

          {error && (
            <div role="alert" className="mb-6 rounded-[12px] bg-[#fdecea] px-4 py-3 text-sm font-bold text-destructive">{error}</div>
          )}

          <form onSubmit={handleSubmit} noValidate className="flex flex-col gap-4">
            <Need missing={miss(form.name)}>
              <label htmlFor="name" className={LABEL}>Full Name<Req /></label>
              <input id="name" name="name" type="text" required value={form.name} onChange={handleChange}
                placeholder="Jane Smith" className={FIELD} />
            </Need>
            <Need missing={miss(form.email)}>
              <label htmlFor="email" className={LABEL}>Email<Req /></label>
              <input id="email" name="email" type="email" required value={form.email} onChange={handleChange}
                placeholder="jane@example.com" className={FIELD} />
            </Need>
            <Need missing={miss(form.phone)}>
              <label htmlFor="phone" className={LABEL}>Phone<Req /></label>
              <input id="phone" name="phone" type="tel" required value={form.phone} onChange={handleChange}
                placeholder="(555) 555-5555" className={FIELD} />
            </Need>
            <Need missing={miss(form.street1)}>
              <label htmlFor="street1" className={LABEL}>Street Address<Req /></label>
              <AddressAutocomplete
                id="street1"
                value={form.street1}
                onChange={(v) => setForm((prev) => ({ ...prev, street1: v }))}
                onPlaceSelect={(f) => setForm((prev) => ({ ...prev, street1: f.street1, city: f.city, state: f.state, zip: f.zip }))}
                placeholder="123 Main St"
                className={FIELD}
              />
            </Need>
            <div>
              <label htmlFor="street2" className={LABEL}>
                Apt / Suite <span className="text-ink-soft font-normal">(optional)</span>
              </label>
              <input id="street2" name="street2" type="text" value={form.street2} onChange={handleChange}
                placeholder="Apt 4B" className={FIELD} />
            </div>
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
              <Need missing={miss(form.city)} className="col-span-2 sm:col-span-1">
                <label htmlFor="city" className={LABEL}>City<Req /></label>
                <input id="city" name="city" type="text" required value={form.city} onChange={handleChange}
                  placeholder="Chicago" className={FIELD} />
              </Need>
              <Need missing={miss(form.state)}>
                <label htmlFor="state" className={LABEL}>State<Req /></label>
                <select id="state" name="state" required value={form.state} onChange={handleChange}
                  className={FIELD}>
                  <option value="">—</option>
                  {US_STATES.map((s) => <option key={s.value} value={s.value}>{s.value}</option>)}
                </select>
              </Need>
              <Need missing={miss(form.zip)}>
                <label htmlFor="zip" className={LABEL}>ZIP<Req /></label>
                <input id="zip" name="zip" type="text" required value={form.zip} onChange={handleChange}
                  placeholder="60601" className={FIELD} />
              </Need>
            </div>

            <div className="mt-3 rounded-[18px] bg-sun-tint p-5 shadow-[inset_0_0_0_1px_rgba(242,182,0,0.45)]">
              <p className="label-caps mb-3 text-[17px] text-ink">Before you subscribe</p>
              <ul className="flex list-disc flex-col gap-2 pl-5 text-[14px] leading-relaxed text-ink marker:text-cobalt">
                {subscriptionDisclosures(priceCents).map((d) => <li key={d}>{d}</li>)}
              </ul>
            </div>
            <Need missing={showMissing && !enroll} note="Check this box to subscribe.">
            <label className="flex min-h-11 items-start gap-3 py-1 text-sm cursor-pointer">
              <input type="checkbox" checked={enroll} onChange={(e) => setEnroll(e.target.checked)} className="mt-0.5 size-5 shrink-0 accent-cobalt" />
              <span className="font-bold text-ink">{subscriptionEnrollLabel(priceCents)}<Req /></span>
            </label>
            </Need>

            <MissingNote show={showMissing && !ready} />
            <button type="submit" disabled={loading}
              className="btn btn-sun btn-lg mt-2 w-full disabled:opacity-60">
              {loading ? "Redirecting to checkout…" : `Subscribe — ${priceLabel}/mo`}
              {!loading && <ArrowRight aria-hidden className="size-5" strokeWidth={2} />}
            </button>

            <p className="text-center text-[13px] text-ink-soft">
              Secured by Stripe. Cancel anytime online or by email.
            </p>
          </form>
        </div>
        </div>
      </div>
    </div>
  );
}
