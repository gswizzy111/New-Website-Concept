"use client";

import { useEffect, useRef, useState } from "react";
import { CornerDownLeft } from "lucide-react";

/**
 * Handheld scanners (Bluetooth or USB, "keyboard" mode) type what they read
 * and press Enter. Two ways in, both to `onScan`:
 *  - anywhere on the page: fast keystrokes ending in Enter (or Tab) are
 *    caught even when no box has focus (a scanner paired with a phone types
 *    into the page; the page's buttons never see the Enter);
 *  - the "Scan or type a code" box: a scanner typing into it, a person
 *    typing a code and pressing Go, or a pasted link (sent at once).
 * Typing into any other box on the page is left alone.
 */

/** A scanner types a character every few milliseconds; a person far slower. */
const KEY_GAP_MS = 100;
const MIN_LENGTH = 4;

function isEditable(el: EventTarget | null): boolean {
  if (!(el instanceof HTMLElement)) return false;
  return el.isContentEditable || el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.tagName === "SELECT";
}

/** Catches a handheld scanner's keystrokes and pastes when no box has focus. */
export function useKeyboardWedge(onScan: (text: string, source: "wedge" | "paste") => void) {
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
    return () => {
      window.removeEventListener("keydown", onKeyDown, true);
      window.removeEventListener("paste", onPaste);
    };
  }, []);
}

/**
 * The code box. On a computer it takes focus when the page opens (and after
 * each scan), so a desk scanner's code lands here; on a phone it doesn't, so
 * the keyboard stays down until someone taps it.
 */
export function ScanInput({ onScan, placeholder }: { onScan: (text: string, source: "typed" | "paste") => void; placeholder?: string }) {
  const [value, setValue] = useState("");
  const inputRef = useRef<HTMLInputElement | null>(null);
  const fineRef = useRef(false);

  useEffect(() => {
    fineRef.current = window.matchMedia("(pointer: fine)").matches;
    if (fineRef.current) inputRef.current?.focus({ preventScroll: true });
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
    </form>
  );
}
