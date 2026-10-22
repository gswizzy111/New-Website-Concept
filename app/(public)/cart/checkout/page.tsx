"use client";

import { Check, Info } from "lucide-react";
import { useState, Suspense } from "react";
import { useCart } from "@/lib/cart-context";
import { formatCurrency } from "@/lib/utils";
import { toast } from "sonner";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { KIT_US_STATES, addressProblem } from "@/lib/shipping-address";
import { AddressAutocomplete } from "@/components/ui/address-autocomplete";
import { MissingNote, Need, Req, revealMissing } from "@/components/checkout/required";
import { useAccountPrefill } from "@/lib/use-account-prefill";
import type { KitRate } from "@/lib/kit-shipping";

const INPUT_CN = "h-8 w-full min-w-0 rounded-lg border border-input bg-transparent px-2.5 py-1 text-base transition-colors outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 md:text-sm";

const COUNTRIES = [
  { code: "CA", name: "Canada" },
  { code: "GB", name: "United Kingdom" },
  { code: "AU", name: "Australia" },
  { code: "DE", name: "Germany" },
  { code: "FR", name: "France" },
  { code: "JP", name: "Japan" },
  { code: "KR", name: "South Korea" },
  { code: "NL", name: "Netherlands" },
  { code: "ES", name: "Spain" },
  { code: "IT", name: "Italy" },
  { code: "BE", name: "Belgium" },
  { code: "CH", name: "Switzerland" },
  { code: "SE", name: "Sweden" },
  { code: "DK", name: "Denmark" },
  { code: "NO", name: "Norway" },
  { code: "NZ", name: "New Zealand" },
  { code: "SG", name: "Singapore" },
  { code: "MX", name: "Mexico" },
  { code: "BR", name: "Brazil" },
  { code: "PT", name: "Portugal" },
  { code: "PL", name: "Poland" },
  { code: "AT", name: "Austria" },
  { code: "IE", name: "Ireland" },
  { code: "FI", name: "Finland" },
  { code: "HK", name: "Hong Kong" },
  { code: "TW", name: "Taiwan" },
  { code: "ZA", name: "South Africa" },
  { code: "AE", name: "United Arab Emirates" },
];

// If Shippo can't quote at all, US orders still go through at the old flat
// rate (no rate ID, so the label is bought by hand as before)
const FLAT_US_SHIPPING: KitRate = { id: "", provider: "", service: "Standard Shipping", days: null, postageCents: 599, priceCents: 599 };
const SELECT_CN = "flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-xs outline-none";

function rateName(r: KitRate) {
  return [r.provider, r.service].filter(Boolean).join(" ");
}

function rateEta(r: KitRate) {
  if (!r.id) return null;
  if (!r.days) return "Delivery estimate unavailable";
  return `Est. ${r.days} ${r.days === 1 ? "day" : "days"} in transit`;
}

function CheckoutInner() {
  const { items, totalCents, clearCart } = useCart();
  const searchParams = useSearchParams();
  const isInternational = searchParams.get("international") === "true";

  const [submitting, setSubmitting] = useState(false);
  // Pressed pay (or see shipping) with something missing: outline it in red
  const [showMissing, setShowMissing] = useState(false);
  const miss = (v: string | undefined) => showMissing && !v?.trim();
  const [form, setForm] = useState({
    name: "", email: "", phone: "",
    street1: "", street2: "", city: "", state: "", zip: "", country: "",
  });

  // Creator / coupon code
  const [codeInput, setCodeInput] = useState("");
  const [creatorCode, setCreatorCode] = useState("");
  const [codeStatus, setCodeStatus] = useState<"idle" | "checking" | "valid" | "invalid">("idle");
  const [discountPercent, setDiscountPercent] = useState(0);

  // Gift card
  const [gcInput, setGcInput] = useState("");
  const [gcStatus, setGcStatus] = useState<"idle" | "valid" | "invalid">("idle");
  const [giftCardCode, setGiftCardCode] = useState("");
  const [giftCardAmountCents, setGiftCardAmountCents] = useState(0);

  // Shipping: live options for this address, priced by speed
  const [rateStatus, setRateStatus] = useState<"idle" | "loading" | "done" | "error">("idle");
  const [rates, setRates] = useState<KitRate[]>([]);
  const [chosenRate, setChosenRate] = useState<KitRate | null>(null);
  const [rateError, setRateError] = useState("");

  function resetRates() {
    setRates([]);
    setChosenRate(null);
    setRateStatus("idle");
    setRateError("");
  }

  function set(field: string, value: string) {
    setForm((prev) => ({ ...prev, [field]: value }));
    // A quote is only good for the address it was made for
    if (["street1", "city", "state", "zip", "country"].includes(field)) resetRates();
  }

  // Signed in: fill what's still empty from the account (US address only)
  useAccountPrefill((p) => {
    setForm((prev) => ({
      ...prev,
      name: prev.name || p.name,
      email: prev.email || p.email,
      phone: prev.phone || p.phone,
      ...(!isInternational && p.address && !prev.street1 && !prev.city && !prev.zip
        ? { street1: p.address.street1, street2: p.address.street2, city: p.address.city, state: p.address.state, zip: p.address.zip }
        : {}),
    }));
  });

  async function applyCreatorCode() {
    const trimmed = codeInput.trim();
    if (!trimmed) return;
    setCodeStatus("checking");
    try {
      const res = await fetch(`/api/affiliates/validate?code=${encodeURIComponent(trimmed)}`);
      const data = await res.json();
      if (res.ok && data.ok) {
        setCreatorCode(trimmed);
        setCodeStatus("valid");
        setDiscountPercent(data.discount_percent ?? 0);
      } else {
        setCreatorCode("");
        setCodeStatus("invalid");
        setDiscountPercent(0);
      }
    } catch {
      setCreatorCode("");
      setCodeStatus("invalid");
      setDiscountPercent(0);
    }
  }

  async function validateGiftCard() {
    const trimmed = gcInput.trim().toUpperCase();
    if (!trimmed) return;
    const res = await fetch(`/api/gift-cards/validate?code=${encodeURIComponent(trimmed)}`);
    const data = await res.json();
    if (res.ok && data.ok) {
      setGiftCardCode(trimmed);
      setGcStatus("valid");
      setGiftCardAmountCents(data.remaining_cents);
    } else {
      setGiftCardCode("");
      setGcStatus("invalid");
      setGiftCardAmountCents(0);
    }
  }

  async function calculateShipping() {
    setRateStatus("loading");
    setRateError("");
    setRates([]);
    setChosenRate(null);
    try {
      const res = await fetch("/api/shop/shipping-rates", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: form.name,
          phone: form.phone,
          email: form.email,
          address: {
            street1: form.street1,
            street2: form.street2 || undefined,
            city: form.city,
            state: form.state || "",
            zip: form.zip,
            country: isInternational ? form.country : "US",
          },
          item_names: items.map((i) => i.name),
          declared_value_cents: totalCents,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.status === 502 && !isInternational) {
        setRates([FLAT_US_SHIPPING]);
        setChosenRate(FLAT_US_SHIPPING);
        setRateStatus("done");
        return;
      }
      if (!res.ok || !Array.isArray(data.rates) || data.rates.length === 0) {
        setRateError(data.error ?? "We couldn't get shipping prices. Please try again.");
        setRateStatus("error");
        return;
      }
      // Cheapest first; the customer can pick a faster one
      setRates(data.rates);
      setChosenRate(data.rates[0]);
      setRateStatus("done");
    } catch {
      setRateError("Network error. Please try again.");
      setRateStatus("error");
    }
  }

  // Same check the checkout API runs: a complete address with a house number
  const addressIssue = addressProblem({ ...form, country: isInternational ? form.country : "US" });
  const addressStarted = !!(form.street1 || form.city || form.zip);

  function isAddressValid() {
    if (!form.name || !form.email || !form.phone) return false;
    return addressIssue === null;
  }

  function canPay() {
    return isAddressValid() && rateStatus === "done" && !!chosenRate;
  }

  function showWhatsMissing() {
    setShowMissing(true);
    revealMissing();
  }

  async function handleCheckout() {
    if (!canPay()) return showWhatsMissing();
    setSubmitting(true);
    try {
      const body: Record<string, unknown> = {
        items: items.map((i) => ({ id: i.id, quantity: i.quantity, slug: i.slug, size: i.size ?? undefined })),
        customer: { name: form.name, email: form.email, phone: form.phone },
        address: {
          street1: form.street1,
          street2: form.street2 || undefined,
          city: form.city,
          state: form.state || "",
          zip: form.zip,
          country: isInternational ? form.country : "US",
        },
      };
      if (codeStatus === "valid" && creatorCode) body.affiliate_code = creatorCode;
      if (gcStatus === "valid" && giftCardCode) body.gift_card_code = giftCardCode;
      if (chosenRate?.id) body.shipping_rate_id = chosenRate.id;

      const res = await fetch("/api/shop/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (data.url) {
        clearCart();
        window.location.href = data.url;
      } else {
        toast.error(typeof data.error === "string" ? data.error : "Something went wrong.");
        if (typeof data.error === "string" && /recalculate shipping/i.test(data.error)) resetRates();
        setSubmitting(false);
      }
    } catch {
      toast.error("Network error. Please try again.");
      setSubmitting(false);
    }
  }

  const shippingCents = chosenRate?.priceCents ?? 0;
  const discountCents = discountPercent > 0 ? Math.round(totalCents * discountPercent / 100) : 0;
  const discountedTotal = totalCents - discountCents;
  const taxCents = Math.round(discountedTotal * 0.06625);
  const preTaxTotal = discountedTotal + taxCents + shippingCents;
  const gcApplied = Math.min(giftCardAmountCents, preTaxTotal);
  const finalTotal = preTaxTotal - gcApplied;

  if (items.length === 0) {
    return (
      <div className="max-w-xl mx-auto px-6 py-24 text-center">
        <p className="text-muted-foreground mb-4">Your cart is empty.</p>
        <Button render={<Link href="/shop" />}>Browse Shop</Button>
      </div>
    );
  }

  return (
    <div className="max-w-4xl mx-auto px-6 md:px-8 py-12">
      <div className="flex items-center gap-3 mb-8">
        <h1 className="font-heading font-extrabold text-3xl text-foreground">Checkout</h1>
        {isInternational && (
          <span className="text-xs font-bold px-2.5 py-1 rounded-full bg-blue-100 text-blue-700">International</span>
        )}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-5 gap-10">
        {/* Form */}
        <div className="lg:col-span-3 flex flex-col gap-6">

          {/* Contact */}
          <div className="bg-white border border-border rounded-lg p-6">
            <h2 className="font-heading font-extrabold text-lg text-foreground mb-4">Contact</h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <Need missing={miss(form.name)} className="sm:col-span-2 flex flex-col gap-1.5">
                <Label>Full Name<Req /></Label>
                <Input value={form.name} onChange={(e) => set("name", e.target.value)} placeholder="John Smith" autoComplete="name" />
              </Need>
              <Need missing={miss(form.email)} className="flex flex-col gap-1.5">
                <Label>Email<Req /></Label>
                <Input type="email" value={form.email} onChange={(e) => set("email", e.target.value)} placeholder="john@email.com" autoComplete="email" />
              </Need>
              <Need missing={miss(form.phone)} className="flex flex-col gap-1.5">
                <Label>Phone<Req /></Label>
                <Input type="tel" value={form.phone} onChange={(e) => set("phone", e.target.value)} placeholder="(555) 000-0000" autoComplete="tel" />
              </Need>
            </div>
          </div>

          {/* Shipping Address */}
          <div className="bg-white border border-border rounded-lg p-6">
            <h2 className="font-heading font-extrabold text-lg text-foreground mb-4">Shipping Address</h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              {isInternational && (
                <Need missing={miss(form.country)} className="sm:col-span-2 flex flex-col gap-1.5">
                  <Label>Country<Req /></Label>
                  <select
                    value={form.country}
                    onChange={(e) => set("country", e.target.value)}
                    autoComplete="country"
                    className={SELECT_CN}
                  >
                    <option value="">Select country</option>
                    {COUNTRIES.map((c) => (
                      <option key={c.code} value={c.code}>{c.name}</option>
                    ))}
                  </select>
                </Need>
              )}
              <Need missing={miss(form.street1)} className="sm:col-span-2 flex flex-col gap-1.5">
                <Label>Street Address<Req /></Label>
                <AddressAutocomplete
                  value={form.street1}
                  onChange={(v) => set("street1", v)}
                  onPlaceSelect={(f) => { setForm((prev) => ({ ...prev, street1: f.street1, city: f.city, state: f.state, zip: f.zip })); resetRates(); }}
                  countries={isInternational ? (form.country ? [form.country.toLowerCase()] : []) : ["us"]}
                  className={INPUT_CN}
                  placeholder="123 Main St"
                />
              </Need>
              <div className="sm:col-span-2 flex flex-col gap-1.5">
                <Label>Apt / Suite</Label>
                <Input value={form.street2} onChange={(e) => set("street2", e.target.value)} placeholder="Apt 4B" autoComplete="address-line2" />
              </div>
              <Need missing={miss(form.city)} className="flex flex-col gap-1.5">
                <Label>City<Req /></Label>
                <Input value={form.city} onChange={(e) => set("city", e.target.value)} placeholder="London" autoComplete="address-level2" />
              </Need>
              {isInternational ? (
                <div className="flex flex-col gap-1.5">
                  <Label>State / Province</Label>
                  <Input value={form.state} onChange={(e) => set("state", e.target.value)} placeholder="Optional" autoComplete="address-level1" />
                </div>
              ) : (
                <Need missing={miss(form.state)} className="flex flex-col gap-1.5">
                  <Label>State<Req /></Label>
                  <select
                    value={form.state}
                    onChange={(e) => set("state", e.target.value)}
                    autoComplete="address-level1"
                    className={SELECT_CN}
                  >
                    <option value="">Select state</option>
                    {KIT_US_STATES.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
                  </select>
                </Need>
              )}
              <Need missing={miss(form.zip)} className="flex flex-col gap-1.5">
                <Label>Postal Code<Req /></Label>
                <Input value={form.zip} onChange={(e) => set("zip", e.target.value)} placeholder="SW1A 1AA" autoComplete="postal-code" inputMode={isInternational ? undefined : "numeric"} />
              </Need>
            </div>

            {addressStarted && addressIssue && (
              <p role="alert" className="text-xs font-semibold text-red-600 mt-3">{addressIssue}</p>
            )}

            {/* Shipping options: live prices for this address, by speed */}
            <Need missing={showMissing && isAddressValid() && !(rateStatus === "done" && chosenRate)} note="See shipping options and choose one." className="mt-5 pt-5 border-t border-border">
              <h3 className="text-sm font-bold text-foreground mb-3">Shipping speed<Req /></h3>
              {rateStatus !== "done" && (
                <button
                  type="button"
                  onClick={() => (isAddressValid() ? calculateShipping() : showWhatsMissing())}
                  disabled={rateStatus === "loading"}
                  className="w-full h-10 bg-secondary text-foreground text-sm font-bold rounded-lg hover:bg-secondary/70 disabled:opacity-40 transition-colors"
                >
                  {rateStatus === "loading" ? "Getting prices..." : "See shipping options"}
                </button>
              )}
              {rateStatus === "idle" && !isAddressValid() && (
                <p className="text-xs text-muted-foreground mt-2">Fill in your contact details and address to see prices.</p>
              )}
              {rateStatus === "error" && (
                <p role="alert" className="text-xs font-semibold text-red-600 mt-2">{rateError}</p>
              )}

              {rateStatus === "done" && rates.length > 0 && (
                <fieldset>
                  <legend className="sr-only">Choose a shipping speed</legend>
                  <div className="flex flex-col gap-2">
                    {rates.map((r) => {
                      const chosen = chosenRate?.id === r.id;
                      return (
                        <label
                          key={r.id || "flat"}
                          className={`flex items-center gap-3 rounded-lg border px-4 py-3 cursor-pointer transition-colors has-[:focus-visible]:ring-3 has-[:focus-visible]:ring-ring/50 ${
                            chosen ? "border-rx bg-rx-soft" : "border-border hover:border-rx/50"
                          }`}
                        >
                          <input
                            type="radio"
                            name="kit-shipping"
                            value={r.id}
                            checked={chosen}
                            onChange={() => setChosenRate(r)}
                            className="h-4 w-4 shrink-0 accent-[var(--rx)]"
                          />
                          <span className="flex-1 min-w-0">
                            <span className={`block text-sm font-semibold ${chosen ? "text-rx" : "text-foreground"}`}>{rateName(r)}</span>
                            {rateEta(r) && <span className="block text-xs text-muted-foreground">{rateEta(r)}</span>}
                          </span>
                          <span className={`text-sm font-bold tabular-nums ${chosen ? "text-rx" : "text-foreground"}`}>{formatCurrency(r.priceCents)}</span>
                        </label>
                      );
                    })}
                  </div>
                  <p className="text-xs text-muted-foreground mt-2">
                    {rates[0].id
                      ? `Prices include ${formatCurrency(rates[0].priceCents - rates[0].postageCents)} handling. Your shipping label is created as soon as you pay.`
                      : "Live shipping prices aren't available right now, so standard shipping applies."}
                  </p>
                </fieldset>
              )}
            </Need>
          </div>

          {/* Creator Code */}
          <div className="bg-white border border-border rounded-lg p-6">
            <h2 className="font-heading font-extrabold text-lg text-foreground mb-1">Creator Code</h2>
            <p className="text-xs text-muted-foreground mb-3">Have a creator code? Enter it here.</p>
            <div className="flex gap-2">
              <Input
                value={codeInput}
                onChange={(e) => { setCodeInput(e.target.value.toUpperCase()); setCodeStatus("idle"); setCreatorCode(""); setDiscountPercent(0); }}
                onBlur={applyCreatorCode}
                placeholder="CREATORCODE"
                className="flex-1 font-mono uppercase"
              />
              <button type="button" onClick={applyCreatorCode}
                className="px-4 h-9 bg-secondary text-foreground text-sm font-bold rounded-lg hover:bg-secondary/70 transition-colors whitespace-nowrap">
                Apply
              </button>
            </div>
            {codeStatus === "checking" && <p className="text-xs text-muted-foreground mt-2">Checking...</p>}
            {codeStatus === "valid" && discountPercent > 0 && <p className="text-xs text-rx font-semibold mt-2"><Check className="inline h-3 w-3 mr-1 -mt-0.5" strokeWidth={2.5} />{discountPercent}% discount applied</p>}
            {codeStatus === "valid" && discountPercent === 0 && <p className="text-xs text-rx font-semibold mt-2"><Check className="inline h-3 w-3 mr-1 -mt-0.5" strokeWidth={2.5} />Code applied</p>}
            {codeStatus === "invalid" && <p className="text-xs text-red-600 mt-2">Invalid code. Please try again.</p>}
          </div>

          {/* Gift Card */}
          <div className="bg-white border border-border rounded-lg p-6">
            <h2 className="font-heading font-extrabold text-lg text-foreground mb-1">Gift Card</h2>
            <p className="text-xs text-muted-foreground mb-3">Have a gift card code? Enter it here.</p>
            <div className="flex gap-2">
              <Input
                value={gcInput}
                onChange={(e) => { setGcInput(e.target.value.toUpperCase()); setGcStatus("idle"); setGiftCardCode(""); setGiftCardAmountCents(0); }}
                placeholder="GIFT-XXXX-XXXX"
                className="flex-1 font-mono uppercase"
              />
              <button type="button" onClick={validateGiftCard}
                className="px-4 h-9 bg-secondary text-foreground text-sm font-bold rounded-lg hover:bg-secondary/70 transition-colors whitespace-nowrap">
                Apply
              </button>
            </div>
            {gcStatus === "valid" && gcApplied > 0 && <p className="text-xs text-rx font-semibold mt-2"><Check className="inline h-3 w-3 mr-1 -mt-0.5" strokeWidth={2.5} />{formatCurrency(gcApplied)} off applied</p>}
            {gcStatus === "invalid" && <p className="text-xs text-red-600 mt-2">Invalid or already used gift card.</p>}
          </div>
        </div>

        {/* Order summary */}
        <div className="lg:col-span-2">
          <div className="bg-white border border-border rounded-lg p-6 sticky top-24">
            <h2 className="font-heading font-extrabold text-lg text-foreground mb-4">Order Summary</h2>
            <div className="flex flex-col gap-3 mb-4">
              {items.map((item) => (
                <div key={item.id} className="flex justify-between text-sm">
                  <span className="text-muted-foreground">{item.name} × {item.quantity}</span>
                  <span className="font-medium">{formatCurrency(item.price_cents * item.quantity)}</span>
                </div>
              ))}
              {discountCents > 0 && (
                <div className="flex justify-between text-sm text-green-600 font-semibold">
                  <span>Discount ({discountPercent}% off)</span>
                  <span>−{formatCurrency(discountCents)}</span>
                </div>
              )}
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">Sales Tax (6.625%)</span>
                <span className="font-medium">{formatCurrency(taxCents)}</span>
              </div>
              <div className="flex justify-between gap-3 text-sm">
                <span className="text-muted-foreground">
                  Shipping{chosenRate ? <span className="block text-xs">{rateName(chosenRate)}</span> : null}
                </span>
                {chosenRate
                  ? <span className="font-medium">{formatCurrency(shippingCents)}</span>
                  : <span className="text-muted-foreground text-xs">Choose a speed</span>}
              </div>
              {gcApplied > 0 && (
                <div className="flex justify-between text-sm text-green-600 font-semibold">
                  <span>Gift Card</span>
                  <span>−{formatCurrency(gcApplied)}</span>
                </div>
              )}
              <div className="border-t border-border pt-2 flex justify-between font-bold">
                <span>Total</span>
                <span className="text-primary">{formatCurrency(finalTotal)}</span>
              </div>
            </div>
            {!chosenRate && (
              <p className="text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 mb-4">
                Enter your address and choose a shipping speed before paying.
              </p>
            )}
            <p className="flex items-start gap-2 text-sm text-ink mb-4">
              <Info className="h-4 w-4 mt-0.5 shrink-0 text-rx" strokeWidth={1.75} />
              All sales final. Defective or missing items are replaced or refunded.
            </p>
            <Button
              onClick={handleCheckout}
              disabled={submitting}
              className="w-full font-bold"
            >
              {submitting ? "Redirecting..." : "Pay Securely with Stripe"}
            </Button>
            <MissingNote show={showMissing && !canPay()} />
          </div>
        </div>
      </div>
    </div>
  );
}

export default function ProductCheckoutPage() {
  return (
    <Suspense>
      <CheckoutInner />
    </Suspense>
  );
}
