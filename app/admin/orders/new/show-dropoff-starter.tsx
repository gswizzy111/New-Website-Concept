"use client";

import { useState, useSyncExternalStore } from "react";
import { AdminLink } from "@/components/admin-ui/admin-link";
import { DropoffQr } from "@/components/show-dropoffs/dropoff-qr";

/**
 * New Order → Show Drop-off: the customer fills in /show-dropoffs (on our
 * tablet or their phone) and signs; it lands in Show Dropoffs to enter later.
 * The show name, if given, is added to the link and saved with each drop-off.
 */
export function ShowDropoffStarter() {
  const [show, setShow] = useState("");
  const [copied, setCopied] = useState(false);
  const path = `/show-dropoffs${show.trim() ? `?show=${encodeURIComponent(show.trim())}` : ""}`;
  // The site's own address, read in the browser only (no hydration mismatch)
  const origin = useSyncExternalStore(() => () => {}, () => window.location.origin, () => "");
  const fullUrl = `${origin}${path}`;

  async function copy() {
    try {
      await navigator.clipboard.writeText(fullUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
    }
  }

  return (
    <div className="bg-white rounded-xl border border-border p-6 flex flex-col gap-4">
      <h2 className="font-heading font-black text-base text-foreground">Show Drop-off</h2>
      <div>
        <label htmlFor="show-name" className="block text-xs font-semibold text-muted-foreground mb-1.5">
          Which show? <span className="font-normal">(optional, saved with each drop-off)</span>
        </label>
        <input
          id="show-name"
          value={show}
          maxLength={120}
          placeholder="e.g. Philly Card Show"
          onChange={(e) => setShow(e.target.value)}
          className="w-full h-10 border border-border rounded-lg px-3 text-sm focus:outline-none focus:border-primary transition-colors bg-white"
        />
      </div>
      <div className="flex flex-col items-center gap-1 rounded-xl bg-secondary/40 py-4">
        <p className="text-sm font-semibold text-foreground">Customers can scan this to fill it in on their phone</p>
        <DropoffQr path={path} size={200} />
      </div>
      <div className="flex flex-wrap gap-2">
        <a
          href={path}
          target="_blank"
          rel="noreferrer"
          className="h-10 px-5 bg-primary text-primary-foreground rounded-lg text-sm font-bold hover:bg-primary/90 transition-colors flex items-center"
        >
          Open the customer form ↗
        </a>
        <button
          type="button"
          onClick={copy}
          className="h-10 px-4 border border-border rounded-lg text-sm font-semibold hover:border-primary/40 transition-colors"
        >
          {copied ? "Copied!" : "Copy link"}
        </button>
        <AdminLink
          href="/admin/show-dropoffs"
          className="h-10 px-4 border border-border rounded-lg text-sm font-semibold hover:border-primary/40 transition-colors flex items-center"
        >
          Drop-offs to enter →
        </AdminLink>
      </div>
    </div>
  );
}
