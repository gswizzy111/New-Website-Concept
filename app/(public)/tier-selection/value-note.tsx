"use client";

import { useEffect, useId, useRef, useState } from "react";
import { cn } from "@/lib/utils";
import { TOOLTIP } from "./fact-row";

const NOTE = "Current value, raw or graded";

/**
 * The "*" note on a tier's card value. Phones show it as a small line under
 * the value; from md it is a 44px button whose tip opens on hover, keyboard
 * focus or a tap, and closes on a second tap, Escape or a tap elsewhere.
 * Place it inside a `flex flex-wrap items-center` dd.
 */
export function ValueNote({ dark = false }: { dark?: boolean }) {
  const id = useId();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    if (!open) return;
    const away = (e: PointerEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    const esc = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("pointerdown", away);
    document.addEventListener("keydown", esc);
    return () => {
      document.removeEventListener("pointerdown", away);
      document.removeEventListener("keydown", esc);
    };
  }, [open]);

  const soft = dark ? "text-on-dark-muted" : "text-ink-soft";

  return (
    <>
      <span aria-hidden className={cn("text-xs md:hidden", soft)}>*</span>
      <span className={cn("basis-full text-[13px] font-medium leading-snug md:hidden", soft)}>{NOTE}</span>

      <span ref={ref} data-open={open} className="group relative hidden md:inline-flex">
        <button
          type="button"
          aria-describedby={id}
          aria-expanded={open}
          aria-label="Card value"
          onClick={() => setOpen((v) => !v)}
          className={cn(
            "-m-3 grid size-11 cursor-help place-items-center rounded-full text-sm font-bold focus-visible:outline-2 focus-visible:-outline-offset-8",
            dark ? "text-on-dark-muted hover:text-white focus-visible:outline-sun" : "text-ink-soft hover:text-ink focus-visible:outline-cobalt"
          )}
        >
          <span aria-hidden>*</span>
        </button>
        <span id={id} role="tooltip" className={cn(TOOLTIP, dark && "bg-white text-ink")}>
          {NOTE}
        </span>
      </span>
    </>
  );
}
