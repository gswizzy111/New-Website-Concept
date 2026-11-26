"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { CornerDownLeft, X } from "lucide-react";

/**
 * Handheld scanners (Bluetooth or USB, "keyboard" mode: the Eyoyo paired
 * with the shop's iPhone) type what they read and press Enter. Two ways in,
 * both to `onScan`:
 *  - anywhere on the page: fast keystrokes ending in Enter (or Tab) are
 *    caught even when no box has focus (a scanner paired with a phone types
 *    into the page; the page's buttons never see the Enter). This is how
 *    the Scan page is used: there is no camera;
 *  - the "Scan or type a code" box, behind "Type a code instead": a person
 *    typing a code and pressing Go, a scanner typing into it, or a pasted
 *    link (sent at once).
 * Typing into any other box on the page is left alone.
 */

/** A scanner types a character every few milliseconds; a person far slower. */
const KEY_GAP_MS = 100;
const MIN_LENGTH = 4;

/** Input types that take no typing (a scanner's keys on a focused checkbox are still a scan). */
const NOT_TEXT = new Set(["checkbox", "radio", "button", "submit", "reset", "range", "color", "file", "image"]);

function isEditable(el: EventTarget | null): boolean {
  if (!(el instanceof HTMLElement)) return false;
  if (el instanceof HTMLInputElement) return !NOT_TEXT.has(el.type);
  return el.isContentEditable || el.tagName === "TEXTAREA" || el.tagName === "SELECT";
}

/** How many pages are catching scans now (the Scan page: one), for "Ready to scan". */
let listening = 0;
const readyListeners = new Set<() => void>();
function setListening(delta: number) {
  listening += delta;
  for (const l of readyListeners) l();
}
function subscribeReady(listener: () => void) {
  readyListeners.add(listener);
  return () => {
    readyListeners.delete(listener);
  };
}

/**
 * Catches a handheld scanner's keystrokes and pastes when no box has focus.
 * Returns true once it is listening (after the page has loaded in the
 * browser; on the server and before that, false), so the page says "Ready to
 * scan" only when a scan would be caught.
 */
export function useKeyboardWedge(onScan: (text: string, source: "wedge" | "paste") => void): boolean {
  const onScanRef = useRef(onScan);
  useEffect(() => {
    onScanRef.current = onScan;
  }, [onScan]);

  useEffect(() => {
    let buffer = "";
    let last = 0;
    function onKeyDown(e: KeyboardEvent) {
      if (isEditable(e.target) || e.ctrlKey || e.metaKey || e.altKey) return;
      const now = performance.now();
      if (now - last > KEY_GAP_MS) buffer = "";
      last = now;
      if (e.key === "Enter" || e.key === "Tab") {
        if (buffer.length >= MIN_LENGTH) {
          // The scan's Enter must not also press whatever button has focus
          e.preventDefault();
          e.stopPropagation();
          const text = buffer;
          buffer = "";
          onScanRef.current(text, "wedge");
        }
        buffer = "";
        return;
      }
      if (e.key.length === 1) {
        buffer = (buffer + e.key).slice(-300);
        // Mid-scan, keep a focused button or link from reacting to the characters
        if (buffer.length > 1) e.preventDefault();
      }
    }
    function onPaste(e: ClipboardEvent) {
      if (isEditable(e.target)) return;
      const text = e.clipboardData?.getData("text") ?? "";
      if (text.trim()) {
        e.preventDefault();
        onScanRef.current(text, "paste");
      }
    }
    window.addEventListener("keydown", onKeyDown, true);
    window.addEventListener("paste", onPaste);
    setListening(1);
    return () => {
      window.removeEventListener("keydown", onKeyDown, true);
      window.removeEventListener("paste", onPaste);
      setListening(-1);
    };
  }, []);

  return useSyncExternalStore(subscribeReady, () => listening > 0, () => false);
}

/**
 * The code box, shown when "Type a code instead" is tapped (some days a code
 * is typed). It takes focus when it opens; after a code on a phone it lets
 * go, so the keyboard goes down and the answer shows, and on a computer it
 * stays ready. Esc or Close (onClose) hides it again.
 */
export function ScanInput({
  onScan,
  onClose,
  placeholder,
}: {
  onScan: (text: string, source: "typed" | "paste") => void;
  onClose?: () => void;
  placeholder?: string;
}) {
  const [value, setValue] = useState("");
  const inputRef = useRef<HTMLInputElement | null>(null);
  const fineRef = useRef(false);

  useEffect(() => {
    fineRef.current = window.matchMedia("(pointer: fine)").matches;
    inputRef.current?.focus({ preventScroll: true });
  }, []);

  function submit(text: string, source: "typed" | "paste") {
    if (!text.trim()) return;
    onScan(text, source);
    setValue("");
    // On a phone, put the keyboard away so the result shows; on a computer stay ready
    if (!fineRef.current) inputRef.current?.blur();
  }

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        submit(value, "typed");
      }}
      className="flex gap-2"
    >
      <label htmlFor="scan-code" className="sr-only">Scan or type a code</label>
      <input
        ref={inputRef}
        id="scan-code"
        name="code"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Escape" && onClose) {
            e.preventDefault();
            onClose();
          }
        }}
        onPaste={(e) => {
          const text = e.clipboardData.getData("text");
          if (text.trim()) {
            e.preventDefault();
            submit(text, "paste");
          }
        }}
        placeholder={placeholder ?? "Scan or type a code (CD-2549-03)"}
        autoComplete="off"
        autoCorrect="off"
        autoCapitalize="characters"
        spellCheck={false}
        enterKeyHint="go"
        className="min-h-12 min-w-0 flex-1 rounded-xl border border-border bg-white px-4 font-mono text-base uppercase placeholder:normal-case placeholder:font-sans placeholder:text-muted-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 focus-visible:border-primary"
      />
      <button
        type="submit"
        disabled={!value.trim()}
        className="min-h-12 shrink-0 px-4 rounded-xl bg-foreground text-background text-base font-bold inline-flex items-center gap-1.5 disabled:opacity-40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
      >
        Go
        <CornerDownLeft className="h-4 w-4" strokeWidth={1.75} aria-hidden="true" />
      </button>
      {onClose && (
        <button
          type="button"
          onClick={onClose}
          aria-label="Close the code box"
          className="h-12 w-12 shrink-0 rounded-xl border border-border bg-white inline-flex items-center justify-center text-foreground hover:border-primary/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
        >
          <X className="h-5 w-5" strokeWidth={1.75} aria-hidden="true" />
        </button>
      )}
    </form>
  );
}
