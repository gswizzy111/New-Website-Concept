"use client";

import { useId, useState } from "react";
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
import { contactProblems, type ContactField } from "@/lib/checkout-validation";
import { FieldNote } from "@/components/checkout/field-note";
import { SmsOptIn } from "@/components/checkout/sms-opt-in";

const INPUT_CN = PIXEL_FIELD;


interface StepCustomerProps {
  customer: CustomerInfo;
  onChange: (customer: CustomerInfo) => void;
  /** The customer pressed Continue with something missing: outline it in red */
  showMissing?: boolean;
  /** Restoration checkout: the optional text-updates box under the phone (left out, no box) */
  smsOptIn?: boolean;
  onSmsOptInChange?: (checked: boolean) => void;
}

/** What to fix, under a field (the look of <Need>'s note, with an id for aria-describedby). Also used by the prep form. */
export { FieldNote };

export function StepCustomer({ customer, onChange, showMissing = false, smsOptIn = false, onSmsOptInChange }: StepCustomerProps) {
  const isUS = customer.country === "US";
  const uid = useId();
  // The same checks /api/checkout makes (lib/checkout-validation.ts)
  const problems = contactProblems(customer);
  // Fields the customer has typed in and left: checked from then on, as they type,
  // so a fix clears the note right away. Empty fields wait for Continue.
  const [left, setLeft] = useState<Partial<Record<ContactField, true>>>({});
  const problemOf = (f: ContactField) => ((showMissing || left[f]) ? problems[f] ?? null : null);
  const noteId = (f: ContactField) => `${uid}-${f}-note`;
  const leave = (f: ContactField, value: string) => {
    if (value.trim() && !left[f]) setLeft((l) => ({ ...l, [f]: true }));
  };
  /** aria-invalid and aria-describedby for a field's input */
  const described = (f: ContactField) => {
    const problem = problemOf(f);
    return { "aria-invalid": problem ? true : undefined, "aria-describedby": problem ? noteId(f) : undefined };
  };
  /** A field: its outline (and the scroll target) plus its note */
  const field = (f: ContactField, className: string, children: React.ReactNode) => (
    <Need missing={!!problemOf(f)} note={null} className={className}>
      {children}
      <FieldNote id={noteId(f)} text={problemOf(f)} />
    </Need>
  );

  // The street field (address autocomplete) takes its invalid state and note as props
  const streetProblem = problemOf("street1");
  const streetNote = noteId("street1");

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
        {field("name", "sm:col-span-2 flex flex-col gap-1.5", <>
          <Label htmlFor="full-name">Full Name<Req /></Label>
          <Input
            id="full-name"
            value={customer.name}
            onChange={(e) => update({ name: e.target.value })}
            onBlur={(e) => leave("name", e.target.value)}
            autoComplete="name"
            {...described("name")}
          />
        </>)}

        {field("email", "flex flex-col gap-1.5", <>
          <Label htmlFor="email">Email<Req /></Label>
          <Input
            id="email"
            type="email"
            value={customer.email}
            onChange={(e) => update({ email: e.target.value })}
            onBlur={(e) => {
              // The email is sent as typed: drop stray spaces at the ends
              const v = e.target.value.trim();
              if (v !== customer.email) update({ email: v });
              leave("email", v);
            }}
            autoComplete="email"
            {...described("email")}
          />
        </>)}

        {field("phone", "flex flex-col gap-1.5", <>
          <Label htmlFor="phone">
            Phone<Req /> <span className="text-xs text-muted-foreground font-normal">(required by carriers)</span>
          </Label>
          <Input
            id="phone"
            type="tel"
            value={customer.phone}
            onChange={(e) => update({ phone: e.target.value })}
            onBlur={(e) => leave("phone", e.target.value)}
            autoComplete="tel"
            {...described("phone")}
          />
        </>)}

        {onSmsOptInChange && (
          <SmsOptIn className="sm:col-span-2" checked={smsOptIn} onChange={onSmsOptInChange} phone={customer.phone} />
        )}

        <div className="sm:col-span-2 flex flex-col gap-1.5">
          <Label>Country</Label>
          <p className="flex h-11 items-center rounded-[12px] bg-chalk px-3.5 text-[15px] font-semibold text-ink-soft">
            United States
          </p>
        </div>

        {field("street1", "sm:col-span-2 flex flex-col gap-1.5", <>
          <Label htmlFor="street1">Street Address<Req /></Label>
          <div onBlur={() => leave("street1", customer.street1)}>
            <AddressAutocomplete
              id="street1"
              value={customer.street1}
              onChange={(v) => update({ street1: v })}
              onPlaceSelect={(f) => update({ street1: f.street1, city: f.city, state: f.state, zip: f.zip })}
              className={`${INPUT_CN} aria-invalid:border-destructive aria-invalid:outline-2 aria-invalid:outline-solid aria-invalid:outline-destructive/30`}
              invalid={!!streetProblem}
              describedBy={streetProblem ? streetNote : undefined}
            />
          </div>
        </>)}

        <div className="sm:col-span-2 flex flex-col gap-1.5">
          <Label htmlFor="street2">Apartment, suite, etc.</Label>
          <Input
            id="street2"
            value={customer.street2}
            onChange={(e) => update({ street2: e.target.value })}
            autoComplete="address-line2"
          />
        </div>

        {field("city", "flex flex-col gap-1.5", <>
          <Label htmlFor="city">City<Req /></Label>
          <Input
            id="city"
            value={customer.city}
            onChange={(e) => update({ city: e.target.value })}
            onBlur={(e) => leave("city", e.target.value)}
            autoComplete="address-level2"
            {...described("city")}
          />
        </>)}

        {isUS ? (
          field("state", "flex flex-col gap-1.5", <>
            <Label htmlFor="state">State<Req /></Label>
            <Select value={customer.state || undefined} onValueChange={(v: string | null) => { if (v) update({ state: v }); }}>
              <SelectTrigger id="state" {...described("state")}>
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
          </>)
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

        {field("zip", "flex flex-col gap-1.5", <>
          <Label htmlFor="zip">{isUS ? <>ZIP Code<Req /></> : "Postal Code"}</Label>
          <Input
            id="zip"
            value={customer.zip}
            onChange={(e) => update({ zip: e.target.value })}
            onBlur={(e) => leave("zip", e.target.value)}
            autoComplete="postal-code"
            maxLength={10}
            placeholder={isUS ? "" : "Optional"}
            {...described("zip")}
          />
        </>)}
      </div>
    </div>
  );
}
