"use client";

import { useState } from "react";
import { Check, Copy } from "lucide-react";

export function CopyCode({ code }: { code: string }) {
  const [copied, setCopied] = useState(false);
  async function copy() {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {
      // Clipboard blocked: the code is on screen to copy by hand
    }
  }
  return (
    <button
      type="button"
      onClick={copy}
      className="btn btn-sun btn-sm gap-1.5"
    >
      {copied ? <Check className="size-3.5" strokeWidth={1.75} /> : <Copy className="size-3.5" strokeWidth={1.75} />}
      <span aria-live="polite">{copied ? "Copied" : "Copy code"}</span>
    </button>
  );
}
