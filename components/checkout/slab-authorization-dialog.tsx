"use client";

import { useId, useState } from "react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { LegalDocument } from "@/components/legal/legal-document";
import { SLAB_FEE_CENTS, SLAB_TITLE, cardTitle, slabAuthorization } from "@/lib/legal/agreements-v1";
import { signSlab, slabSignature, slabSigned, type SigningState, type SlabCard } from "./signing-section";
import { Need, Req, revealMissing } from "./required";
import { PIXEL_FIELD } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { cta } from "@/components/brand";

const FIELD = PIXEL_FIELD;

/**
 * The Slab Removal Authorization for one card, opened as soon as the customer
 * picks slab cracking (Terms Section 7). It names the card, shows the
 * authorization in full, and is signed on the spot with a checkbox
 * and the customer's typed name. Closing it without signing takes the slab
 * (and its $7) off the card.
 */
export function SlabAuthorizationDialog(props: {
  /** The card being authorized, or null when closed */
  card: SlabCard | null;
  state: SigningState;
  onChange: (s: SigningState) => void;
  /** signed: the customer signed; otherwise the slab comes off the card */
  onClose: (signed: boolean) => void;
}) {
  if (!props.card) return null;
  // A fresh form per card, starting from any signature already given for it
  return <SlabDialog key={props.card.id ?? props.card.index} {...props} card={props.card} />;
}

function SlabDialog({ card, state, onChange, onClose }: {
  card: SlabCard;
  state: SigningState;
  onChange: (s: SigningState) => void;
  onClose: (signed: boolean) => void;
}) {
  const id = useId();
  const [agreed, setAgreed] = useState(() => !!slabSignature(state, card)?.agreed);
  const [name, setName] = useState(() => slabSignature(state, card)?.signer_name ?? "");
  // Pressed "Sign" with something missing: outline it in red
  const [tried, setTried] = useState(false);
  const [box, setBox] = useState<HTMLDivElement | null>(null);

  const d = card.details;
  const ready = agreed && name.trim().length >= 2;
  const doc = slabAuthorization(d);

  function sign() {
    if (!ready) {
      setTried(true);
      revealMissing(box);
      return;
    }
    onChange(signSlab(state, card, name.trim()));
    onClose(true);
  }

  return (
    <Dialog open onOpenChange={(open) => { if (!open) onClose(slabSigned(state, card)); }}>
      <DialogContent ref={setBox} className="sm:max-w-xl max-h-[92dvh] overflow-y-auto p-5 md:p-6 gap-5">
        <DialogHeader>
          <DialogTitle className="pr-8 font-heading text-[2rem] leading-[0.95] font-black text-ink">{SLAB_TITLE}</DialogTitle>
          <DialogDescription className="text-[15px] text-ink-soft">
            {cardTitle(d) || "This card"}: slab cracking is ${(SLAB_FEE_CENTS / 100).toFixed(0)}. We only open this holder once you sign below.
          </DialogDescription>
        </DialogHeader>

        <div className="max-h-[38dvh] overflow-y-auto rounded-[14px] bg-chalk p-4 focus-visible:outline-3 focus-visible:outline-offset-3 focus-visible:outline-cobalt" tabIndex={0} aria-label={`${SLAB_TITLE} for ${d.card_name}`}>
          <LegalDocument blocks={doc.blocks} variant="compact" />
        </div>

        <Need missing={tried && !agreed} note="Check this box to authorize opening the slab.">
          <label className="flex cursor-pointer items-start gap-3 text-[15px] leading-relaxed">
            <input type="checkbox" className="mt-0.5 shrink-0" checked={agreed} onChange={(e) => setAgreed(e.target.checked)} />
            <span className="text-ink">I authorize The Card Doc to open this card&apos;s holder, as described above.<Req /></span>
          </label>
        </Need>
        <Need missing={tried && name.trim().length < 2} note="Type your full legal name to sign." className="flex flex-col gap-1.5">
          <label htmlFor={`${id}-name`} className="label-caps text-[15px] text-ink">Full legal name<Req /></label>
          <input id={`${id}-name`} className={cn(FIELD, "h-13 font-heading text-[1.5rem] font-extrabold md:text-[1.5rem]")} autoComplete="name" value={name} onChange={(e) => setName(e.target.value)} />
          <p className="text-[13px] leading-relaxed text-ink-soft">Typing your name signs this authorization for this card only. The date and time come from our server when you place the order.</p>
        </Need>

        <div className="flex flex-col-reverse sm:flex-row sm:items-center sm:justify-between gap-3 pt-1">
          <button type="button" onClick={() => onClose(false)} className="inline-flex min-h-11 items-center self-start text-sm font-semibold text-ink-soft underline underline-offset-2 hover:text-ink sm:self-auto">
            Don&apos;t open this slab
          </button>
          <button
            type="button"
            onClick={sign}
            className={cta({ tone: "sun", size: "md" })}
          >
            Sign slab authorization
          </button>
        </div>
        {tried && !ready && <p className="text-sm font-semibold text-destructive -mt-2" role="alert">Please fill in the fields outlined in red.</p>}
      </DialogContent>
    </Dialog>
  );
}
