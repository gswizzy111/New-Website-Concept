"use client";

import { useId } from "react";
import { SMS_ORDER_CONSENT_TEXT } from "@/lib/sms/consent-text";
import { toE164 } from "@/lib/sms/phone";
import { consentTextParts } from "@/lib/sms-checkout";
import { CHOICE, CHOICE_FOCUS, CHOICE_ON } from "./form-styles";
import { cn } from "@/lib/utils";

/**
 * The consent wording, word for word (lib/sms/consent-text.ts), with "SMS
 * Terms" and "Privacy Policy" as links. They open a new tab, so the form
 * keeps what's been typed; a link inside the box's label doesn't tick it.
 */
export function SmsConsentWords({ text }: { text: string }) {
  return (
    <>
      {consentTextParts(text).map((part, i) =>
        part.href ? (
          <a
            key={i}
            href={part.href}
            target="_blank"
            rel="noopener noreferrer"
            className="font-bold text-cobalt-deep underline underline-offset-2 hover:decoration-2"
          >
            {part.text}
            <span className="sr-only"> (opens in a new tab)</span>
          </a>
        ) : part.lead ? (
          <span key={i} className="font-semibold text-ink">{part.text}</span>
        ) : (
          <span key={i}>{part.text}</span>
        )
      )}
    </>
  );
}

/**
 * Order text updates at checkout (Telnyx, 10DLC): one optional box, unchecked
 * until the customer ticks it, never a condition of the order. It sits right
 * under the phone field and looks like the checkout's other optional boxes (a
 * CHOICE tile that turns cobalt-wash when ticked). The form sends
 * `smsOptIn: true` only when it's ticked; the route records the consent once
 * the order exists (lib/sms-checkout.ts).
 */
export function SmsOptIn({
  checked,
  onChange,
  phone,
  className,
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  /** The phone as typed: a ticked box with a number we can't text says so */
  phone?: string;
  className?: string;
}) {
  const id = useId();
  const noteId = `${id}-note`;
  const cantText = checked && !!phone?.trim() && !toE164(phone);
  return (
    <div className={className}>
      <label
        htmlFor={id}
        className={cn(
          "flex min-h-11 cursor-pointer items-start gap-3 px-3.5 py-3 text-[14px] leading-[1.5] text-ink-soft sm:px-4",
          CHOICE,
          CHOICE_FOCUS,
          checked && CHOICE_ON
        )}
      >
        <input
          id={id}
          type="checkbox"
          className="mt-0.5 shrink-0"
          checked={checked}
          onChange={(e) => onChange(e.target.checked)}
          aria-describedby={cantText ? noteId : undefined}
        />
        <span>
          <SmsConsentWords text={SMS_ORDER_CONSENT_TEXT} />
        </span>
      </label>
      {cantText && (
        <p id={noteId} className="mt-1.5 px-1 text-[13px] leading-snug text-ink-soft">
          Texts need a 10-digit US phone number.
        </p>
      )}
    </div>
  );
}
