/**
 * The exact opt-in wording for text messages (Telnyx, 10DLC). Shown next to
 * an unchecked checkbox and stored word for word with each consent
 * (sms_consents.consent_text), so a record always says what the customer
 * agreed to. Carriers review this wording when the 10DLC campaign is vetted:
 * changing it is a new SMS_CONSENT_VERSION (and the campaign's opt-in
 * description may need the same change in Telnyx).
 *
 * "SMS Terms" links to /sms-terms and "Privacy Policy" to /privacy where it
 * is shown; the stored text keeps the plain words.
 */
export const SMS_CONSENT_VERSION = "2026-11-28";

/** Restoration, PSA prep, show drop-off and manual orders: one order's updates. */
export const SMS_ORDER_CONSENT_TEXT =
  "Text me updates about this order (cards received, finished and shipped). Msg frequency varies, about 3 per order. Msg & data rates may apply. Reply STOP to cancel, HELP for help. Consent is not a condition of purchase. See our SMS Terms and Privacy Policy.";

/** Restoration waitlist: one alert when restoration spots open. */
export const SMS_WAITLIST_CONSENT_TEXT =
  "Text me when restoration spots open. Msg frequency varies. Msg & data rates may apply. Reply STOP to cancel, HELP for help. Consent is not a condition of purchase. See our SMS Terms and Privacy Policy.";

/** Admin-entered orders (walk-ins, card shows): the customer said yes in person. */
export const SMS_MANUAL_CONSENT_TEXT =
  "The customer agreed in person to receive text updates about this order (cards received, finished and shipped). Msg frequency varies, about 3 per order. Msg & data rates may apply. Reply STOP to cancel, HELP for help.";

export type SmsConsentSource =
  | "restoration_checkout"
  | "prep_checkout"
  | "show_dropoff"
  | "manual_order"
  | "waitlist";
