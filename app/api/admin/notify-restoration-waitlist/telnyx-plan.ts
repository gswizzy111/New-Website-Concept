/**
 * Who on a waitlist part gets the "we're open" text through Telnyx (pure; the
 * route reads the rows). Only people who ticked the text box when they signed
 * up (an sms_consents row with source 'waitlist': matched by their waitlist row,
 * else by phone) and whose number hasn't replied STOP. One text per phone, even
 * when the same number is on the list twice. Tested in tests/intake/sms-admin.test.ts.
 */
import { toE164 } from "@/lib/sms/phone";
import { gsm, withStopLine } from "@/lib/sms/templates";

export type WaitlistConsentRow = { phone_e164: string; waitlist_id: string | null };
export type OptEventRow = { phone_e164: string; event: string; created_at: string };

/** Phones whose latest opt event is an opt-out. Rows ordered oldest first (ties: the later row wins). */
export function optedOutPhones(events: OptEventRow[]): Set<string> {
  const latest = new Map<string, { event: string; at: number }>();
  for (const e of events) {
    const at = Date.parse(e.created_at);
    const prev = latest.get(e.phone_e164);
    if (!prev || !(at < prev.at)) latest.set(e.phone_e164, { event: e.event, at });
  }
  return new Set([...latest].filter(([, v]) => v.event === "opt_out").map(([phone]) => phone));
}

export type TextPlan<P> = {
  /** One per phone: the number (E.164), the first person on it (for the name) and every row it reaches */
  texts: { phone: string; person: P; ids: string[] }[];
  /** Phones skipped because nobody on them ticked the waitlist text box */
  noOptIn: number;
  /** Phones skipped because they replied STOP */
  optedOut: number;
};

/**
 * matchWaitlistId: consents carry the restoration_waitlist row's id, so it is
 * only matched on that list (the sold-out pop-up's list matches by phone).
 * A consent found by row id texts the number the person agreed with.
 */
export function planWaitlistTexts<P extends { id: string; phone: string | null }>(
  people: P[],
  consents: WaitlistConsentRow[],
  optedOut: Set<string>,
  { matchWaitlistId }: { matchWaitlistId: boolean },
): TextPlan<P> {
  const byRow = new Map<string, string>();
  const phones = new Set<string>();
  for (const c of consents) {
    if (!c.phone_e164) continue;
    phones.add(c.phone_e164);
    if (matchWaitlistId && c.waitlist_id && !byRow.has(c.waitlist_id)) byRow.set(c.waitlist_id, c.phone_e164);
  }

  const texts = new Map<string, { phone: string; person: P; ids: string[] }>();
  const noOptIn = new Set<string>();
  const stopped = new Set<string>();
  for (const person of people) {
    const typed = toE164(person.phone);
    const phone = byRow.get(person.id) ?? (typed && phones.has(typed) ? typed : null);
    if (!phone) {
      const raw = (person.phone ?? "").trim();
      if (raw) noOptIn.add(typed ?? (raw.replace(/\D/g, "") || raw));
      continue;
    }
    if (optedOut.has(phone)) {
      stopped.add(phone);
      continue;
    }
    const entry = texts.get(phone);
    if (entry) entry.ids.push(person.id);
    else texts.set(phone, { phone, person, ids: [person.id] });
  }
  // A phone that also has an opt-in on another row isn't "no opt-in"
  for (const p of [...texts.keys(), ...stopped]) noOptIn.delete(p);
  return { texts: [...texts.values()], noOptIn: noOptIn.size, optedOut: stopped.size };
}

/**
 * The waitlist text as Telnyx sends it: plain characters, ending with
 * " Reply STOP to opt out." unless it already mentions STOP (no period
 * pushed onto a link at the end).
 */
export function waitlistSmsText(text: string): string {
  const t = gsm(String(text ?? "")).trim();
  if (/\bstop\b/i.test(t)) return t;
  if (/https?:\/\/\S+$/i.test(t)) return `${t} Reply STOP to opt out.`;
  return withStopLine(t);
}
