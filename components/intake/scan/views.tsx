"use client";

import { useEffect, useRef, useState } from "react";
import { Check, CircleCheck, CircleAlert, ScanLine, TriangleAlert } from "lucide-react";
import { recentScansLabel } from "./flow-text";

// Shared pieces of the Scan page (scan-app.tsx holds the flow; flow-views.tsx the panel, the card and the lists).

export const panel = "rounded-2xl border border-border bg-white";
export const bigButton =
  "min-h-14 px-4 rounded-2xl text-lg font-black inline-flex items-center justify-center gap-2 transition active:scale-[0.98] motion-reduce:active:scale-100 disabled:opacity-50 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-primary/30";
export const smallButton =
  "min-h-11 px-3 rounded-xl border border-border bg-white text-sm font-bold text-foreground hover:border-primary/40 transition-colors inline-flex items-center justify-center gap-1.5 disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40";

/** A minute clock for "2 h ago" wording (re-renders once a minute). */
export function useNow(): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(t);
  }, []);
  return now;
}

/** ok: saved; error: refused or a problem; info: what to do next ("Scan CLAMP 09 again"). */
export type FlashState = { key: number; tone: "ok" | "error" | "info"; text: string };

/** The huge ✓ / ⚠ after a save or a failed scan; gone after a moment. Screen readers get the text from the page's status line. */
export function Flash({ flash }: { flash: FlashState | null }) {
  const ref = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el || !flash) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    el.animate(
      [
        { opacity: 0, transform: "scale(0.92)" },
        { opacity: 1, transform: "scale(1)" },
      ],
      { duration: 140, easing: "cubic-bezier(0.2, 0, 0, 1)" },
    );
  }, [flash]);
  if (!flash) return null;
  const ok = flash.tone === "ok";
  const info = flash.tone === "info";
  return (
    <div aria-hidden="true" className="pointer-events-none fixed inset-0 z-50 flex items-center justify-center p-6">
      <div
        ref={ref}
        key={flash.key}
        className={`flex max-w-sm flex-col items-center gap-3 rounded-3xl px-8 py-7 text-center text-white shadow-2xl ${ok ? "bg-green-600/95" : info ? "bg-primary/95" : "bg-red-600/95"}`}
      >
        {ok ? <Check className="h-24 w-24" strokeWidth={3} /> : info ? <ScanLine className="h-24 w-24" strokeWidth={2} /> : <TriangleAlert className="h-24 w-24" strokeWidth={2.25} />}
        <p className="text-xl font-black leading-snug break-words">{flash.text}</p>
      </div>
    </div>
  );
}

export type LogItem = { id: number; at: number; tone: "ok" | "warn" | "error"; text: string };

/** What this tab saved and what went wrong ("Recent scans", collapsed; kept while the tab is open). */
export function SessionLog({ items, onClear }: { items: LogItem[]; onClear: () => void }) {
  if (!items.length) return null;
  return (
    <details className={`${panel} group`}>
      <summary className="flex min-h-12 cursor-pointer select-none items-center justify-between gap-2 px-4 text-sm font-bold text-foreground">
        <span>{recentScansLabel(items.length)}</span>
        <span className="text-xs font-semibold text-muted-foreground group-open:hidden">Show</span>
      </summary>
      <ul className="border-t border-border">
        {items.map((item) => (
          <li key={item.id} className="flex items-start gap-2 border-b border-border px-4 py-2 text-sm last:border-b-0">
            {item.tone === "ok" ? (
              <CircleCheck className="mt-0.5 h-4 w-4 shrink-0 text-green-700" strokeWidth={1.75} aria-label="Saved" />
            ) : item.tone === "warn" ? (
              <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0 text-amber-700" strokeWidth={1.75} aria-label="Partly saved" />
            ) : (
              <CircleAlert className="mt-0.5 h-4 w-4 shrink-0 text-red-700" strokeWidth={1.75} aria-label="Problem" />
            )}
            <span className="min-w-0 flex-1 break-words">{item.text}</span>
            <time className="shrink-0 text-xs text-muted-foreground" dateTime={new Date(item.at).toISOString()}>
              {new Date(item.at).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })}
            </time>
          </li>
        ))}
      </ul>
      <div className="px-4 py-2">
        <button type="button" onClick={onClear} className="min-h-11 text-sm font-semibold text-muted-foreground hover:text-foreground">
          Clear list
        </button>
      </div>
    </details>
  );
}
