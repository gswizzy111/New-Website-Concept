import { PREVIEW_MODE } from "@/lib/preview";

/**
 * Telnyx settings, all from the environment (Netlify):
 *   TELNYX_API_KEY              secret: the API v2 key
 *   TELNYX_FROM_NUMBER          the 10DLC number texts come from, +1XXXXXXXXXX
 *   TELNYX_MESSAGING_PROFILE_ID optional: the messaging profile the number is on
 *   TELNYX_PUBLIC_KEY           base64 Ed25519 public key for webhook signatures (not secret)
 * Preview mode never sends.
 */

function env(name: string): string {
  return (process.env[name] ?? "").trim();
}

/** The from number when it is a valid +1 number, else null. */
export function smsFromNumber(): string | null {
  const n = env("TELNYX_FROM_NUMBER");
  return /^\+1[2-9]\d{9}$/.test(n) ? n : null;
}

export function smsApiKey(): string | null {
  return env("TELNYX_API_KEY") || null;
}

export function smsProfileId(): string | null {
  return env("TELNYX_MESSAGING_PROFILE_ID") || null;
}

export function smsPublicKey(): string | null {
  return env("TELNYX_PUBLIC_KEY") || null;
}

function previewOn(): boolean {
  return PREVIEW_MODE || process.env.NEXT_PUBLIC_PREVIEW_MODE === "true";
}

/** Texts can go out: the API key and from number are set, and this isn't preview mode. */
export function smsConfigured(): boolean {
  return !previewOn() && !!smsApiKey() && !!smsFromNumber();
}

/** Which settings are present, never their values (the from number isn't secret). */
export function smsSetupStatus(): {
  apiKey: boolean;
  fromNumber: string | null;
  profileId: boolean;
  publicKey: boolean;
  preview: boolean;
} {
  return {
    apiKey: !!smsApiKey(),
    fromNumber: smsFromNumber(),
    profileId: !!smsProfileId(),
    publicKey: !!smsPublicKey(),
    preview: previewOn(),
  };
}
