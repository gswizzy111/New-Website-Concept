"use client";

import { useId } from "react";
import { Download, ExternalLink, PenLine } from "lucide-react";
import { LegalDocument } from "@/components/legal/legal-document";
import {
  AGREE_LABEL, CERTIFICATION_CLAUSE, CERTIFICATION_TEXT, ESIGN_BLOCKS, ESIGN_LABEL,
  MEDIA_LABEL, TAG_LABEL, TERMS_VERSION,
} from "@/lib/legal/current-terms";
import type { CardDetails } from "@/lib/legal/agreements-v1";
import type { SubmittedSigning } from "@/lib/checkout-signing";
import { Need, Req } from "./required";
import { PIXEL_FIELD } from "@/components/ui/input";
import { cn } from "@/lib/utils";

/**
 * Everything a customer signs or chooses before an order is placed (Terms
 * Section 35), kept short. Each slab to open is authorized only in its own
 * pop-up when slab cracking is picked (SlabAuthorizationDialog), stored with
 * the order and not shown again. Here: the optional photo permissions
 * (unchecked), and "Sign to confirm your order": two required boxes (the Terms
 * and electronic records) and the Full legal name. The full
 * texts are a link or a tap away, and all of it is stored with the signature
 * and printed on its PDF. Shared by the restoration, prep and add-cards
 * checkouts.
 */
export type SigningState = {
  slab: Record<string, { signer_name: string; agreed: boolean }>;
  media: boolean;
  tagName: boolean;
  esign: boolean;
  agreed: boolean;
  signerName: string;
};

export const emptySigning = (): SigningState => ({ slab: {}, media: false, tagName: false, esign: false, agreed: false, signerName: "" });

/** A card whose slab is to be opened: its position in the order, a stable id and its details. */
export type SlabCard = { index: number; id?: string; details: CardDetails };

// A slab authorization belongs to the exact card details it was signed for:
// editing the card afterwards asks for it again.
const slabKey = (c: SlabCard) =>
  [c.id ?? c.index, c.details.card_name, c.details.card_year, c.details.card_set, c.details.card_number, c.details.variation, c.details.grading_company, c.details.grade, c.details.cert_number].join("\u0001");
const named = (n: string | undefined) => (n ?? "").trim().length >= 2;

export function slabSignature(state: SigningState, c: SlabCard) {
  return state.slab[slabKey(c)] ?? null;
}

export function slabSigned(state: SigningState, c: SlabCard) {
  const s = slabSignature(state, c);
  return !!s && s.agreed && named(s.signer_name);
}

export function signSlab(state: SigningState, c: SlabCard, signerName: string): SigningState {
  return { ...state, slab: { ...state.slab, [slabKey(c)]: { signer_name: signerName, agreed: true } } };
}

/** Every required piece is in place (both boxes, a name, each slab signed). */
export function signingReady(state: SigningState, slabCards: SlabCard[]) {
  return state.esign && state.agreed && named(state.signerName) && slabCards.every((c) => slabSigned(state, c));
}

/** What the checkout routes expect. */
export function submittedSigning(state: SigningState, slabCards: SlabCard[]): SubmittedSigning {
  return {
    ...(state.agreed && named(state.signerName)
      ? { terms: { version: TERMS_VERSION, signer_name: state.signerName.trim(), agreed: true as const } }
      : {}),
    esign_consent: state.esign,
    marketing: { media: state.media, tag_name: state.media && state.tagName },
    slab_authorizations: slabCards
      .filter((c) => slabSigned(state, c))
      .map((c) => ({ card_index: c.index, signer_name: slabSignature(state, c)!.signer_name.trim(), agreed: true as const })),
  };
}

const CHECK = "mt-0.5 shrink-0";
const NAME_INPUT = PIXEL_FIELD;
const MORE = "inline-flex min-h-11 cursor-pointer items-center text-sm font-bold text-ink-soft underline underline-offset-4 hover:text-ink";

export function SigningSection({
  state,
  onChange,
  mediaRequiredNote,
  showMissing = false,
}: {
  state: SigningState;
  onChange: (s: SigningState) => void;
  /** Set when a paid add-on depends on the photo permission. */
  mediaRequiredNote?: string;
  /** The customer pressed sign with something missing: outline it in red */
  showMissing?: boolean;
}) {
  const id = useId();
  return (
    <div className="flex flex-col gap-8">
      <section className="flex flex-col gap-4 rounded-[22px] bg-white p-5 text-ink shadow-[0_0_0_1px_var(--line)] sm:p-7">
        <h3 className="font-heading text-[1.5rem] leading-none font-extrabold text-ink">Optional permissions</h3>
        <label className="flex cursor-pointer items-start gap-3 text-[15px] leading-relaxed">
          <input
            type="checkbox"
            className={CHECK}
            checked={state.media}
            onChange={(e) => onChange({ ...state, media: e.target.checked, tagName: e.target.checked ? state.tagName : false })}
          />
          <span className="text-ink">{MEDIA_LABEL}</span>
        </label>
        <label className={`flex items-start gap-3 text-[15px] leading-relaxed ${state.media ? "cursor-pointer" : "opacity-50 cursor-not-allowed"}`}>
          <input
            type="checkbox"
            className={CHECK}
            checked={state.media && state.tagName}
            disabled={!state.media}
            onChange={(e) => onChange({ ...state, tagName: e.target.checked })}
          />
          <span className="text-ink">{TAG_LABEL}</span>
        </label>
        <p className="text-[13px] text-ink-soft">{mediaRequiredNote ?? "Both are optional and don't affect your order."}</p>
      </section>

      {/* The signature card: an ink band on top, then the boxes and the name */}
      <section className="flex flex-col overflow-hidden rounded-[22px] bg-white shadow-[0_0_0_2px_var(--ink),var(--panel-shadow)]">
        <div className="surface-ink px-5 pt-5 pb-3 sm:px-7 sm:pt-6">
          <h3 className="flex items-center gap-3 font-heading text-[1.9rem] leading-none font-black text-white md:text-[2.25rem]">
            <PenLine aria-hidden className="size-7 shrink-0 text-sun" strokeWidth={2} />
            Sign to confirm your order
          </h3>
          <div className="mt-3 flex flex-wrap gap-x-5 gap-y-1 text-sm">
            <a href="/terms" target="_blank" rel="noopener noreferrer" className="inline-flex min-h-11 items-center gap-1.5 font-bold text-sun underline underline-offset-4">
              <ExternalLink className="h-3.5 w-3.5" strokeWidth={2} />Read the Terms of Service v{TERMS_VERSION}
            </a>
            <a href={`/terms/v${TERMS_VERSION}/pdf`} className="inline-flex min-h-11 items-center gap-1.5 font-bold text-white underline underline-offset-4">
              <Download className="h-3.5 w-3.5" strokeWidth={2} />Download PDF
            </a>
          </div>
        </div>
        <div className="flex flex-col gap-5 p-5 sm:p-7">
        <Need missing={showMissing && !state.agreed} note="Check this box to agree to the Terms.">
          <label className="flex cursor-pointer items-start gap-3 text-[15px] leading-relaxed">
            <input type="checkbox" className={CHECK} checked={state.agreed} onChange={(e) => onChange({ ...state, agreed: e.target.checked })} />
            <span className="font-semibold text-ink">{AGREE_LABEL}<Req /></span>
          </label>
        </Need>
        <Need missing={showMissing && !state.esign} note="Check this box to sign electronically.">
          <label className="flex cursor-pointer items-start gap-3 text-[15px] leading-relaxed">
            <input type="checkbox" className={CHECK} checked={state.esign} onChange={(e) => onChange({ ...state, esign: e.target.checked })} />
            <span className="text-ink">{ESIGN_LABEL}<Req /></span>
          </label>
        </Need>
        <details>
          <summary className={MORE}>Your certification (Section {CERTIFICATION_CLAUSE}) and electronic records</summary>
          <div className="mt-2 flex max-h-64 flex-col gap-3 overflow-y-auto rounded-[14px] bg-chalk p-4 focus-visible:outline-3 focus-visible:outline-offset-3 focus-visible:outline-cobalt" tabIndex={0} aria-label="Certification and consent to electronic records">
            <p className="text-sm text-foreground leading-relaxed">{CERTIFICATION_TEXT}</p>
            <LegalDocument blocks={ESIGN_BLOCKS} variant="compact" />
          </div>
        </details>
        <Need missing={showMissing && !named(state.signerName)} note="Type your full legal name to sign." className="flex max-w-md flex-col gap-2 border-t border-line pt-6">
          <label htmlFor={`${id}-legal-name`} className="label-caps text-[15px] text-ink">Full legal name<Req /></label>
          <input
            id={`${id}-legal-name`}
            className={cn(NAME_INPUT, "h-13 font-heading text-[1.5rem] font-extrabold tracking-[0.01em] md:text-[1.5rem]")}
            autoComplete="name"
            value={state.signerName}
            onChange={(e) => onChange({ ...state, signerName: e.target.value })}
          />
          <p className="text-[13px] leading-relaxed text-ink-soft">
            Typing your name is your electronic signature on the Terms, including the certification above. The date and time come from our server when you place the order.
          </p>
        </Need>
        </div>
      </section>
    </div>
  );
}
