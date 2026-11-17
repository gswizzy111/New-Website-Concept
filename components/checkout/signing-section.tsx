"use client";

import { useId } from "react";
import { ChevronDown, Download, ExternalLink, PenLine } from "lucide-react";
import { LegalDocument } from "@/components/legal/legal-document";
import {
  AGREE_LABEL, CERTIFICATION_CLAUSE, CERTIFICATION_TEXT, ESIGN_BLOCKS, ESIGN_LABEL,
  MEDIA_LABEL, TAG_LABEL, TERMS_VERSION,
} from "@/lib/legal/current-terms";
import type { CardDetails } from "@/lib/legal/agreements-v1";
import type { SubmittedSigning } from "@/lib/checkout-signing";
import { Req } from "./required";
import { CHOICE, CHOICE_FOCUS, CHOICE_ON } from "./form-styles";
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
const MORE = "inline-flex min-h-11 cursor-pointer items-center gap-1.5 text-sm font-bold text-ink-soft underline underline-offset-4 hover:text-ink [&::-webkit-details-marker]:hidden";

/** A missing CHOICE tile: a red edge and a faint red fill instead of the grey edge. */
export const MISSING_TILE =
  "bg-red-50 shadow-[inset_0_0_0_2px_var(--danger)] hover:shadow-[inset_0_0_0_2px_var(--danger)]";

/**
 * The note beside one missing item, in the red of the other checkout notes.
 * Its field points at it (aria-describedby) and is marked aria-invalid, and
 * its wrapper carries data-missing so revealMissing() finds it.
 */
export function ItemError({ id, className, children }: { id: string; className?: string; children: React.ReactNode }) {
  return (
    <p id={id} className={cn("mt-1.5 flex items-start gap-1.5 text-sm leading-snug font-semibold text-destructive", className)}>
      <span aria-hidden className="mt-px grid size-4 shrink-0 place-items-center rounded-full bg-destructive text-[11px] leading-none font-black text-white">!</span>
      {children}
    </p>
  );
}

/** One required box as a full-width tile: the whole tile (box and words) toggles it. */
function SignBox({
  id,
  checked,
  onChange,
  missing,
  error,
  children,
}: {
  id: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
  missing: boolean;
  error: string;
  children: React.ReactNode;
}) {
  const errorId = `${id}-error`;
  return (
    <div data-missing={missing || undefined}>
      <label
        htmlFor={id}
        className={cn(
          "flex min-h-11 cursor-pointer items-start gap-3 px-3.5 py-3 text-[15px] leading-[1.45] sm:px-4",
          CHOICE,
          CHOICE_FOCUS,
          checked && CHOICE_ON,
          missing && MISSING_TILE
        )}
      >
        <input
          id={id}
          type="checkbox"
          className={CHECK}
          checked={checked}
          onChange={(e) => onChange(e.target.checked)}
          aria-required="true"
          aria-invalid={missing || undefined}
          aria-describedby={missing ? errorId : undefined}
        />
        <span className="text-ink">{children}<Req /></span>
      </label>
      {missing && <ItemError id={errorId} className="px-1">{error}</ItemError>}
    </div>
  );
}

/** An optional box: the whole row, words included, is a 44px target. */
const OPTION_ROW = "-mx-2 flex min-h-11 items-start gap-3 rounded-[10px] px-2 py-2.5 text-[15px] leading-relaxed";

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
  const termsMissing = showMissing && !state.agreed;
  const esignMissing = showMissing && !state.esign;
  const nameMissing = showMissing && !named(state.signerName);
  return (
    <div className="flex flex-col gap-6 sm:gap-8">
      <section className="flex flex-col gap-2 rounded-[22px] bg-white p-4 text-ink shadow-[0_0_0_1px_var(--line)] sm:gap-3 sm:p-7">
        <h3 className="font-heading text-[1.5rem] leading-none font-extrabold text-ink">Optional permissions</h3>
        <div className="flex flex-col">
          <label className={cn(OPTION_ROW, "cursor-pointer hover:bg-chalk")}>
            <input
              type="checkbox"
              className={CHECK}
              checked={state.media}
              onChange={(e) => onChange({ ...state, media: e.target.checked, tagName: e.target.checked ? state.tagName : false })}
            />
            <span className="text-ink">{MEDIA_LABEL}</span>
          </label>
          <label className={cn(OPTION_ROW, state.media ? "cursor-pointer hover:bg-chalk" : "cursor-not-allowed opacity-50")}>
            <input
              type="checkbox"
              className={CHECK}
              checked={state.media && state.tagName}
              disabled={!state.media}
              onChange={(e) => onChange({ ...state, tagName: e.target.checked })}
            />
            <span className="text-ink">{TAG_LABEL}</span>
          </label>
        </div>
        <p className="text-[13px] text-ink-soft">{mediaRequiredNote ?? "Both are optional and don't affect your order."}</p>
      </section>

      {/* The signature card: an ink band on top, then the boxes and the name, kept close together */}
      <section
        aria-labelledby={`${id}-sign`}
        className="flex flex-col overflow-hidden rounded-[22px] bg-white shadow-[0_0_0_2px_var(--ink),var(--panel-shadow)]"
      >
        <div className="surface-ink px-4 pt-4 pb-1 sm:px-7 sm:pt-6 sm:pb-2">
          <h3 id={`${id}-sign`} className="flex items-center gap-2.5 font-heading text-[1.625rem] leading-none font-black text-white sm:gap-3 sm:text-[1.9rem] md:text-[2.25rem]">
            <PenLine aria-hidden className="size-6 shrink-0 text-sun sm:size-7" strokeWidth={1.75} />
            Sign to confirm your order
          </h3>
          <div className="mt-1 flex flex-wrap gap-x-5 text-sm sm:mt-2">
            {/* A new tab, so the form stays as it is */}
            <a href="/terms" target="_blank" rel="noopener noreferrer" className="inline-flex min-h-11 items-center gap-1.5 font-bold text-sun underline underline-offset-4">
              <ExternalLink aria-hidden className="h-3.5 w-3.5" strokeWidth={1.75} />Read the Terms of Service v{TERMS_VERSION}
              <span className="sr-only"> (opens in a new tab)</span>
            </a>
            <a href={`/terms/v${TERMS_VERSION}/pdf`} download className="inline-flex min-h-11 items-center gap-1.5 font-bold text-white underline underline-offset-4">
              <Download aria-hidden className="h-3.5 w-3.5" strokeWidth={1.75} />Download PDF
            </a>
          </div>
        </div>
        <div className="flex flex-col gap-3 p-4 sm:gap-4 sm:p-7">
          <div className="flex flex-col gap-2">
            <SignBox
              id={`${id}-terms`}
              checked={state.agreed}
              onChange={(agreed) => onChange({ ...state, agreed })}
              missing={termsMissing}
              error="Check this box to agree to the Terms."
            >
              <span className="font-semibold">{AGREE_LABEL}</span>
            </SignBox>
            <SignBox
              id={`${id}-esign`}
              checked={state.esign}
              onChange={(esign) => onChange({ ...state, esign })}
              missing={esignMissing}
              error="Check this box to sign electronically."
            >
              {ESIGN_LABEL}
            </SignBox>
          </div>
          <details className="group">
            <summary className={MORE}>
              Your certification (Section {CERTIFICATION_CLAUSE}) and electronic records
              <ChevronDown aria-hidden className="size-4 shrink-0 transition-transform duration-200 ease-out group-open:rotate-180 motion-reduce:transition-none" strokeWidth={1.75} />
            </summary>
            <div className="mt-1 flex max-h-64 flex-col gap-3 overflow-y-auto rounded-[14px] bg-chalk p-4 focus-visible:outline-3 focus-visible:outline-offset-3 focus-visible:outline-cobalt" tabIndex={0} aria-label="Certification and consent to electronic records">
              <p className="text-sm text-foreground leading-relaxed">{CERTIFICATION_TEXT}</p>
              <LegalDocument blocks={ESIGN_BLOCKS} variant="compact" />
            </div>
          </details>
          <div data-missing={nameMissing || undefined} className="flex max-w-md flex-col gap-1.5 border-t border-line pt-4 sm:pt-5">
            <label htmlFor={`${id}-legal-name`} className="label-caps text-[15px] text-ink">Full legal name<Req /></label>
            <input
              id={`${id}-legal-name`}
              className={cn(
                NAME_INPUT,
                "h-13 font-heading text-[1.5rem] font-extrabold tracking-[0.01em] md:text-[1.5rem]",
                "aria-invalid:border-destructive aria-invalid:bg-red-50"
              )}
              autoComplete="name"
              value={state.signerName}
              onChange={(e) => onChange({ ...state, signerName: e.target.value })}
              aria-required="true"
              aria-invalid={nameMissing || undefined}
              aria-describedby={nameMissing ? `${id}-legal-name-error ${id}-legal-name-hint` : `${id}-legal-name-hint`}
            />
            {nameMissing && <ItemError id={`${id}-legal-name-error`}>Type your full legal name to sign.</ItemError>}
            <p id={`${id}-legal-name-hint`} className="text-[13px] leading-snug text-ink-soft">
              Typing your name is your electronic signature on the Terms, including the certification above. The date and time come from our server when you place the order.
            </p>
          </div>
        </div>
      </section>
    </div>
  );
}
