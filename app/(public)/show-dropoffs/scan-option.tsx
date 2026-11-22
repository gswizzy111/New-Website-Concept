"use client";

import { useState } from "react";
import { QrCode, X } from "lucide-react";
import { DropoffQr } from "@/components/show-dropoffs/dropoff-qr";
import { FORM_PANEL } from "@/components/checkout/form-styles";
import { cn } from "@/lib/utils";

/** "Use your own phone": a QR code of this form to scan at the table. */
export function ScanOption({ show }: { show: string }) {
  const [open, setOpen] = useState(false);
  const path = `/show-dropoffs${show ? `?show=${encodeURIComponent(show)}` : ""}`;

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={cn(FORM_PANEL, "mb-8 flex w-full items-center gap-4 text-left transition-shadow hover:shadow-[0_0_0_2px_var(--cobalt)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cobalt")}
      >
        <span className="grid size-12 shrink-0 place-items-center rounded-full bg-cobalt/10 text-cobalt">
          <QrCode className="size-6" strokeWidth={1.75} aria-hidden />
        </span>
        <span className="flex flex-col">
          <span className="text-[17px] font-bold text-ink">Rather use your own phone?</span>
          <span className="text-sm text-ink-soft">Tap to show a QR code. Scan it and fill this in on your device.</span>
        </span>
      </button>
    );
  }

  return (
    <div className={cn(FORM_PANEL, "relative mb-8 flex flex-col items-center gap-4 text-center")}>
      <button
        type="button"
        onClick={() => setOpen(false)}
        className="absolute top-3 right-3 grid size-10 place-items-center rounded-full text-ink-soft hover:bg-chalk hover:text-ink"
        aria-label="Hide the QR code"
      >
        <X className="size-5" strokeWidth={1.75} aria-hidden />
      </button>
      <div className="px-10">
        <p className="text-[20px] font-bold text-ink">Scan with your phone camera</p>
        <p className="mt-1 text-sm text-ink-soft">The same form opens on your phone. Hand your cards to us at the table.</p>
      </div>
      <DropoffQr path={path} size={240} />
    </div>
  );
}
