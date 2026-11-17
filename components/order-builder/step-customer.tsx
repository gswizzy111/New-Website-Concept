"use client";

import { Input, PIXEL_FIELD } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { AddressAutocomplete } from "@/components/ui/address-autocomplete";
import { US_STATES } from "@/lib/constants";
import type { CustomerInfo } from "@/lib/types";
import { Need, Req } from "@/components/checkout/required";
import { FORM_PANEL, STEP_TITLE } from "@/components/checkout/form-styles";

const INPUT_CN = PIXEL_FIELD;


interface StepCustomerProps {
  customer: CustomerInfo;
  onChange: (customer: CustomerInfo) => void;
  /** The customer pressed Continue with something missing: outline it in red */
  showMissing?: boolean;
}

export function StepCustomer({ customer, onChange, showMissing = false }: StepCustomerProps) {
  const isUS = customer.country === "US";
  const miss = (v: string | undefined) => showMissing && !v?.trim();

  function update(patch: Partial<CustomerInfo>) {
    onChange({ ...customer, ...patch });
  }

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h2 className={`${STEP_TITLE} mb-4`}>
          Where should we ship them back?
        </h2>
        <p className="lead text-ink-soft">We&apos;ll also use this to confirm your order.</p>
      </div>

      <div className={`${FORM_PANEL} grid grid-cols-1 gap-5 sm:grid-cols-2`}>
        <Need missing={miss(customer.name)} className="sm:col-span-2 flex flex-col gap-1.5">
          <Label htmlFor="full-name">Full Name<Req /></Label>
          <Input
            id="full-name"
            value={customer.name}
            onChange={(e) => update({ name: e.target.value })}
            autoComplete="name"
          />
        </Need>

        <Need missing={miss(customer.email)} className="flex flex-col gap-1.5">
          <Label htmlFor="email">Email<Req /></Label>
          <Input
            id="email"
            type="email"
            value={customer.email}
            onChange={(e) => update({ email: e.target.value })}
            autoComplete="email"
          />
        </Need>

        <Need missing={miss(customer.phone)} className="flex flex-col gap-1.5">
          <Label htmlFor="phone">
            Phone<Req /> <span className="text-xs text-muted-foreground font-normal">(required by carriers)</span>
          </Label>
          <Input
            id="phone"
            type="tel"
            value={customer.phone}
            onChange={(e) => update({ phone: e.target.value })}
            autoComplete="tel"
          />
        </Need>

        <div className="sm:col-span-2 flex flex-col gap-1.5">
          <Label>Country</Label>
          <p className="flex h-11 items-center rounded-[12px] bg-chalk px-3.5 text-[15px] font-semibold text-ink-soft">
            United States
          </p>
        </div>

        <Need missing={miss(customer.street1)} className="sm:col-span-2 flex flex-col gap-1.5">
          <Label htmlFor="street1">Street Address<Req /></Label>
          <AddressAutocomplete
            id="street1"
            value={customer.street1}
            onChange={(v) => update({ street1: v })}
            onPlaceSelect={(f) => update({ street1: f.street1, city: f.city, state: f.state, zip: f.zip })}
            className={INPUT_CN}
          />
        </Need>

        <div className="sm:col-span-2 flex flex-col gap-1.5">
          <Label htmlFor="street2">Apartment, suite, etc.</Label>
          <Input
            id="street2"
            value={customer.street2}
            onChange={(e) => update({ street2: e.target.value })}
            autoComplete="address-line2"
          />
        </div>

        <Need missing={miss(customer.city)} className="flex flex-col gap-1.5">
          <Label htmlFor="city">City<Req /></Label>
          <Input
            id="city"
            value={customer.city}
            onChange={(e) => update({ city: e.target.value })}
            autoComplete="address-level2"
          />
        </Need>

        {isUS ? (
          <Need missing={miss(customer.state)} className="flex flex-col gap-1.5">
            <Label htmlFor="state">State<Req /></Label>
            <Select value={customer.state || undefined} onValueChange={(v: string | null) => { if (v) update({ state: v }); }}>
              <SelectTrigger id="state">
                <SelectValue placeholder="Select state" />
              </SelectTrigger>
              <SelectContent>
                {US_STATES.map((s) => (
                  <SelectItem key={s.value} value={s.value}>
                    {s.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Need>
        ) : (
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="state">Province / Region</Label>
            <Input
              id="state"
              value={customer.state}
              onChange={(e) => update({ state: e.target.value })}
              autoComplete="address-level1"
              placeholder="Optional"
            />
          </div>
        )}

        <Need missing={isUS && miss(customer.zip)} className="flex flex-col gap-1.5">
          <Label htmlFor="zip">{isUS ? <>ZIP Code<Req /></> : "Postal Code"}</Label>
          <Input
            id="zip"
            value={customer.zip}
            onChange={(e) => update({ zip: e.target.value })}
            autoComplete="postal-code"
            maxLength={10}
            placeholder={isUS ? "" : "Optional"}
          />
        </Need>
      </div>
    </div>
  );
}
