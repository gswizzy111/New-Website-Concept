"use client";

import { useEffect, useId, useRef, useState, useSyncExternalStore } from "react";
import { AlertTriangle, Check, ExternalLink, Link2 } from "lucide-react";
import { isInAppBrowser } from "@/lib/in-app-browser";
import { trackCheckout, type CheckoutFlow } from "@/lib/checkout-funnel";
import { resumeLinkHash } from "@/components/order-builder/saved-order";
import { cta } from "@/components/brand/button-class";
import { cn } from "@/lib/utils";

/**
 * "You must open this in Safari or Chrome": shown only inside the in-app
 * browsers of Instagram, Facebook, X and TikTok (lib/in-app-browser.ts),
 * which block photo uploads and payments. Everyone else sees nothing.
 *
 * Ways out:
 * - Android: "Open in Chrome", an intent:// link for this page
 *   (developer.chrome.com/docs/android/intents).
 * - Everywhere: "Copy link", to paste into Safari or Chrome.
 * - The app's own ··· menu, always written out. iOS gets no "Open in Safari"
 *   button: the x-safari-https:// trick is undocumented and Instagram and
 *   TikTok are reported to block it.
 * On the restoration builder (carryProgress) both links carry the cards
 * entered so far (#resume=, components/order-builder/saved-order.ts).
 */

// The user agent never changes while the page is open
const noSubscription = () => () => {};
const isAndroid = () => /Android/i.test(navigator.userAgent);

/** This page's address; with carryProgress, the cards entered so far ride along in its hash. */
function pageHref(carryProgress: boolean): string {
  const url = new URL(window.location.href);
  if (carryProgress) url.hash = resumeLinkHash() ?? "";
  return url.href;
}

/**
 * Opens `href` in Chrome on Android. Android reads everything before the last
 * "#" as the address, so the page's own #hash (the resume data) stays with it.
 */
function chromeIntentUrl(href: string): string {
  const url = new URL(href);
  return `intent://${url.host}${url.pathname}${url.search}${url.hash}#Intent;scheme=https;package=com.android.chrome;end`;
}

/** Copies text with the Clipboard API, else the older copy command; false when neither works. */
async function copyText(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // Not allowed here: try the older way
  }
  try {
    const area = document.createElement("textarea");
    area.value = text;
    area.setAttribute("aria-hidden", "true");
    // 16px, so iOS doesn't zoom in while it is selected
    area.style.cssText = "position:fixed;top:0;left:0;width:1px;height:1px;opacity:0;font-size:16px;";
    document.body.appendChild(area);
    area.focus();
    area.select();
    area.setSelectionRange(0, text.length);
    const ok = document.execCommand("copy");
    area.remove();
    return ok;
  } catch {
    return false;
  }
}

export function InAppBrowserNotice({
  flow,
  carryProgress = false,
  className,
}: {
  /** The checkout this page belongs to, for the funnel count. */
  flow: CheckoutFlow;
  /** On the restoration builder: the links carry the cards entered so far. */
  carryProgress?: boolean;
  className?: string;
}) {
  // Read in the browser only (the server render shows nothing)
  const show = useSyncExternalStore(noSubscription, isInAppBrowser, () => false);
  const android = useSyncExternalStore(noSubscription, isAndroid, () => false);
  const [copied, setCopied] = useState<"no" | "yes" | "failed">("no");
  const [manualHref, setManualHref] = useState("");
  const tracked = useRef(false);
  const timer = useRef<number | undefined>(undefined);
  const fieldId = useId();

  useEffect(() => {
    if (!show || tracked.current) return;
    tracked.current = true;
    trackCheckout(flow, "in_app_notice");
  }, [show, flow]);

  useEffect(() => () => window.clearTimeout(timer.current), []);

  if (!show) return null;

  async function copyLink() {
    const href = pageHref(carryProgress);
    const ok = await copyText(href);
    window.clearTimeout(timer.current);
    if (ok) {
      setCopied("yes");
      timer.current = window.setTimeout(() => setCopied("no"), 4000);
    } else {
      setManualHref(href);
      setCopied("failed");
    }
  }

  return (
    <div className={cn("rounded-[18px] bg-white p-5 text-sm text-ink shadow-[inset_6px_0_0_var(--danger),0_0_0_1px_var(--line),var(--panel-shadow)]", className)}>
      <p className="mb-2 flex items-center gap-2 font-heading text-[1.5rem] leading-tight font-extrabold text-destructive"><AlertTriangle className="h-5 w-5 shrink-0" strokeWidth={2.25} />You must open this in Safari or Chrome</p>
      <p className="mb-3 leading-relaxed text-ink">
        Instagram&apos;s built-in browser <strong>blocks photo uploads and payments</strong>. You won&apos;t be able to complete your order here.
      </p>
      <p className="font-bold text-ink">
        Tap the <strong>···</strong> menu (top right) → <strong>&quot;Open in browser&quot;</strong>
      </p>

      <div className="mt-4 flex flex-col gap-2.5 sm:flex-row sm:flex-wrap">
        {android && (
          <a
            // Rebuilt on tap, so it carries the cards entered by then
            href={chromeIntentUrl(window.location.href)}
            onClick={(e) => { e.currentTarget.href = chromeIntentUrl(pageHref(carryProgress)); }}
            className={cta({ tone: "ink", className: "w-full sm:w-auto" })}
          >
            <ExternalLink aria-hidden className="size-[18px]" strokeWidth={1.75} />
            Open in Chrome
          </a>
        )}
        <button type="button" onClick={copyLink} className={cta({ tone: android ? "outline" : "ink", className: "w-full sm:w-auto" })}>
          {copied === "yes" ? (
            <Check aria-hidden className="size-[18px]" strokeWidth={1.75} />
          ) : (
            <Link2 aria-hidden className="size-[18px]" strokeWidth={1.75} />
          )}
          {copied === "yes" ? "Link copied" : "Copy link"}
        </button>
      </div>
      {carryProgress && <p className="mt-2.5 text-[13px] leading-relaxed text-ink-soft">The link keeps the cards you&apos;ve entered.</p>}

      {copied === "failed" && (
        <div className="mt-3 flex flex-col gap-1.5">
          <label htmlFor={fieldId} className="text-[13px] font-semibold text-ink">Press and hold the link to copy it.</label>
          <input
            id={fieldId}
            readOnly
            value={manualHref}
            onFocus={(e) => e.currentTarget.select()}
            className="w-full min-w-0 rounded-[10px] bg-chalk px-3 py-2.5 font-mono text-[13px] text-ink shadow-[inset_0_0_0_1px_var(--line-strong)] focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-cobalt"
          />
        </div>
      )}
      <p aria-live="polite" className="sr-only">{copied === "yes" ? "Link copied" : ""}</p>
    </div>
  );
}
