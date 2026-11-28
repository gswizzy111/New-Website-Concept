/**
 * Phone numbers for texts: US and Canada (+1) only, stored as E.164
 * ("+12015551234"). Pure: no network, no database.
 */

/**
 * "(201) 555-1234", "201.555.1234", "1 201 555 1234", "+1 201-555-1234"
 * -> "+12015551234". Anything that isn't a valid North American number
 * (wrong length, another country code, area or exchange starting with 0 or 1,
 * 555-01xx fiction numbers are allowed) -> null.
 */
export function toE164(raw: string | null | undefined): string | null {
  if (typeof raw !== "string") return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;
  // Extensions can't receive texts
  if (/(?:ext|x|#)\s*\.?\s*\d+\s*$/i.test(trimmed)) return null;
  // Only digits, spaces and the usual punctuation
  if (!/^[+\d\s().\-‐-―]+$/.test(trimmed)) return null;
  const plus = trimmed.startsWith("+");
  let digits = trimmed.replace(/\D/g, "");
  if (plus) {
    if (!digits.startsWith("1") || digits.length !== 11) return null;
    digits = digits.slice(1);
  } else if (digits.length === 11 && digits.startsWith("1")) {
    digits = digits.slice(1);
  } else if (digits.length !== 10) {
    return null;
  }
  // NANP: area code and exchange start with 2-9
  if (!/^[2-9]\d{2}[2-9]\d{6}$/.test(digits)) return null;
  // N11 area codes (211, 311, 911 ...) are service codes, never phones
  if (/^[2-9]11/.test(digits)) return null;
  return `+1${digits}`;
}

/** "+12015551234" -> "(201) 555-1234". Anything else is returned as given. */
export function formatPhone(e164: string): string {
  const m = /^\+1(\d{3})(\d{3})(\d{4})$/.exec(e164 ?? "");
  return m ? `(${m[1]}) ${m[2]}-${m[3]}` : e164;
}

/** "+12015551234" -> "(201) ***-1234", for logs. */
export function maskPhone(e164: string): string {
  const m = /^\+1(\d{3})\d{3}(\d{4})$/.exec(e164 ?? "");
  return m ? `(${m[1]}) ***-${m[2]}` : "(unknown number)";
}
