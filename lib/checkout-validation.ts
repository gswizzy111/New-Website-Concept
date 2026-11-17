import { regexes } from "zod/v4/core";
import { US_STATES } from "@/lib/constants";
import type { CustomerInfo } from "@/lib/types";

/**
 * Checkout field checks for the browser, so a typo shows up at the field
 * instead of after signing. They follow the servers' rules exactly and never
 * replace them (the server stays the final word):
 *
 * - Restoration, app/api/checkout/route.ts (BodySchema.customer): name at
 *   least 1 character, email `z.string().email()`, phone at least 7
 *   characters, street1 and city at least 1. State and ZIP are optional
 *   there, but the builder has always required both for US addresses (the
 *   shipping step quotes rates from them).
 * - PSA Prep, app/api/prep/checkout/route.ts (Body and its address checks):
 *   the same name, email and phone rules on the trimmed values the form
 *   sends, street1, city and ZIP filled, and a state from US_STATES.
 *
 * Pass each value exactly as the form will send it: the restoration builder
 * sends the email as typed, the prep form sends it trimmed.
 */

/** The email pattern zod's `z.string().email()` checks on the server (zod 4). */
export const EMAIL_PATTERN: RegExp = regexes.email;

/** The servers' `z.string().min(7)` on the phone number. */
export const PHONE_MIN_LENGTH = 7;

export function isValidEmail(value: string): boolean {
  return EMAIL_PATTERN.test(value);
}

/** At least 7 characters besides spaces at either end (so the untrimmed value passes too). */
export function isValidPhone(value: string): boolean {
  return value.trim().length >= PHONE_MIN_LENGTH;
}

/** A two-letter code from the state list (prep's server check). */
export function isUSState(value: string): boolean {
  const code = value.trim().toUpperCase();
  return US_STATES.some((s) => s.value === code);
}

/** What to do, shown under a field. */
export const FIELD_MESSAGES = {
  name: "Enter your full name",
  email: "Enter your email address",
  emailInvalid: "Enter a valid email address",
  phone: "Enter your phone number",
  phoneInvalid: "Enter a valid phone number",
  street1: "Enter your street address",
  city: "Enter your city",
  state: "Choose your state",
  zip: "Enter your ZIP code",
} as const;

/**
 * Something besides spaces. Null-safe: these checks run on every render of the
 * builder, and a customer restored from storage or an account prefill must
 * never crash it over a missing field.
 */
function filled(value: string | null | undefined): boolean {
  return !!value?.trim();
}

/** Empty or not an email address: the message to show, else null. */
export function emailProblem(value: string | null | undefined): string | null {
  if (!filled(value)) return FIELD_MESSAGES.email;
  return isValidEmail(value ?? "") ? null : FIELD_MESSAGES.emailInvalid;
}

/** Empty or too short to be a phone number: the message to show, else null. */
export function phoneProblem(value: string | null | undefined): string | null {
  if (!filled(value)) return FIELD_MESSAGES.phone;
  return isValidPhone(value ?? "") ? null : FIELD_MESSAGES.phoneInvalid;
}

export type ContactField = "name" | "email" | "phone" | "street1" | "city" | "state" | "zip";
export type ContactProblems = Partial<Record<ContactField, string>>;

/**
 * The restoration builder's contact step (components/order-builder/step-customer.tsx):
 * each field /api/checkout would refuse, or the builder needs, with what to do.
 */
export function contactProblems(c: CustomerInfo): ContactProblems {
  const isUS = !c.country || c.country === "US";
  const problems: ContactProblems = {};
  if (!filled(c.name)) problems.name = FIELD_MESSAGES.name;
  const email = emailProblem(c.email);
  if (email) problems.email = email;
  const phone = phoneProblem(c.phone);
  if (phone) problems.phone = phone;
  if (!filled(c.street1)) problems.street1 = FIELD_MESSAGES.street1;
  if (!filled(c.city)) problems.city = FIELD_MESSAGES.city;
  if (isUS) {
    if (!filled(c.state)) problems.state = FIELD_MESSAGES.state;
    if (!filled(c.zip)) problems.zip = FIELD_MESSAGES.zip;
  }
  return problems;
}

/** The contact step passes: nothing for /api/checkout to refuse there. */
export function contactOk(c: CustomerInfo): boolean {
  return Object.keys(contactProblems(c)).length === 0;
}

