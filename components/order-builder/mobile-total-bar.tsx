"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import { ChevronUp, XIcon } from "lucide-react";
import { Sheet, SheetClose, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { BLOCK_TITLE } from "@/components/checkout/form-styles";
import { cn } from "@/lib/utils";

const noSubscription = () => () => {};

/** Tailwind's lg breakpoint, where the forms show their summary in a sidebar or on the page. */
const DESKTOP = "(min-width: 64rem)";

/** A field that brings up the phone keyboard or a picker (not a checkbox, radio or button). */
function isTextField(el: EventTarget | null): boolean {
  if (el instanceof HTMLTextAreaElement || el instanceof HTMLSelectElement) return true;
  if (el instanceof HTMLInputElement) {
    return !["checkbox", "radio", "button", "submit", "reset", "file", "range", "color", "image", "hidden"].includes(el.type);
  }
  return el instanceof HTMLElement && el.isContentEditable;
}

export interface MobileTotalBarProps {
  /** The total exactly as the form's summary shows it ("$123.45") */
  total: string;
  /** The summary's word for it ("Total", or "Subtotal" before shipping is known) */
  label?: string;
  cardCount: number;
  /** The Details sheet's heading (the summary panel's own) */
  title: string;
  /** The summary's lines, shown in the Details sheet */
  details: React.ReactNode;
  /**
   * The id of the summary on the page. While its total line (data-summary-total)
   * is on screen the bar steps aside, so the same total never shows twice.
   */
  summaryId?: string;
  /** False keeps the bar tucked away (say, before any card is entered) */
  show?: boolean;
}

/**
 * Phones only (below lg): the order total and card count pinned to the bottom
 * of the screen, so it stays in sight on long steps. "Details" opens a bottom
 * sheet with the summary's lines. It never covers the form: the page content
 * gets bottom padding equal to the bar (home indicator included) and focus
 * scrolls clear of it; it tucks away while a field has the keyboard up, while
 * the summary's own total is on screen and once the footer arrives. Totals
 * are announced politely, once the number settles.
 */
export function MobileTotalBar({ total, label = "Total", cardCount, title, details, summaryId, show = true }: MobileTotalBarProps) {
  // Rendered into <body> after hydration, clear of any transformed ancestor
  const mounted = useSyncExternalStore(noSubscription, () => true, () => false);
  const barRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [typing, setTyping] = useState(false);
  const [focusInside, setFocusInside] = useState(false);
  const [summaryOnScreen, setSummaryOnScreen] = useState(false);
  const [atFooter, setAtFooter] = useState(false);
  const [actionsOnScreen, setActionsOnScreen] = useState(false);

  const cards = `${cardCount} card${cardCount !== 1 ? "s" : ""}`;

  // Room at the end of the page content for the bar, and keyboard focus
  // scrolls clear of it. The bar is display: none from lg up, so it
  // measures 0 there.
  useEffect(() => {
    const bar = barRef.current;
    if (!bar || !show) return;
    const page = (document.querySelector<HTMLElement>("main") ?? document.body).style;
    const root = document.documentElement.style;
    const before = { padding: page.paddingBottom, scroll: root.scrollPaddingBottom };
    const fit = () => {
      const h = bar.offsetHeight;
      page.paddingBottom = h ? `${h}px` : before.padding;
      root.scrollPaddingBottom = h ? `${h + 16}px` : before.scroll;
      // Phone toasts sit above the bar (app/layout.tsx Toaster mobileOffset)
      if (h) root.setProperty("--total-bar-h", `${h}px`);
      else root.removeProperty("--total-bar-h");
    };
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(bar);
    return () => {
      ro.disconnect();
      page.paddingBottom = before.padding;
      root.scrollPaddingBottom = before.scroll;
      root.removeProperty("--total-bar-h");
    };
  }, [mounted, show]);

  // The sheet is for phones: close it if the window grows to desktop width
  useEffect(() => {
    const mq = window.matchMedia(DESKTOP);
    const onChange = () => { if (mq.matches) setOpen(false); };
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);

  // Tuck away while the keyboard is up; stay put while focus is in the bar
  useEffect(() => {
    const onFocusIn = (e: FocusEvent) => {
      setTyping(isTextField(e.target));
      setFocusInside(!!barRef.current?.contains(e.target as Node));
    };
    const onFocusOut = (e: FocusEvent) => {
      const next = e.relatedTarget;
      setTyping(isTextField(next));
      setFocusInside(next instanceof Node && !!barRef.current?.contains(next));
    };
    document.addEventListener("focusin", onFocusIn);
    document.addEventListener("focusout", onFocusOut);
    return () => {
      document.removeEventListener("focusin", onFocusIn);
      document.removeEventListener("focusout", onFocusOut);
    };
  }, []);

  // Step aside while the summary's own total line is in view (below the
  // sticky header, above where the bar sits)
  useEffect(() => {
    if (!summaryId) return;
    const box = document.getElementById(summaryId);
    const target = box?.querySelector<HTMLElement>("[data-summary-total]") ?? box;
    if (!target) return;
    const io = new IntersectionObserver(([entry]) => setSummaryOnScreen(entry.isIntersecting), {
      rootMargin: "-80px 0px -96px 0px",
    });
    io.observe(target);
    return () => io.disconnect();
  }, [summaryId]);

  // ...and once the site footer arrives, so it never covers the end of the page
  useEffect(() => {
    const footer = document.querySelector("main ~ footer");
    if (!footer) return;
    const io = new IntersectionObserver(([entry]) => setAtFooter(entry.isIntersecting));
    io.observe(footer);
    return () => io.disconnect();
  }, []);

  // ...and while the page's main buttons (Back / Continue / Sign, marked
  // data-total-bar-avoid) are on screen, so a tap meant for them never lands on the bar
  useEffect(() => {
    const els = Array.from(document.querySelectorAll("[data-total-bar-avoid]"));
    if (els.length === 0) return;
    const visible = new Set<Element>();
    const io = new IntersectionObserver((entries) => {
      for (const e of entries) {
        if (e.isIntersecting) visible.add(e.target);
        else visible.delete(e.target);
      }
      setActionsOnScreen(visible.size > 0);
    });
    els.forEach((el) => io.observe(el));
    return () => io.disconnect();
  }, [show]);

  // Screen readers hear the total once it stops changing (not on every
  // keystroke in a value field), and the line clears so it isn't read twice
  // when someone moves through the bar. Only where the bar applies: from lg
  // up the summary sits beside the form, and desktop stays as it was.
  const message = `${label}: ${total}, ${cards}`;
  const [settled, setSettled] = useState(message);
  const [spoken, setSpoken] = useState("");
  useEffect(() => {
    if (message === settled) return;
    const t = setTimeout(() => {
      setSettled(message);
      if (show && !window.matchMedia(DESKTOP).matches) setSpoken(message);
    }, 700);
    return () => clearTimeout(t);
  }, [message, settled, show]);
  useEffect(() => {
    if (!spoken) return;
    const t = setTimeout(() => setSpoken(""), 5000);
    return () => clearTimeout(t);
  }, [spoken]);

  const tucked = !open && !focusInside && (!show || typing || summaryOnScreen || atFooter || actionsOnScreen);

  if (!mounted) return null;
  return createPortal(
    <Sheet open={open} onOpenChange={setOpen}>
      <div
        ref={barRef}
        inert={tucked || undefined}
        className={cn(
          "fixed inset-x-0 bottom-0 z-40 rounded-t-[22px] bg-white/95 pb-[env(safe-area-inset-bottom)] text-ink backdrop-blur-md lg:hidden",
          "shadow-[0_0_0_1px_var(--line),0_-16px_32px_-22px_rgba(8,12,40,0.5)]",
          "transition-transform duration-300 ease-[var(--ease-out)] motion-reduce:transition-none",
          tucked && "translate-y-[calc(100%+2rem)]",
        )}
      >
        <div className="wrap flex min-h-[4.5rem] items-center justify-between gap-3 py-3">
          <p className="flex min-w-0 flex-col gap-1.5">
            <span className="label-caps truncate text-[13px] leading-none text-ink-soft">
              {label}<span aria-hidden> · </span><span className="sr-only">, </span>{cards}
            </span>
            <span className="font-heading text-[2rem] leading-[0.85] font-black tabular-nums">{total}</span>
          </p>
          <SheetTrigger className="btn btn-outline btn-sm shrink-0 gap-1.5 pr-4">
            Details
            <ChevronUp aria-hidden className="size-4" strokeWidth={1.75} />
          </SheetTrigger>
        </div>
      </div>
      {/* Outside the bar, so totals are still announced while it's tucked away */}
      <p className="sr-only" aria-live="polite" aria-atomic="true">{spoken}</p>
      <SheetContent
        side="bottom"
        // Its own close button below: a full 44px tap target on phones
        showCloseButton={false}
        className="max-h-[85svh] gap-5 overflow-y-auto overscroll-contain rounded-t-[22px] bg-white px-5 pt-6 pb-[calc(1.5rem+env(safe-area-inset-bottom))] text-ink motion-reduce:transition-none data-[side=bottom]:border-t-0"
      >
        <SheetHeader className="p-0 pr-12">
          <SheetTitle className={BLOCK_TITLE}>{title}</SheetTitle>
        </SheetHeader>
        {details}
        <SheetClose render={<Button variant="ghost" size="icon" className="absolute top-3 right-3" />}>
          <XIcon aria-hidden className="size-5" strokeWidth={1.75} />
          <span className="sr-only">Close</span>
        </SheetClose>
      </SheetContent>
    </Sheet>,
    document.body,
  );
}
